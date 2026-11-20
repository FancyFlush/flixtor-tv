import Hls from 'hls.js';
import type { PlatformEvent, PlayerEvent, Track } from './platform';
import type { Stream } from '../domain/models';

export function browserPlayer(emit: (event: PlatformEvent) => void,
  source: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ uri: string; captions: Stream['captions'] }>) {
  let video: HTMLVideoElement | undefined, hls: Hls | undefined, id = '', generation = 0, requested = false, error: string | undefined, quality = 0;
  let subtitleSize = 'medium', subtitleAppearance = 'shadow', subtitleDelay = 0, videoFit = 'native', subtitleStyle: HTMLStyleElement | undefined;
  let cueBaseTimes = new WeakMap<TextTrackCue, { start: number; end: number }>(), observedTracks = new WeakSet<TextTrack>();
  let foreground = document.visibilityState !== 'hidden';
  const byteLimit = 96 * 1024 * 1024;
  function applySubtitleSettings() {
    if (!video) return;
    const sizes: Record<string, string> = { small: '2.8vh', medium: '3.8vh', large: '4.8vh' };
    const appearances: Record<string, string> = {
      shadow: 'background-color:rgba(0,0,0,0.12);text-shadow:1px 2px 3px #000',
      outline: 'background-color:transparent;text-shadow:2px 0 #000,-2px 0 #000,0 2px #000,0 -2px #000,1px 1px #000,-1px -1px #000',
      boxed: 'background-color:rgba(0,0,0,0.78);text-shadow:none',
    };
    if (!subtitleStyle) { subtitleStyle = document.createElement('style'); document.head.append(subtitleStyle); }
    subtitleStyle.textContent = `video::cue{font-size:${sizes[subtitleSize] || sizes.medium};color:#fff;${appearances[subtitleAppearance] || appearances.shadow}}`;
    for (const track of Array.from(video.textTracks)) {
      if (!observedTracks.has(track)) { track.addEventListener('cuechange', applySubtitleSettings); observedTracks.add(track); }
      for (const cue of Array.from(track.cues || [])) {
        const base = cueBaseTimes.get(cue) || { start: cue.startTime, end: cue.endTime };
        cueBaseTimes.set(cue, base);
        const start = base.start + subtitleDelay / 1000, end = base.end + subtitleDelay / 1000;
        if (cue.startTime !== start) cue.startTime = start;
        if (cue.endTime !== end) cue.endTime = end;
      }
    }
  }
  function tracks(): Track[] {
    const result: Track[] = (hls?.audioTracks || []).map((t, i) => ({ id: `audio:${i}`, type: 1, label: t.name || t.lang || `Audio ${i + 1}`, selected: hls!.audioTrack === i, supported: true }));
    if (video) for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i]; result.push({ id: `text:${i}`, type: 3, label: track.label || track.language || `Subtitles ${i + 1}`, selected: track.mode === 'showing', supported: true });
    }
    return result;
  }
  function snapshot(): PlayerEvent {
    const duration = video && Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    let buffered = (video?.currentTime || 0) * 1000;
    if (video) for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) buffered = video.buffered.end(i) * 1000;
    return { id, position: (video?.currentTime || 0) * 1000, duration, buffered, playing: !!video && !video.paused && !video.ended && video.readyState >= 3,
      playRequested: requested, buffering: !!video && video.readyState < 3 && !video.ended && !error, ended: video?.ended || false,
      time: performance.now(), tracks: tracks(), error, bytes: 0, byteLimit };
  }
  const publish = () => { if (id) emit({ type: 'player', value: snapshot() }); };
  function clear() {
    hls?.destroy(); hls = undefined;
    if (video) { video.pause(); video.textTracks.removeEventListener('addtrack', applySubtitleSettings); video.removeAttribute('src'); video.load(); video.remove(); video = undefined; }
    subtitleStyle?.remove(); subtitleStyle = undefined; cueBaseTimes = new WeakMap(); observedTracks = new WeakSet();
  }
  function stop() { generation++; id = ''; requested = false; error = undefined; clear(); }
  function fail(value: string) { error = value; publish(); }
  function play() {
    if (!video || !foreground) return;
    const element = video, token = generation;
    requested = true;
    void element.play().catch(e => {
      if (element !== video || token !== generation) return;
      if (e.name === 'NotAllowedError') { requested = false; publish(); }
      else if (e.name !== 'AbortError') fail('MEDIA');
    });
  }
  function capQuality() {
    if (!hls) return;
    const levels = hls.levels.map((level, i) => ({ height: level.height, i })).filter(level => level.height <= quality);
    hls.autoLevelCapping = quality ? levels.at(-1)?.i ?? 0 : -1;
  }
  async function load(args: Record<string, unknown>, signal?: AbortSignal) {
    stop(); const token = generation;
    const media = await source(args, signal);
    signal?.throwIfAborted(); if (token !== generation) return;
    id = String(args.id); quality = Number(args.quality || 0); requested = args.play !== false && foreground;
    subtitleSize = ['small', 'medium', 'large'].includes(String(args.subtitleSize)) ? String(args.subtitleSize) : 'medium';
    subtitleAppearance = ['shadow', 'outline', 'boxed'].includes(String(args.subtitleAppearance)) ? String(args.subtitleAppearance) : 'shadow';
    subtitleDelay = Math.max(-5000, Math.min(5000, Number(args.subtitleDelay) || 0));
    videoFit = args.videoFit === 'fill' ? 'fill' : 'native';
    const element = document.createElement('video'); video = element;
    element.playsInline = true; element.preload = 'auto';
    element.style.cssText = `position:fixed;inset:0;width:100%;height:100%;object-fit:${videoFit === 'fill' ? 'cover' : 'contain'};z-index:0;background:#000;pointer-events:none`;
    document.body.prepend(element);
    const canvas = document.querySelector('canvas'); if (canvas) { canvas.style.position = 'relative'; canvas.style.zIndex = '1'; }
    const position = Math.max(0, Number(args.position || 0)) / 1000;
    const current = () => token === generation && element === video;
    element.addEventListener('loadedmetadata', () => {
      if (!current()) return;
      if (position > 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(position, element.duration);
      if (requested) play(); publish();
    });
    element.addEventListener('error', () => { if (current()) fail(element.error?.code === 4 ? 'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED' : 'MEDIA'); });
    for (const event of ['play', 'pause', 'waiting', 'playing', 'seeked', 'ended']) element.addEventListener(event, () => { if (current()) publish(); });
    element.textTracks.addEventListener('addtrack', applySubtitleSettings);
    for (const caption of media.captions) {
      const track = document.createElement('track'); track.kind = 'subtitles'; track.label = caption.label; track.src = caption.uri; track.default = !!caption.default;
      track.addEventListener('load', applySubtitleSettings); element.append(track);
    }
    applySubtitleSettings();
    const isHls = /mpegurl/i.test(String(args.mime || '')) || new URL(String(args.uri)).pathname.endsWith('.m3u8');
    if (isHls && !element.canPlayType('application/vnd.apple.mpegurl')) {
      if (!Hls.isSupported()) { fail('ERROR_CODE_DECODING_FORMAT_UNSUPPORTED'); return; }
      const engine = new Hls({ startPosition: position, maxBufferLength: args.largerBuffer ? 90 : 50, maxMaxBufferLength: args.largerBuffer ? 90 : 50, maxBufferSize: byteLimit, backBufferLength: 15 });
      hls = engine;
      engine.on(Hls.Events.MANIFEST_PARSED, () => { if (current()) { capQuality(); if (requested) play(); } });
      engine.on(Hls.Events.ERROR, (_, data) => { if (current() && data.fatal) fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'ERROR_CODE_IO_BAD_HTTP_STATUS' : 'MEDIA'); });
      engine.loadSource(media.uri); engine.attachMedia(element);
    } else { element.src = media.uri; element.load(); }
  }
  function command(args: Record<string, unknown>) {
    if (args.id !== id || !video) return;
    const action = args.action;
    if (action === 'stop') { stop(); return; }
    if (action === 'play') play();
    if (action === 'pause') { requested = false; video.pause(); }
    if (action === 'seek') video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, Number(args.position || 0) / 1000));
    if (action === 'quality') { quality = Number(args.height || 0); capQuality(); }
    if (action === 'buffer' && hls) hls.config.maxBufferLength = hls.config.maxMaxBufferLength = args.enabled ? 90 : 50;
    if (action === 'video-fit') {
      videoFit = args.fit === 'fill' ? 'fill' : 'native';
      video.style.objectFit = videoFit === 'fill' ? 'cover' : 'contain';
    }
    if (action === 'caption-style') {
      if (['small', 'medium', 'large'].includes(String(args.size))) subtitleSize = String(args.size);
      if (['shadow', 'outline', 'boxed'].includes(String(args.appearance))) subtitleAppearance = String(args.appearance);
      if (Number.isFinite(Number(args.delay))) subtitleDelay = Math.max(-5000, Math.min(5000, Number(args.delay)));
      applySubtitleSettings();
    }
    if (action === 'track') {
      const track = String(args.track), index = Number(track.split(':')[1]);
      if (args.type === 1 && hls) hls.audioTrack = track === 'auto' ? 0 : index;
      if (args.type === 3) for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = track === `text:${i}` ? 'showing' : 'disabled';
    }
    publish();
  }
  const visibility = () => {
    foreground = document.visibilityState !== 'hidden';
    if (!foreground) { requested = false; video?.pause(); }
    emit({ type: 'lifecycle', value: { foreground } }); publish();
  };
  document.addEventListener('visibilitychange', visibility);
  const timer = setInterval(publish, 250);
  return { load, command, dispose() { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); stop(); } };
}
