package br.com.delupo.pttcoletor

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import br.com.delupo.pttcoletor.databinding.ActivityPttBinding
import com.google.android.material.snackbar.Snackbar

class PttActivity : AppCompatActivity(), PttListener {

    companion object {
        const val EXTRA_SERVER = "extra_server"
        const val EXTRA_USERNAME = "extra_username"
        const val EXTRA_PASSWORD = "extra_password"
        const val EXTRA_NAME = "extra_name"
    }

    private lateinit var binding: ActivityPttBinding
    private var service: PttConnectionService? = null
    private lateinit var serverUrl: String
    private lateinit var userUsername: String
    private lateinit var userPassword: String
    private lateinit var userName: String
    private lateinit var usersAdapter: UsersAdapter
    private var lastUsers: List<UserInfo> = emptyList()
    private var lastSpeakerId: String? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as PttConnectionService.LocalBinder).getService()
            service?.listener = this@PttActivity
            onConnectionState(service!!.connectionState)
            service?.connect(serverUrl, userUsername, userPassword, userName)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            service = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPttBinding.inflate(layoutInflater)
        setContentView(binding.root)

        serverUrl = intent.getStringExtra(EXTRA_SERVER) ?: ""
        userUsername = intent.getStringExtra(EXTRA_USERNAME) ?: ""
        userPassword = intent.getStringExtra(EXTRA_PASSWORD) ?: ""
        userName = intent.getStringExtra(EXTRA_NAME) ?: ""

        // O canal é atribuído pelo administrador — o campo só exibe o canal atual, sem interação.
        binding.spinnerChannel.isEnabled = false
        binding.spinnerChannel.isFocusable = false

        usersAdapter = UsersAdapter(onCallClick = { user -> service?.startCall(user.id) })
        binding.recyclerUsers.layoutManager = LinearLayoutManager(this)
        binding.recyclerUsers.adapter = usersAdapter

        binding.btnEndCall.setOnClickListener { service?.endCall() }

        binding.btnPtt.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> onPttPressed()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> onPttReleased()
            }
            true
        }

        val intent = Intent(this, PttConnectionService::class.java)
        ContextCompat.startForegroundService(this, intent)
        bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    override fun onDestroy() {
        service?.listener = null
        unbindService(connection)
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val mappedKeyCode = HardwareKeyPrefs.getKeyCode(this)
        if (mappedKeyCode != NO_HARDWARE_KEY && event.keyCode == mappedKeyCode) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) onPttPressed()
                KeyEvent.ACTION_UP -> onPttReleased()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun onPttPressed() {
        service?.startTalking()
    }

    private fun onPttReleased() {
        service?.stopTalking()
        setPttButtonColor(R.color.ptt_idle)
        binding.btnPtt.text = getString(R.string.btn_ptt)
    }

    override fun onConnectionState(state: ConnectionState) {
        runOnUiThread {
            binding.textStatus.text = when (state) {
                ConnectionState.DISCONNECTED -> getString(R.string.status_disconnected)
                ConnectionState.CONNECTING -> getString(R.string.status_connecting)
                ConnectionState.CONNECTED -> getString(R.string.status_connected)
            }
            setChipColor(
                when (state) {
                    ConnectionState.CONNECTED -> R.color.color_success
                    ConnectionState.CONNECTING -> R.color.ptt_busy
                    ConnectionState.DISCONNECTED -> R.color.color_error
                }
            )
            if (state == ConnectionState.DISCONNECTED) {
                setPttButtonColor(R.color.ptt_idle)
                binding.btnPtt.text = getString(R.string.btn_ptt)
                binding.layoutSpeaking.visibility = View.GONE
                binding.layoutCall.visibility = View.GONE
            }
        }
    }

    override fun onChannels(channels: List<String>, initial: Boolean) {
        // O canal é atribuído pelo administrador; o app não escolhe nem exibe uma lista para
        // selecionar — nada a fazer aqui além de manter a interface (PttListener) satisfeita.
    }

    override fun onChannelRemoved(channel: String) {
        runOnUiThread {
            binding.spinnerChannel.setText("", false)
            showError("O canal \"$channel\" foi removido pelo administrador. Aguarde o administrador atribuir um novo canal.", long = true)
        }
    }

    override fun onChannelState(channel: String, users: List<UserInfo>, speakerId: String?) {
        runOnUiThread {
            binding.spinnerChannel.setText(channel, false)
            lastUsers = users
            lastSpeakerId = speakerId
            usersAdapter.update(users, speakerId, service?.myClientId)
            binding.textEmptyUsers.visibility = if (users.isEmpty()) View.VISIBLE else View.GONE
            binding.recyclerUsers.visibility = if (users.isEmpty()) View.GONE else View.VISIBLE
            if (speakerId == null) {
                binding.layoutSpeaking.visibility = View.GONE
            }
        }
    }

    override fun onFloorGranted() {
        runOnUiThread {
            setPttButtonColor(R.color.ptt_talking)
            binding.btnPtt.text = getString(R.string.btn_ptt_talking)
        }
    }

    override fun onFloorDenied(reason: String) {
        runOnUiThread {
            setPttButtonColor(R.color.ptt_idle)
            binding.btnPtt.text = getString(R.string.btn_ptt)
            val message = when (reason) {
                "busy" -> getString(R.string.error_ptt_busy)
                "not_in_channel" -> getString(R.string.error_ptt_not_in_channel)
                else -> reason
            }
            showError(message)
        }
    }

    override fun onSpeakerStarted(speakerId: String, speakerName: String) {
        runOnUiThread {
            if (speakerId != service?.myClientId) {
                binding.textSpeaker.text = getString(R.string.label_speaking_prefix, speakerName)
                binding.layoutSpeaking.visibility = View.VISIBLE
                setPttButtonColor(R.color.ptt_receiving)
            }
            usersAdapter.update(lastUsers, speakerId, service?.myClientId)
        }
    }

    override fun onSpeakerStopped() {
        runOnUiThread {
            binding.layoutSpeaking.visibility = View.GONE
            setPttButtonColor(R.color.ptt_idle)
            binding.btnPtt.text = getString(R.string.btn_ptt)
            usersAdapter.update(lastUsers, null, service?.myClientId)
        }
    }

    override fun onServerError(message: String) {
        runOnUiThread {
            val long = message.contains("administrador", ignoreCase = true)
            showError(message, long)
        }
    }

    override fun onAuthFailed() {
        runOnUiThread {
            Toast.makeText(this, R.string.error_login_failed, Toast.LENGTH_LONG).show()
            val intent = Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            startActivity(intent)
            finish()
        }
    }

    override fun onCallStarted(peerId: String, peerName: String) {
        runOnUiThread {
            binding.textCallWith.text = getString(R.string.label_call_with, peerName)
            binding.layoutCall.visibility = View.VISIBLE
            binding.layoutSpeaking.visibility = View.GONE
        }
    }

    override fun onCallEnded(reason: String) {
        runOnUiThread {
            binding.layoutCall.visibility = View.GONE
            setPttButtonColor(R.color.ptt_idle)
            binding.btnPtt.text = getString(R.string.btn_ptt)
            showError(
                if (reason == "peer_disconnected") getString(R.string.call_ended_peer_disconnected)
                else getString(R.string.call_ended_hangup)
            )
        }
    }

    override fun onCallDenied(reason: String) {
        runOnUiThread {
            val message = when (reason) {
                "already_in_call" -> getString(R.string.error_call_already_in_call)
                "target_offline" -> getString(R.string.error_call_target_offline)
                else -> getString(R.string.error_call_not_found)
            }
            showError(message)
        }
    }

    private fun showError(message: String, long: Boolean = false) {
        Snackbar.make(binding.root, message, if (long) Snackbar.LENGTH_LONG else Snackbar.LENGTH_SHORT).show()
    }

    private fun setPttButtonColor(colorRes: Int) {
        val drawable = ContextCompat.getDrawable(this, R.drawable.ptt_button_bg)?.mutate()
        drawable?.setTint(ContextCompat.getColor(this, colorRes))
        binding.btnPtt.background = drawable
    }

    private fun setChipColor(colorRes: Int) {
        val drawable = ContextCompat.getDrawable(this, R.drawable.bg_chip_pill)?.mutate()
        drawable?.setTint(ContextCompat.getColor(this, colorRes))
        binding.textStatus.background = drawable
    }
}
