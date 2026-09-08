package br.com.delupo.pttcoletor

import android.content.Context
import android.view.KeyEvent

private const val PREFS_NAME = "ptt_prefs"
private const val KEY_HARDWARE_KEYCODE = "hardware_ptt_keycode"
const val NO_HARDWARE_KEY = 0

/**
 * Mapeamento de fábrica do botão físico do PTT — os coletores Zebra usados aqui têm o botão
 * lateral configurado para simular essa tecla, então já funciona sem precisar de nenhuma
 * configuração manual. Continua ajustável em Configurações (aprender outro botão, digitar o
 * nome de outra tecla, ou remover o mapeamento).
 */
private const val DEFAULT_HARDWARE_KEY = KeyEvent.KEYCODE_BUTTON_L2

object HardwareKeyPrefs {

    fun getKeyCode(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_HARDWARE_KEYCODE, DEFAULT_HARDWARE_KEY)
    }

    fun setKeyCode(context: Context, keyCode: Int) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_HARDWARE_KEYCODE, keyCode).apply()
    }

    fun clear(context: Context) {
        setKeyCode(context, NO_HARDWARE_KEY)
    }
}
