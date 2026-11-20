package dev.personal.flixtortv

internal data class TimedSubtitleCue(val startMs: Long, val endMs: Long, val text: String)

internal object SubtitleTiming {
    private val timingLine = Regex("""(\d{2,}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})""")
    private val markup = Regex("<[^>]*>")

    fun parse(source: String): List<TimedSubtitleCue> {
        val lines = source.removePrefix("\uFEFF").lines()
        val cues = ArrayList<TimedSubtitleCue>()
        var index = 0
        while (index < lines.size && cues.size < 20_000) {
            val match = timingLine.find(lines[index])
            if (match == null) { index++; continue }
            val start = timestamp(match.groupValues[1])
            val end = timestamp(match.groupValues[2])
            index++
            val text = buildList {
                while (index < lines.size && lines[index].isNotBlank()) add(lines[index++].trim())
            }.joinToString("\n").replace(markup, "").trim().take(2000)
            if (start != null && end != null && end > start && text.isNotEmpty()) cues.add(TimedSubtitleCue(start, end, text))
        }
        return cues
    }

    fun activeAt(cues: List<TimedSubtitleCue>, positionMs: Long, delayMs: Long): List<TimedSubtitleCue> {
        val subtitlePosition = positionMs - delayMs
        return cues.filter { subtitlePosition >= it.startMs && subtitlePosition < it.endMs }
    }

    private fun timestamp(value: String): Long? {
        val parts = value.replace(',', '.').split(':')
        val seconds = parts.lastOrNull()?.toDoubleOrNull() ?: return null
        if (seconds !in 0.0..<60.0) return null
        val minutes = parts.getOrNull(parts.size - 2)?.toLongOrNull() ?: return null
        if (minutes !in 0..59) return null
        val hours = if (parts.size == 3) parts[0].toLongOrNull() ?: return null else 0L
        if (parts.size !in 2..3 || hours < 0) return null
        return (hours * 3600_000 + minutes * 60_000 + (seconds * 1000).toLong()).takeIf { it >= 0 }
    }
}
