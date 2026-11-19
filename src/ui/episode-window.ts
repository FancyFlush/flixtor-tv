const EPISODE_ROW_HEIGHT = 104;
const EPISODE_LIST_GAP = 16;

export function visibleEpisodeRows(height: number) {
  return Math.max(1, Math.floor((height + EPISODE_LIST_GAP) / (EPISODE_ROW_HEIGHT + EPISODE_LIST_GAP)));
}

export function episodeWindowStart(total: number, visibleRows: number, selected: number) {
  return Math.max(0, Math.min(total - visibleRows, selected - visibleRows + 1));
}

export function nextEpisodeWindowStart(start: number, selectedRow: number, visibleRows: number, total: number) {
  const selected = start + selectedRow;
  const maxStart = Math.max(0, total - visibleRows);
  if (selectedRow >= visibleRows) return Math.max(0, Math.min(maxStart, selected - visibleRows + 1));
  if (selectedRow === 0 && selected > 0) return Math.max(0, Math.min(maxStart, selected - 1));
  return start;
}
