package dev.personal.flixtortv

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.media3.common.*
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionResult
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import com.google.common.util.concurrent.Futures
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors

@androidx.annotation.OptIn(UnstableApi::class)
internal class NativePlayer(private val activity: Activity, root: FrameLayout, private val emit: (JSONObject) -> Unit) {
    private data class SubtitleSource(val uri: String, val label: String)
    private val videoFrame = AspectRatioFrameLayout(activity).apply {
        setBackgroundColor(Color.BLACK)
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
    private val surface = SurfaceView(activity)
    private val subtitles = SubtitleView(activity)
    private var player: ExoPlayer? = null
    private var session: MediaSession? = null
    private var identity = ""
    private var checkpoint: JSONObject? = null
    private val handler = Handler(Looper.getMainLooper())
    private val subtitleExecutor = Executors.newSingleThreadExecutor()
    private var loadControl: PlaybackBuffer? = null
    private var subtitleSources = emptyList<SubtitleSource>()
    private var subtitleHeaders = emptyMap<String, String>()
    private var subtitleClient = "public"
    private var selectedSubtitleUri: String? = null
    private var subtitleGeneration = 0
    private var timedCues = emptyList<TimedSubtitleCue>()
    private var manualSubtitles = false
    private var renderedCueText: List<String>? = null
    private var subtitleDelayMs = 0L
    var client: (String) -> okhttp3.OkHttpClient = { okhttp3.OkHttpClient() }
    private val tick = object : Runnable {
        override fun run() { player?.let { updateTimedSubtitles(it); emit(snapshot(it)) }; handler.postDelayed(this, 250) }
    }
    init {
        videoFrame.addView(surface, FrameLayout.LayoutParams(-1, -1))
        root.addView(videoFrame, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        handler.post(tick)
    }
    fun attachSubtitles(root: FrameLayout) {
        (subtitles.parent as? android.view.ViewGroup)?.removeView(subtitles)
        root.addView(subtitles, FrameLayout.LayoutParams(-1, -1))
        subtitles.isFocusable = false; subtitles.importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun load(args: JSONObject) {
        val nextId = args.getString("id"); require(nextId.length in 1..200)
        val uri = args.getString("uri")
        require(uri.startsWith("https://") || BuildConfig.DEBUG && uri.startsWith("asset:///qa-"))
        player?.release(); session?.release()
        subtitleGeneration++
        selectedSubtitleUri = null; timedCues = emptyList(); manualSubtitles = false; renderedCueText = null
        subtitles.setCues(emptyList())
        identity = nextId
        applyVideoFit(args.optString("videoFit", "native"))
        checkpoint = args.optJSONObject("checkpoint")
        val headers = args.optJSONObject("headers") ?: JSONObject()
        val values = headers.keys().asSequence().associateWith { headers.getString(it) }
        subtitleHeaders = values
        subtitleClient = args.optString("client", "public")
        subtitleDelayMs = args.optLong("subtitleDelay", 0).coerceIn(-5000, 5000)
        applySubtitleStyle(args.optString("subtitleSize", "medium"), args.optString("subtitleAppearance", "shadow"))
        val http = OkHttpDataSource.Factory(client(args.optString("client", "public"))).setDefaultRequestProperties(values)
        val buffer = PlaybackBuffer().apply { larger = args.optBoolean("largerBuffer") }; loadControl = buffer
        val p = ExoPlayer.Builder(activity).setLoadControl(buffer)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(activity, http))).build()
        player = p
        p.setVideoSurfaceView(surface)
        p.setAudioAttributes(AudioAttributes.DEFAULT, true); p.setHandleAudioBecomingNoisy(true)
        val tracks = args.optJSONArray("captions") ?: JSONArray()
        subtitleSources = (0 until tracks.length()).map { i ->
            val c = tracks.getJSONObject(i)
            SubtitleSource(c.getString("uri"), c.optString("label"))
        }
        val captions = (0 until tracks.length()).map { i ->
            val c = tracks.getJSONObject(i)
            require(c.getString("uri").startsWith("https://"))
            val captionUri = c.getString("uri").let { if (BuildConfig.DEBUG && activity.intent.getBooleanExtra("solidQA", false) && it.startsWith("https://fixture.example/")) "asset:///" + it.substringAfterLast('/') else it }
            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(captionUri))
                .setLabel(c.optString("label")).setMimeType(c.optString("mime", "text/vtt"))
                .setSelectionFlags(if (c.optBoolean("default")) C.SELECTION_FLAG_DEFAULT else 0).build()
        }
        p.addListener(object : Player.Listener {
            override fun onCues(group: androidx.media3.common.text.CueGroup) { if (player === p && !manualSubtitles) subtitles.setCues(group.cues) }
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (player !== p) return
                val width = videoSize.width
                val height = videoSize.height
                if (width <= 0 || height <= 0) {
                    videoFrame.setAspectRatio(0f)
                    return
                }
                var aspectRatio = width * videoSize.pixelWidthHeightRatio / height
                if (videoSize.unappliedRotationDegrees == 90 || videoSize.unappliedRotationDegrees == 270) {
                    aspectRatio = 1f / aspectRatio
                }
                videoFrame.setAspectRatio(aspectRatio)
            }
            override fun onPlayerError(error: PlaybackException) {
                if (player === p) emit(snapshot(p).put("error", error.errorCodeName))
            }
            override fun onTracksChanged(tracks: Tracks) { if (player === p) { syncSubtitleSelection(p); emit(snapshot(p)) } }
            override fun onPlaybackStateChanged(state: Int) { if (player === p) emit(snapshot(p)) }
        })
        val mediaUri = if (BuildConfig.DEBUG && activity.intent.getBooleanExtra("solidQA", false) && uri.startsWith("https://fixture.example/")) "asset:///" + uri.substringAfterLast('/') else uri
        p.setMediaItem(MediaItem.Builder().setUri(mediaUri).setMimeType(args.optString("mime", "application/x-mpegURL"))
            .setSubtitleConfigurations(captions).build(), args.optLong("position", 0).coerceAtLeast(0))
        p.prepare(); p.playWhenReady = args.optBoolean("play", true)
        session = MediaSession.Builder(activity, p).setCallback(object : MediaSession.Callback {
            override fun onPlayerCommandRequest(s: MediaSession, controller: MediaSession.ControllerInfo, command: Int): Int {
                emit(snapshot(p).put("command", command)); return SessionResult.RESULT_SUCCESS
            }
        }).build()
        quality(args.optInt("quality"))
    }
    private fun snapshot(p: ExoPlayer): JSONObject {
        val tracks = JSONArray()
        p.currentTracks.groups.forEachIndexed { groupIndex, group ->
            for (i in 0 until group.length) {
                val format = group.getTrackFormat(i)
                tracks.put(JSONObject().put("id", "$groupIndex:$i").put("type", group.type)
                    .put("label", format.label ?: format.language ?: if (format.height > 0) "${format.height}p" else "Track ${i + 1}")
                    .put("selected", group.isTrackSelected(i)).put("supported", group.isTrackSupported(i)))
            }
        }
        return JSONObject().put("id", identity).put("position", p.currentPosition.coerceAtLeast(0))
            .put("duration", p.duration.coerceAtLeast(0)).put("buffered", p.bufferedPosition.coerceAtLeast(0))
            .put("bytes", loadControl?.allocator?.totalBytesAllocated ?: 0).put("byteLimit", loadControl?.byteTarget ?: 0)
            .put("playing", p.isPlaying).put("playRequested", p.playWhenReady)
            .put("buffering", p.playbackState == Player.STATE_BUFFERING).put("ended", p.playbackState == Player.STATE_ENDED)
            .put("time", android.os.SystemClock.elapsedRealtime()).put("tracks", tracks)
    }
    fun command(args: JSONObject) {
        if (args.getString("id") != identity) return
        val p = player ?: return
        when (args.getString("action")) {
            "play" -> p.play()
            "pause" -> p.pause()
            "seek" -> p.seekTo(args.getLong("position").coerceAtLeast(0))
            "quality" -> quality(args.getInt("height"))
            "video-fit" -> applyVideoFit(args.optString("fit", "native"))
            "buffer" -> loadControl?.larger = args.getBoolean("enabled")
            "stop" -> { suspendPlayback(); p.release(); player = null; session?.release(); session = null; subtitles.setCues(emptyList()) }
            "track" -> {
                val type = args.getInt("type")
                val selected = args.optString("track")
                val params = p.trackSelectionParameters.buildUpon().clearOverridesOfType(type).setTrackTypeDisabled(type, selected == "off")
                if (selected != "off" && selected != "auto") {
                    val parts = selected.split(":").map(String::toInt)
                    val group = p.currentTracks.groups.getOrNull(parts[0]) ?: return
                    require(group.type == type && parts[1] in 0 until group.length)
                    params.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, parts[1]))
                }
                p.trackSelectionParameters = params.build()
            }
            "captions" -> {
                val left = args.optDouble("left", 0.05).coerceIn(0.0, 0.45)
                val right = args.optDouble("right", 0.05).coerceIn(0.0, 0.45)
                val bottom = args.optDouble("bottom", 0.08).coerceIn(0.0, 0.7)
                subtitles.setPadding((surface.width * left).toInt(), 0, (surface.width * right).toInt(), (surface.height * bottom).toInt())
            }
            "caption-style" -> {
                subtitleDelayMs = args.optLong("delay", subtitleDelayMs).coerceIn(-5000, 5000)
                applySubtitleStyle(args.optString("size", "medium"), args.optString("appearance", "shadow"))
                updateTimedSubtitles(p)
            }
        }
    }
    private fun applySubtitleStyle(size: String, appearance: String) {
        subtitles.setApplyEmbeddedStyles(false); subtitles.setApplyEmbeddedFontSizes(false)
        subtitles.setFractionalTextSize(when (size) { "small" -> 0.045f; "large" -> 0.07f; else -> 0.055f })
        val background = when (appearance) {
            "boxed" -> 0xcc000000.toInt()
            "shadow" -> 0x22000000
            else -> Color.TRANSPARENT
        }
        val edgeType = when (appearance) {
            "outline" -> CaptionStyleCompat.EDGE_TYPE_OUTLINE
            "shadow" -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW
            else -> CaptionStyleCompat.EDGE_TYPE_NONE
        }
        subtitles.setStyle(CaptionStyleCompat(Color.WHITE, background, Color.TRANSPARENT, edgeType, Color.BLACK, Typeface.DEFAULT))
    }
    private fun syncSubtitleSelection(p: ExoPlayer) {
        val label = p.currentTracks.groups.asSequence()
            .filter { it.type == C.TRACK_TYPE_TEXT }
            .flatMap { group -> (0 until group.length).asSequence().filter { group.isTrackSelected(it) }.map { group.getTrackFormat(it).label ?: group.getTrackFormat(it).language.orEmpty() } }
            .firstOrNull()
        val source = label?.let { selected -> subtitleSources.firstOrNull { it.label.equals(selected, true) } }
            ?: if (label != null && subtitleSources.size == 1) subtitleSources.single() else null
        if (source?.uri == selectedSubtitleUri) return
        selectedSubtitleUri = source?.uri
        subtitleGeneration++
        val generation = subtitleGeneration
        manualSubtitles = false; timedCues = emptyList(); renderedCueText = null
        subtitles.setCues(emptyList())
        if (source == null || !source.uri.startsWith("https://") || source.uri.startsWith("https://fixture.example/")) return
        subtitleExecutor.execute {
            try {
                val request = Request.Builder().url(source.uri).apply { subtitleHeaders.forEach { (name, value) -> header(name, value) } }.build()
                val cues = client(subtitleClient).newCall(request).execute().use { response ->
                    val body = response.body
                    if (!response.isSuccessful || body == null || body.contentLength() > 4_000_000) {
                        if (!response.isSuccessful) Log.w(TAG, "Subtitle timing fetch returned HTTP ${response.code}")
                        emptyList()
                    } else {
                        val bytes = body.byteStream().use { input ->
                            val output = ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            while (output.size() <= 4_000_000) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                            output.toByteArray()
                        }
                        if (bytes.size > 4_000_000) emptyList() else SubtitleTiming.parse(String(bytes, Charsets.UTF_8))
                    }
                }
                if (cues.isEmpty()) return@execute
                handler.post {
                    if (generation == subtitleGeneration && selectedSubtitleUri == source.uri && player === p) {
                        timedCues = cues; manualSubtitles = true; renderedCueText = null; updateTimedSubtitles(p)
                    }
                }
            } catch (error: IOException) {
                Log.w(TAG, "Could not read subtitle timing data; using native subtitle rendering", error)
            }
        }
    }
    private fun updateTimedSubtitles(p: ExoPlayer) {
        if (!manualSubtitles || player !== p) return
        val active = SubtitleTiming.activeAt(timedCues, p.currentPosition, subtitleDelayMs)
        val text = active.map { it.text }
        if (text == renderedCueText) return
        renderedCueText = text
        subtitles.setCues(active.map { Cue.Builder().setText(it.text).build() })
    }
    private fun quality(height: Int) {
        require(height in listOf(0, 720, 1080, 2160))
        player?.let { it.trackSelectionParameters = it.trackSelectionParameters.buildUpon().setMaxVideoSize(Int.MAX_VALUE, if (height == 0) Int.MAX_VALUE else height).build() }
    }
    private fun applyVideoFit(fit: String) {
        videoFrame.resizeMode = if (fit == "fill") AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
    fun suspendPlayback() {
        player?.let { p ->
            checkpoint?.let { c ->
                c.put("position", p.currentPosition.coerceAtLeast(0)).put("duration", p.duration.coerceAtLeast(0))
                activity.getSharedPreferences("solidtv", 0).edit().putString("checkpoint", c.toString()).commit()
            }
            p.pause()
        }
    }
    fun close() { handler.removeCallbacks(tick); subtitleGeneration++; subtitleExecutor.shutdownNow(); suspendPlayback(); session?.release(); player?.release(); player = null }
    private companion object { const val TAG = "NativePlayer" }
}
