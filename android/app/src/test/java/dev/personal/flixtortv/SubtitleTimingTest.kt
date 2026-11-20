package dev.personal.flixtortv

import org.junit.Assert.assertEquals
import org.junit.Test

class SubtitleTimingTest {
    @Test fun parsesWebVttAndSubRipTimestampsAndCueText() {
        val cues = SubtitleTiming.parse(
            """WEBVTT

            00:00:01.250 --> 00:00:03.500
            <i>Hello</i>
            there

            00:01.500 --> 00:02.000
            Second cue

            00:00:04,000 --> 00:00:03,000
            Invalid
            """.trimIndent()
        )
        assertEquals(listOf(TimedSubtitleCue(1250, 3500, "Hello\nthere"), TimedSubtitleCue(1500, 2000, "Second cue")), cues)
    }

    @Test fun positiveDelayShowsCaptionsLaterAndNegativeDelayEarlier() {
        val cue = TimedSubtitleCue(1000, 2000, "Hello")
        assertEquals(emptyList<TimedSubtitleCue>(), SubtitleTiming.activeAt(listOf(cue), 1499, 500))
        assertEquals(listOf(cue), SubtitleTiming.activeAt(listOf(cue), 1500, 500))
        assertEquals(listOf(cue), SubtitleTiming.activeAt(listOf(cue), 500, -500))
    }
}
