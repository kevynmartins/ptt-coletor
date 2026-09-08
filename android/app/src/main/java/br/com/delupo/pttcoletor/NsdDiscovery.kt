package br.com.delupo.pttcoletor

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

private const val TAG = "NsdDiscovery"
private const val SERVICE_TYPE = "_ptt._tcp."

class NsdDiscovery(context: Context) {

    private val nsdManager = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    fun discover(onFound: (host: String, port: Int) -> Unit, onNotFound: () -> Unit, timeoutMs: Long = 4000) {
        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "Falha ao resolver serviço: $errorCode")
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                val host = serviceInfo.host?.hostAddress ?: return
                stop()
                onFound(host, serviceInfo.port)
            }
        }

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {}

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType == SERVICE_TYPE || serviceInfo.serviceType.startsWith("_ptt")) {
                    nsdManager.resolveService(serviceInfo, resolveListener)
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "Falha ao iniciar descoberta: $errorCode")
                onNotFound()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        discoveryListener = listener
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)

        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (discoveryListener != null) {
                stop()
                onNotFound()
            }
        }, timeoutMs)
    }

    fun stop() {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (_: IllegalArgumentException) {
                // já parado
            }
        }
        discoveryListener = null
    }
}
