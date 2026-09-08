package br.com.delupo.pttcoletor

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Permite que o botão físico do PTT (mapeado em HardwareKeyPrefs) funcione mesmo quando outro
 * app está em primeiro plano — dispensa root ou SDK proprietário do fabricante. Complementa o
 * PttActivity.dispatchKeyEvent (que só funciona com o app na tela); ativar esse serviço em
 * Configurações estende a captura da tecla para o sistema inteiro.
 */
class PttAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo?.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        }
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val mappedKeyCode = HardwareKeyPrefs.getKeyCode(this)
        val service = PttConnectionService.instance
        if (mappedKeyCode == NO_HARDWARE_KEY || service == null || event.keyCode != mappedKeyCode) {
            return false
        }
        when (event.action) {
            KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) service.startTalking()
            KeyEvent.ACTION_UP -> service.stopTalking()
        }
        return true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Não precisamos de eventos de tela, só da filtragem de teclas acima.
    }

    override fun onInterrupt() {
        // Nada a fazer.
    }
}
