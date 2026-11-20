import { createEffect, createSignal, For, onCleanup, onMount } from 'solid-js';
import { activeElement, type ElementNode } from '@solidtv/solid';
import { useApp } from '../app/context';
import { activeScope, focusElement, nodeRect, registerFocus, trackFrame } from './focus';
import { palette, time } from './theme';

export function Timeline(props: { width: number; onUp?(): boolean; displayOnly?: boolean }) {
  const player = useApp().playback!;
  let node: ElementNode | undefined, input: HTMLInputElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const position = () => props.displayOnly
    ? player.state.seekHudPosition ?? player.state.event?.position ?? 0
    : player.state.preview ?? player.state.event?.position ?? 0;
  const duration = () => player.state.event?.duration || 1;
  if (!props.displayOnly) {
    registerFocus(() => 'player-timeline', () => node);
    onMount(() => {
      input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.step = '1000'; input.dataset.scope = 'screen';
      input.setAttribute('aria-label', 'Seek'); input.style.cssText = 'position:fixed;z-index:6;opacity:0;margin:0;cursor:pointer';
      input.onfocus = () => { focusElement(node); setFocused(true); }; input.onblur = () => setFocused(false);
      input.oninput = () => { player.preview(Number(input!.value)); };
      input.onkeydown = event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); event.stopPropagation();
          const step = Math.min(30_000, duration());
          player.preview(position() + (event.key === 'ArrowLeft' ? -step : step));
        } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
      };
      document.getElementById('semantics')!.appendChild(input);
    });
    createEffect(() => {
      const value = position(), max = duration(), isFocused = activeElement() === node, disabled = activeScope() !== 'screen';
      if (input) { input.max = String(max); input.value = String(value); input.disabled = disabled; input.setAttribute('aria-valuetext', `${time(value)} of ${time(max)}`); if (isFocused && !disabled && document.activeElement !== input) input.focus({ preventScroll: true }); }
    });
    trackFrame(() => { if (input) { const rect = nodeRect(node); Object.assign(input.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); input.hidden = !rect.visible; } });
    onCleanup(() => input?.remove());
  }
  return <view ref={node} skipFocus={props.displayOnly} width={props.width} height={84} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onUp={() => props.onUp?.() ?? false}
    onLeft={() => { if (!props.displayOnly) player.preview(position() - 30_000); return true; }} onRight={() => { if (!props.displayOnly) player.preview(position() + 30_000); return true; }}>
    <view skipFocus y={18} width={props.width} height={focused() ? 8 : 5} borderRadius={4} color={0xffffff33} />
    <view skipFocus y={18} width={props.width * Math.min(1, (player.state.event?.buffered || 0) / duration())} height={focused() ? 8 : 5} borderRadius={4} color={0xffffff66} />
    <For each={props.displayOnly ? [] : player.state.regions}>{region => <view skipFocus x={props.width * region.start / duration()} y={16} width={props.width * (region.end - region.start) / duration()} height={10} color={0xffffff44} borderRadius={3} />}</For>
    <view skipFocus y={18} width={props.width * Math.min(1, position() / duration())} height={focused() ? 8 : 5} borderRadius={4} color={focused() ? palette.accent : palette.white} />
    <view skipFocus x={Math.min(props.width - 8, props.width * position() / duration())} y={focused() ? 13 : 17} width={focused() ? 18 : 6} height={focused() ? 18 : 6} borderRadius={9} color={palette.white} />
    <text skipFocus y={45} width={props.width * 0.5} height={32} fontSize={23} color={palette.muted}>{time(position())}{!props.displayOnly && player.state.preview !== undefined ? '   ·   Seeking in 3s · Back to cancel' : ''}</text>
    <text skipFocus x={props.width * 0.5} y={45} width={props.width * 0.5} height={32} fontSize={23} textAlign="right" color={palette.muted}>{`−${time(Math.max(0, duration() - position()))}`}</text>
  </view>;
}
