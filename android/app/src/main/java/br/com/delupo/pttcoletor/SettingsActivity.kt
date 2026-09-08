package br.com.delupo.pttcoletor

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import br.com.delupo.pttcoletor.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private var listening = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }

        binding.btnLearnKey.setOnClickListener {
            listening = true
            binding.textListening.visibility = View.VISIBLE
        }

        binding.btnRemoveKey.setOnClickListener {
            HardwareKeyPrefs.clear(this)
            Toast.makeText(this, R.string.hardware_key_removed_toast, Toast.LENGTH_SHORT).show()
            updateCurrentMappingText()
        }

        binding.btnSetManualKey.setOnClickListener {
            val raw = binding.editManualKeyCode.text.toString().trim().uppercase()
            if (raw.isEmpty()) return@setOnClickListener
            val symbolicName = if (raw.startsWith("KEYCODE_")) raw else "KEYCODE_$raw"
            val code = KeyEvent.keyCodeFromString(symbolicName)
            if (code == KeyEvent.KEYCODE_UNKNOWN) {
                Toast.makeText(this, R.string.hardware_key_manual_invalid, Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            HardwareKeyPrefs.setKeyCode(this, code)
            binding.editManualKeyCode.setText("")
            Toast.makeText(this, getString(R.string.hardware_key_mapped_toast, symbolicName), Toast.LENGTH_LONG).show()
            updateCurrentMappingText()
        }

        binding.textAccessibilityInstructions.text =
            getString(R.string.accessibility_instructions, getString(R.string.accessibility_service_label))

        binding.btnOpenAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        binding.btnRequestBattery.setOnClickListener {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }

        updateCurrentMappingText()
    }

    override fun onResume() {
        super.onResume()
        updateAccessibilityStatus()
        updateBatteryStatus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (listening && event.action == KeyEvent.ACTION_DOWN && event.keyCode != KeyEvent.KEYCODE_BACK) {
            listening = false
            binding.textListening.visibility = View.GONE
            HardwareKeyPrefs.setKeyCode(this, event.keyCode)
            val keyName = KeyEvent.keyCodeToString(event.keyCode)
            Toast.makeText(this, getString(R.string.hardware_key_mapped_toast, keyName), Toast.LENGTH_LONG).show()
            updateCurrentMappingText()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun updateCurrentMappingText() {
        val code = HardwareKeyPrefs.getKeyCode(this)
        binding.textCurrentMapping.text = if (code == NO_HARDWARE_KEY) {
            getString(R.string.hardware_key_none)
        } else {
            getString(R.string.hardware_key_mapped, KeyEvent.keyCodeToString(code))
        }
    }

    private fun updateAccessibilityStatus() {
        binding.textAccessibilityStatus.text = if (isAccessibilityServiceEnabled()) {
            getString(R.string.accessibility_status_enabled)
        } else {
            getString(R.string.accessibility_status_disabled)
        }
    }

    private fun updateBatteryStatus() {
        val powerManager = ContextCompat.getSystemService(this, PowerManager::class.java)
        val exempt = powerManager?.isIgnoringBatteryOptimizations(packageName) == true
        binding.textBatteryStatus.text = if (exempt) {
            getString(R.string.battery_status_exempt)
        } else {
            getString(R.string.battery_status_not_exempt)
        }
        binding.btnRequestBattery.isEnabled = !exempt
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expectedComponent = "$packageName/${PttAccessibilityService::class.java.name}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.split(':').any { it.equals(expectedComponent, ignoreCase = true) }
    }
}
