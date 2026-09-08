package br.com.delupo.pttcoletor

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

interface PttListener {
    fun onConnectionState(state: ConnectionState)
    fun onChannels(channels: List<String>, initial: Boolean)
    fun onChannelState(channel: String, users: List<UserInfo>, speakerId: String?)
    fun onFloorGranted()
    fun onFloorDenied(reason: String)
    fun onSpeakerStarted(speakerId: String, speakerName: String)
    fun onSpeakerStopped()
    fun onServerError(message: String)
    fun onChannelRemoved(channel: String)
    fun onAuthFailed()
    fun onCallStarted(peerId: String, peerName: String)
    fun onCallEnded(reason: String)
    fun onCallDenied(reason: String)
}

private const val SAMPLE_RATE = 16000
private const val FRAME_SIZE_SAMPLES = 320 // 20ms @ 16kHz
private const val FRAME_SIZE_BYTES = FRAME_SIZE_SAMPLES * 2
private const val NOTIFICATION_CHANNEL_ID = "ptt_service"
private const val NOTIFICATION_ID = 1

class PttConnectionService : Service() {

    companion object {
        var instance: PttConnectionService? = null
            private set
    }

    inner class LocalBinder : Binder() {
        fun getService(): PttConnectionService = this@PttConnectionService
    }

    private val binder = LocalBinder()
    var listener: PttListener? = null

    var connectionState: ConnectionState = ConnectionState.DISCONNECTED
        private set
    var myClientId: String? = null
        private set
    var currentChannel: String? = null
        private set
    var currentCallPeerId: String? = null
        private set
    var currentCallPeerName: String? = null
        private set

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var audioTrack: AudioTrack? = null
    private var micJob: Job? = null
    @Volatile private var transmitting = false

