// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// Opens the system "Save as" and "Open" screens for CSV files. They use
// Android's Storage Access Framework, so spur needs no storage permission and
// only ever sees the one file the person picks.

package io.github.dabaneghassan.spur

import android.app.Activity
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null
    private var pendingBytes: ByteArray? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            if (pending != null) {
                result.error("busy", "A file screen is already open.", null)
                return@setMethodCallHandler
            }
            when (call.method) {
                "save" -> {
                    pending = result
                    pendingBytes = call.argument<ByteArray>("bytes") ?: ByteArray(0)
                    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "text/csv"
                        putExtra(Intent.EXTRA_TITLE, call.argument<String>("name") ?: "spur-runs.csv")
                    }
                    launch(intent, SAVE)
                }
                "open" -> {
                    pending = result
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, CSV_TYPES)
                    }
                    launch(intent, OPEN)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun launch(intent: Intent, code: Int) {
        try {
            startActivityForResult(intent, code)
        } catch (e: Exception) {
            reply(error = "This phone has no app for choosing files.")
        }
    }

    @Deprecated("Deprecated in Android, still the simplest way inside FlutterActivity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != SAVE && requestCode != OPEN) return
        val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
        if (uri == null) {
            reply(value = null) // the person cancelled
            return
        }
        try {
            if (requestCode == SAVE) {
                val out = contentResolver.openOutputStream(uri, "w") ?: throw IllegalStateException("Could not write the file.")
                out.use { it.write(pendingBytes ?: ByteArray(0)) }
                reply(value = true)
            } else {
                val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("Could not read the file.")
                val bytes = input.use { it.readBytes() }
                if (bytes.size > MAX_IMPORT) reply(error = "That file is larger than 5 MB.") else reply(value = bytes)
            }
        } catch (e: Exception) {
            reply(error = e.message ?: "Could not use that file.")
        }
    }

    private fun reply(value: Any? = null, error: String? = null) {
        val result = pending ?: return
        pending = null
        pendingBytes = null
        if (error != null) result.error("file", error, null) else result.success(value)
    }

    companion object {
        private const val CHANNEL = "spur/files"
        private const val SAVE = 4219
        private const val OPEN = 4220
        private const val MAX_IMPORT = 5 * 1024 * 1024
        private val CSV_TYPES = arrayOf(
            "text/csv",
            "text/comma-separated-values",
            "text/plain",
            "application/csv",
            "application/vnd.ms-excel",
            "application/octet-stream",
        )
    }
}
