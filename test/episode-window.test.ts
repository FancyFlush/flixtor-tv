import { expect, it } from 'vitest';
import { episodeWindowStart, nextEpisodeWindowStart, visibleEpisodeRows } from '../src/ui/episode-window';

it('keeps the initial selection visible near the end of a long list', () => {
  const visible = visibleEpisodeRows(530);
  const start = episodeWindowStart(100, visible, 98);
  expect(start).toBe(95);
  expect(98 - start).toBe(visible - 1);
});

it('advances the window before selection reaches its mounted boundary', () => {
  const visible = 4;
  const globalSelected = visible;
  const start = nextEpisodeWindowStart(0, globalSelected, visible, 100);
  expect(start).toBe(1);
  expect(globalSelected - start).toBe(visible - 1);
});

it('moves the window backward while keeping the previous row selectable', () => {
  const start = nextEpisodeWindowStart(10, 0, 4, 100);
  expect(start).toBe(9);
});

it('keeps every item reachable while navigating through a long list', () => {
  const total = 100;
  const visible = 4;
  const windowSize = visible + 2;
  let start = episodeWindowStart(total, visible, 0);

  for (let cursor = 0; cursor < total; cursor++) {
    const local = cursor - start;
    expect(local).toBeGreaterThanOrEqual(0);
    expect(local).toBeLessThan(Math.min(windowSize, total - start));
    if (cursor === total - 1) continue;

    const nextLocal = local + 1;
    expect(nextLocal).toBeLessThan(Math.min(windowSize, total - start));
    start = nextEpisodeWindowStart(start, nextLocal, visible, total);
    expect(cursor + 1 - start).toBeLessThan(visible);
  }
});

it('exposes the final episodes when the list is shorter than its viewport plus buffer', () => {
  const visible = visibleEpisodeRows(530);
  const start = episodeWindowStart(5, visible, 4);
  expect(start).toBe(1);
  expect(nextEpisodeWindowStart(start, 3, visible, 5)).toBe(start);
});
