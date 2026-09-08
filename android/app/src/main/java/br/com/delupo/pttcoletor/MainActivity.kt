package br.com.delupo.pttcoletor

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import br.com.delupo.pttcoletor.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences
    private val nsdDiscovery by lazy { NsdDiscovery(this) }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val micGranted = result[Manifest.permission.RECORD_AUDIO] ?: hasMicPermission()
        binding.layoutMicWarning.visibility = if (micGranted) android.view.View.GONE else android.view.View.VISIBLE
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = getSharedPreferences("ptt_prefs", MODE_PRIVATE)

        binding.editUsername.setText(prefs.getString("username", ""))
        binding.editName.setText(prefs.getString("name", ""))
        binding.editServer.setText(prefs.getString("server", ""))

        binding.editUsername.doAfterTextChanged {
            if (binding.editName.text.isNullOrBlank()) {
                binding.editName.setText(binding.editUsername.text)
            }
        }

        requestNeededPermissions()

        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        binding.btnOpenAppSettings.setOnClickListener {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        }

        binding.btnDiscover.setOnClickListener {
            showDiscoveryStatus(getString(R.string.discovery_searching), R.drawable.ic_wifi, R.color.color_text_secondary)
            nsdDiscovery.discover(
                onFound = { host, port ->
                    runOnUiThread {
                        binding.editServer.setText("$host:$port")
                        showDiscoveryStatus(
                            getString(R.string.discovery_found, "$host:$port"),
                            R.drawable.ic_check_circle,
                            R.color.color_success
                        )
                    }
                },
                onNotFound = {
                    runOnUiThread {
                        showDiscoveryStatus(getString(R.string.discovery_not_found), R.drawable.ic_error, R.color.color_error)
                    }
                }
            )
        }

        binding.btnConnect.setOnClickListener {
            val username = binding.editUsername.text.toString().trim()
            val password = binding.editPassword.text.toString()
            val name = binding.editName.text.toString().trim()
            val server = binding.editServer.text.toString().trim()

            binding.inputLayoutUsername.error = if (username.isEmpty()) getString(R.string.error_fill_fields) else null
            binding.inputLayoutPassword.error = if (password.isEmpty()) getString(R.string.error_fill_fields) else null
            binding.inputLayoutName.error = if (name.isEmpty()) getString(R.string.error_fill_fields) else null
            binding.inputLayoutServer.error = if (server.isEmpty()) getString(R.string.error_fill_fields) else null
            if (username.isEmpty() || password.isEmpty() || name.isEmpty() || server.isEmpty()) return@setOnClickListener

            prefs.edit().putString("username", username).putString("name", name).putString("server", server).apply()
            val intent = Intent(this, PttActivity::class.java)
                .putExtra(PttActivity.EXTRA_SERVER, server)
                .putExtra(PttActivity.EXTRA_USERNAME, username)
                .putExtra(PttActivity.EXTRA_PASSWORD, password)
                .putExtra(PttActivity.EXTRA_NAME, name)
            startActivity(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        binding.layoutMicWarning.visibility = if (hasMicPermission()) android.view.View.GONE else android.view.View.VISIBLE
    }

    override fun onDestroy() {
        nsdDiscovery.stop()
        super.onDestroy()
    }

    private fun showDiscoveryStatus(text: String, iconRes: Int, colorRes: Int) {
        binding.layoutDiscoveryStatus.visibility = android.view.View.VISIBLE
        binding.textDiscoveryStatus.text = text
        binding.textDiscoveryStatus.setTextColor(ContextCompat.getColor(this, colorRes))
        binding.iconDiscoveryStatus.setImageResource(iconRes)
        binding.iconDiscoveryStatus.imageTintList = ContextCompat.getColorStateList(this, colorRes)
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun requestNeededPermissions() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }
}
