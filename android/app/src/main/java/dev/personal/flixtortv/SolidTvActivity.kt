package dev.personal.flixtortv

import android.app.Activity
import android.app.AlertDialog
import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.text.InputType
import android.view.inputmethod.EditorInfo
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Android supplies platform capabilities. Application state lives in the bundled SolidTV app. */
class SolidTvActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var player: NativePlayer
    private lateinit var capabilities: NativeCapabilities
    private var input: AlertDialog? = null
    private var recovery = 0
    private var ready = false
    private var destroyed = false
    private var voiceRequest: Pair<String, (JSONObject) -> Unit>? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this)
        setContentView(root)
        player = NativePlayer(this, root) { emit("player", it) }
        capabilities = NativeCapabilities(this, player, ::emit)
        createWeb(root)
    }
    private fun createWeb(root: FrameLayout) {
        ready = false
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/art/", capabilities.artwork).build()
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            settings.setSupportMultipleWindows(false)
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    return loader.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), "".byteInputStream())
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                    request.url.scheme != "https" || request.url.host != "appassets.androidplatform.net"
                override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                    player.suspendPlayback()
                    root.removeView(view); view.destroy()
                    if (recovery++ == 0) createWeb(root) else AlertDialog.Builder(this@SolidTvActivity)
                        .setMessage("The TV interface stopped. Restart the app to continue.")
                        .setPositiveButton("Close") { _, _ -> finish() }.show()
                    return true
                }
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            AlertDialog.Builder(this).setMessage("Update Android System WebView to run this app.")
                .setPositiveButton("Close") { _, _ -> finish() }.show()
            return
        }
        WebViewCompat.addWebMessageListener(web, "nativeHost", setOf("https://appassets.androidplatform.net")) { _, message, origin, mainFrame, reply ->
            if (destroyed || isFinishing) return@addWebMessageListener
            if (!mainFrame || origin.toString() != "https://appassets.androidplatform.net") return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > 2_000_000) return@addWebMessageListener
            val request = runCatching { JSONObject(raw) }.getOrNull() ?: return@addWebMessageListener
            if (request.optInt("v") != 1) return@addWebMessageListener
            val id = request.optString("id")
            val method = request.optString("method")
            val args = request.optJSONObject("args") ?: JSONObject()
            if (method == "ready") ready = true
            if (method == "cancel" && args.optString("id").isNotEmpty()) {
                capabilities.call(id, method, args) { result -> reply.postMessage(result.toString()) }
            } else if (method == "input") {
                val edit = EditText(this).apply {
                    setSingleLine(); setText(args.optString("value")); hint = args.optString("label")
                    inputType = when (args.optString("mode")) {
                        "integer", "pin" -> InputType.TYPE_CLASS_NUMBER
                        "time" -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                        else -> if (args.optBoolean("secret")) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT
                    }
                    setTextColor(Color.rgb(245, 248, 255)); setHintTextColor(Color.rgb(183, 196, 213))
                    textSize = 22f; setPadding(28, 22, 28, 22)
                    background = GradientDrawable().apply { setColor(Color.rgb(24, 33, 46)); cornerRadius = 24f }
                    imeOptions = if (args.optString("action") == "search") EditorInfo.IME_ACTION_SEARCH else EditorInfo.IME_ACTION_DONE
                }
                val search = args.optString("action") == "search"
                input = AlertDialog.Builder(this).setTitle(args.optString("label")).setView(edit)
                    .setPositiveButton(if (search) "Search" else "Done") { _, _ -> reply.postMessage(response(id, edit.text.toString()).toString()) }
                    .setNegativeButton("Cancel") { _, _ -> reply.postMessage(response(id, JSONObject.NULL).toString()) }
                    .setOnCancelListener { reply.postMessage(response(id, JSONObject.NULL).toString()) }.create()
                input?.show()
                input?.window?.apply {
                    setBackgroundDrawable(GradientDrawable().apply { setColor(Color.rgb(24, 33, 46)); cornerRadius = 32f })
                    setLayout((resources.displayMetrics.widthPixels * 0.65).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
                    setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                }
                edit.setOnEditorActionListener { _, action, _ ->
                    if (action == EditorInfo.IME_ACTION_SEARCH || action == EditorInfo.IME_ACTION_GO || action == EditorInfo.IME_ACTION_DONE) {
                        input?.getButton(AlertDialog.BUTTON_POSITIVE)?.performClick(); true
                    } else false
                }
                edit.requestFocus()
            } else if (method == "voice.search") {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PROMPT, "Search")
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }
                if (!SpeechRecognizer.isRecognitionAvailable(this) || intent.resolveActivity(packageManager) == null) {
                    reply.postMessage(response(id, JSONObject.NULL).toString())
                } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    voiceRequest = id to { value -> reply.postMessage(value.toString()) }
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), VOICE_PERMISSION)
                } else {
                    voiceRequest = id to { value -> reply.postMessage(value.toString()) }
                    try { startActivityForResult(intent, VOICE_REQUEST) }
                    catch (_: Exception) {
                        voiceRequest = null
                        reply.postMessage(response(id, JSONObject.NULL).toString())
                    }
                }
            } else capabilities.call(id, method, args) { result -> reply.postMessage(result.toString()) }
        }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        player.attachSubtitles(root)
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html" + if (BuildConfig.DEBUG && intent.getBooleanExtra("solidQA", false)) "?qa=1" else "")
        web.requestFocus()
    }
    private fun response(id: String, value: Any?) = JSONObject().put("v", 1).put("id", id).put("value", value)
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != VOICE_REQUEST) return
        val request = voiceRequest ?: return
        voiceRequest = null
        val text = if (resultCode == Activity.RESULT_OK)
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        else null
        request.second(response(request.first, text))
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != VOICE_PERMISSION) return
        val request = voiceRequest ?: return
        voiceRequest = null
        if (grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Search")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            try {
                voiceRequest = request.first to request.second
                startActivityForResult(intent, VOICE_REQUEST)
            } catch (_: Exception) {
                voiceRequest = null
                request.second(response(request.first, JSONObject.NULL))
            }
        } else request.second(response(request.first, JSONObject.NULL))
    }
    private fun emit(type: String, value: JSONObject) {
        if (!ready || destroyed || isFinishing || !::web.isInitialized) return
        runOnUiThread { if (!destroyed && ready && !isFinishing) web.evaluateJavascript("window.__platformEvent?.(${JSONObject().put("type", type).put("value", value)});", null) }
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (input?.isShowing == true) return super.dispatchKeyEvent(event)
        if (event.keyCode in listOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY,
                KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_PREVIOUS,
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_REWIND)) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) emit("key", JSONObject().put("code", event.keyCode))
            return true
        }
        return super.dispatchKeyEvent(event)
    }
    override fun onStop() {
        input?.cancel()
        if (::player.isInitialized) player.suspendPlayback()
        emit("lifecycle", JSONObject().put("foreground", false))
        super.onStop()
    }
    override fun onResume() { super.onResume(); emit("lifecycle", JSONObject().put("foreground", true)) }
    override fun onDestroy() {
        destroyed = true; ready = false
        if (::web.isInitialized && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(web, "nativeHost")
        input?.dismiss()
        if (::capabilities.isInitialized) capabilities.close()
        if (::player.isInitialized) player.close()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
    companion object {
        private const val VOICE_REQUEST = 9123
        private const val VOICE_PERMISSION = 9124
    }
}