    private var serverUrl: String? = null
    private var myUsername: String = ""
    private var myPassword: String = ""
    private var myName: String = ""
    private var intentionalDisconnect = false
    private var reconnectBackoffMs = 1000L
    private var reconnectJob: Job? = null
    private var failureAlreadyNotified = false
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        instance = this
        setupAudioTrack()
    }

    override fun onDestroy() {
        intentionalDisconnect = true
        micJob?.cancel()
        webSocket?.close(1000, "service destroyed")
        audioTrack?.stop()
        audioTrack?.release()
        releaseWakeLock()
        instance = null
        serviceScope.cancel()
        super.onDestroy()
    }

    fun connect(url: String, username: String, password: String, name: String) {
        if (connectionState == ConnectionState.CONNECTED || connectionState == ConnectionState.CONNECTING) {
            // O serviço já está conectado (ou conectando) — por exemplo, o app voltou do segundo
            // plano e a Activity foi recriada. Reaproveita a conexão existente em vez de abrir uma
            // segunda: abrir outra deixaria o coletor duplicado (uma entrada "fantasma" presa no
            // canal antigo) até a conexão velha cair sozinha.
            listener?.onConnectionState(connectionState)
            return
        }
        serverUrl = url
        myUsername = username
        myPassword = password
        myName = name
        intentionalDisconnect = false
        acquireWakeLock()
        openSocket()
        startForegroundNotification()
    }

    fun disconnect() {
        intentionalDisconnect = true
        reconnectJob?.cancel()
        micJob?.cancel()
        webSocket?.close(1000, "user disconnected")
        webSocket = null
        connectionState = ConnectionState.DISCONNECTED
        listener?.onConnectionState(connectionState)
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PttColetor:connection").apply {
            setReferenceCounted(false)
            acquire(TimeUnit.HOURS.toMillis(12))
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    fun joinChannel(channel: String) {
        currentChannel = channel
        sendText(joinMessage(channel))
    }

    fun startCall(targetId: String) {
        sendText(callStartMessage(targetId))
    }

    fun endCall() {
        sendText(callEndMessage())
    }

    fun startTalking() {
        if (micJob?.isActive == true) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            listener?.onServerError(getString(R.string.error_mic_permission_runtime))
            return
        }
        sendText(pttStartMessage())
        micJob = serviceScope.launch { captureMicLoop() }
    }

    fun stopTalking() {
        transmitting = false
        micJob?.cancel()
        micJob = null
        sendText(pttStopMessage())
    }

    private fun openSocket() {
        val url = serverUrl ?: return
        connectionState = ConnectionState.CONNECTING
        listener?.onConnectionState(connectionState)
        val request = Request.Builder().url(toWebSocketUrl(url)).build()
        webSocket = okHttpClient.newWebSocket(request, socketListener)
    }

    /**
     * Aceita tanto "IP:porta" (rede local, vira ws://) quanto uma URL completa já com
     * esquema (ex.: wss://xxxx.trycloudflare.com de um túnel), normalizando http(s) para ws(s).
     */
    private fun toWebSocketUrl(input: String): String {
        val trimmed = input.trim()
        return when {
            trimmed.startsWith("ws://") || trimmed.startsWith("wss://") -> trimmed
            trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
            trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
            else -> "ws://$trimmed"
        }
    }

    private val socketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            reconnectBackoffMs = 1000L
            failureAlreadyNotified = false
            connectionState = ConnectionState.CONNECTED
            listener?.onConnectionState(connectionState)
            val deviceId = Build.MODEL + "-" + UUID.randomUUID().toString().take(8)
            webSocket.send(helloMessage(myUsername, myPassword, myName, deviceId))
            currentChannel?.let { webSocket.send(joinMessage(it)) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handleServerEvent(parseServerEvent(text) ?: return)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            audioTrack?.write(bytes.toByteArray(), 0, bytes.size)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (code == 4003) {
                intentionalDisconnect = true
                handleDisconnect()
                listener?.onAuthFailed()
                return
            }
            handleDisconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!intentionalDisconnect && !failureAlreadyNotified) {
                failureAlreadyNotified = true
                val message = when (t) {
                    is UnknownHostException -> applicationContext.getString(R.string.error_connection_host_not_found)
                    is ConnectException, is SocketTimeoutException -> applicationContext.getString(R.string.error_connection_refused)
                    else -> applicationContext.getString(R.string.error_connection_lost)
                }
                listener?.onServerError(message)
            }
            handleDisconnect()
        }
    }

    private fun handleDisconnect() {
        transmitting = false
        micJob?.cancel()
        micJob = null
        connectionState = ConnectionState.DISCONNECTED
        listener?.onConnectionState(connectionState)
        if (intentionalDisconnect) return
        reconnectJob?.cancel()
        reconnectJob = serviceScope.launch {
            delay(reconnectBackoffMs)
            reconnectBackoffMs = (reconnectBackoffMs * 2).coerceAtMost(10_000L)
            openSocket()
        }
    }

    private fun handleServerEvent(event: ServerEvent) {
        when (event) {
            is ServerEvent.Welcome -> {
                myClientId = event.clientId
                listener?.onChannels(event.channels, true)
            }
            is ServerEvent.ChannelState -> listener?.onChannelState(event.channel, event.users, event.speaker)
            is ServerEvent.PttGranted -> {
                if (micJob?.isActive != true) {
                    // O botão já foi solto antes da confirmação chegar: libera na hora,
                    // sem deixar a UI presa em "FALANDO".
                    sendText(pttStopMessage())
                } else {
                    transmitting = true
                    listener?.onFloorGranted()
                }
            }
            is ServerEvent.PttDenied -> {
                micJob?.cancel()
                micJob = null
                listener?.onFloorDenied(event.reason)
            }
            is ServerEvent.SpeakerStarted -> listener?.onSpeakerStarted(event.speakerId, event.speakerName)
            is ServerEvent.SpeakerStopped -> listener?.onSpeakerStopped()
            is ServerEvent.ServerError -> listener?.onServerError(event.message)
            is ServerEvent.ChannelsUpdated -> listener?.onChannels(event.channels, false)
            is ServerEvent.ChannelRemoved -> {
                if (event.channel == currentChannel) currentChannel = null
                listener?.onChannelRemoved(event.channel)
            }
            is ServerEvent.CallStarted -> {
                currentCallPeerId = event.peerId
                currentCallPeerName = event.peerName
                listener?.onCallStarted(event.peerId, event.peerName)
            }
            is ServerEvent.CallEnded -> {
                currentCallPeerId = null
                currentCallPeerName = null
                transmitting = false
                micJob?.cancel()
                micJob = null
                listener?.onCallEnded(event.reason)
            }
            is ServerEvent.CallDenied -> listener?.onCallDenied(event.reason)
        }
    }

    private fun sendText(text: String) {
        webSocket?.send(text)
    }

    @Suppress("MissingPermission")
    private suspend fun CoroutineScope.captureMicLoop() {
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SIZE_BYTES * 4)

        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            minBuf
        )
        try {
            record.startRecording()
            val buf = ByteArray(FRAME_SIZE_BYTES)
            while (isActive) {
                val read = record.read(buf, 0, buf.size)
                if (read > 0 && transmitting) {
                    webSocket?.send(buf.copyOf(read).toByteString())
                }
            }
        } finally {
            record.stop()
            record.release()
        }
    }

    private fun setupAudioTrack() {
        val minBuf = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(FRAME_SIZE_BYTES * 4)

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(minBuf)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        audioTrack?.play()
    }

    private fun startForegroundNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }

        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}
