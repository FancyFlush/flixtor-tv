import { createEffect, createSignal, For, on } from 'solid-js';
import { Column } from '@solidtv/solid/primitives';
import { Button, palette, time } from './components';
import { episodeKey, fraction, titleKey, type Episode, type Title, type Viewing } from '../domain/models';
import { episodeWindowStart, nextEpisodeWindowStart, visibleEpisodeRows } from './episode-window';

export function EpisodeList(props: { title: Title; episodes: Episode[]; viewing: Viewing[]; width: number; height: number; current?: Episode | null; initial?: Episode; autofocus?: boolean; play(episode: Episode): void }) {
  const selected = () => Math.max(0, props.episodes.findIndex(e => episodeKey(e) === episodeKey(props.initial || props.current)));
  const visibleRows = () => visibleEpisodeRows(props.height);
  const [cursor, setCursor] = createSignal(selected());
  const [windowStart, setWindowStart] = createSignal(episodeWindowStart(props.episodes.length, visibleRows(), selected()));
  const windowSize = () => visibleRows() + 2;
  const windowEpisodes = () => props.episodes.slice(windowStart(), windowStart() + windowSize());
  const selectedRow = () => Math.max(0, Math.min(cursor() - windowStart(), windowEpisodes().length - 1));
  createEffect(on([() => props.episodes, selected, visibleRows], () => {
    const index = selected();
    setCursor(index);
    setWindowStart(episodeWindowStart(props.episodes.length, visibleRows(), index));
  }, { defer: true }));
  const onSelectedChanged = (index: number) => {
    const current = windowStart() + index;
    setCursor(current);
    setWindowStart(nextEpisodeWindowStart(windowStart(), index, visibleRows(), props.episodes.length));
  };
  const row = (episode: Episode) => {
    const viewing = () => props.viewing.find(v => titleKey(v.title) === titleKey(props.title) && episodeKey(v.episode) === episodeKey(episode));
    return <Column width={props.width} height={104} gap={8} scroll="none">
      <Button label={`${episode.displayNumber || episode.number}. ${episode.name}`} width={props.width - 8} height={66}
        autofocus={props.autofocus && episodeKey(episode) === episodeKey(props.episodes[selected()])}
        id={`episode-${episodeKey(episode)}`} selected={episodeKey(episode) === episodeKey(props.current)} action={() => props.play(episode)} />
      <view skipFocus x={22} width={props.width - 50} height={30}>
        <view y={5} width={(props.width - 70) * 0.5} height={4} color={0xffffff22} borderRadius={2}>
          <view width={(props.width - 70) * 0.5 * (viewing() ? fraction(viewing()!) : 0)} height={4} color={palette.accent} borderRadius={2} />
        </view>
        <text skipFocus x={(props.width - 50) * 0.55} width={(props.width - 50) * 0.45} height={28} fontSize={21} maxLines={1} color={palette.muted}>{episodeKey(episode) === episodeKey(props.current) ? 'Now playing' : viewing() ? fraction(viewing()!) === 1 ? 'Watched' : `${time(Math.max(0, viewing()!.duration - viewing()!.position))} left` : ''}</text>
      </view>
    </Column>;
  };
  return <view width={props.width} height={props.height} clipping forwardFocus={0}>
    <Column width={props.width} height={props.height} gap={16} scroll="none" selected={selectedRow()} onSelectedChanged={onSelectedChanged}>
      <For each={windowEpisodes()}>{episode => row(episode)}</For>
    </Column>
  </view>;
}
