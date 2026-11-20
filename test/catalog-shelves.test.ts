import { expect, it, vi } from 'vitest';
import { browseCategories, catalogueKey, distinctTitles, nextCataloguePage, searchMode, shelfQueryKey } from '../src/features/catalog/catalog-state';
import { AnimeService, normalizeAnimeBaseUrl, type AnimeCategory } from '../src/services/anime';
import type { Platform } from '../src/platform/platform';
import type { Title } from '../src/domain/models';
import fixtures from './fixtures/http.json';

it('defaults search to media and isolates provider caches without changing browse keys', () => {
  for (const value of [undefined, '', 'media', 'invalid', ['anime']]) expect(searchMode(value)).toBe('media');
  expect(searchMode('anime')).toBe('anime');
  const key = catalogueKey('search', 'Naruto', 'latest', 'a', 1);
  expect(key).toEqual(catalogueKey('search', 'Naruto', 'latest', 'a', 1, 'media'));
  expect(key).not.toEqual(catalogueKey('search', 'Naruto', 'latest', 'a', 1, 'anime'));
  expect(catalogueKey('movies', '', 'latest', 'a', 1, 'anime')).toEqual(catalogueKey('movies', '', 'latest', 'a', 1));
  expect(catalogueKey('search', 'Naruto', 'latest', 'a', 1, 'anime', 'https://one.example')).not.toEqual(catalogueKey('search', 'Naruto', 'latest', 'a', 1, 'anime', 'https://two.example'));
});

it('orders category shelves from URL sort and isolates all server inputs in query keys', () => {
  expect(browseCategories('movies', 'name', '').map(s => s.id)).toEqual(['name', 'latest', 'best']);
  expect(browseCategories('shows', 'best', '').map(s => s.id)).toEqual(['best', 'latest', 'name']);
  expect(browseCategories('anime', '', '').map(s => s.id)).toEqual(['most-popular', 'top-airing', 'recently-updated']);
  expect(browseCategories('anime', '', ' Naruto ').map(s => s.id)).toEqual(['search']);
  const key = shelfQueryKey('movies', 'latest', '', 'a', 1);
  for (const other of [shelfQueryKey('shows', 'latest', '', 'a', 1), shelfQueryKey('movies', 'best', '', 'a', 1),
    shelfQueryKey('movies', 'latest', 'q', 'a', 1), shelfQueryKey('movies', 'latest', '', 'b', 1), shelfQueryKey('movies', 'latest', '', 'a', 2)]) expect(other).not.toEqual(key);
});

it('deduplicates overlapping pages and stops empty or repeated pagination', () => {
  const title = (id: string): Title => ({ id, source: 'FLIXTOR', type: 'MOVIE', path: `/watch/${id}`, name: id });
  const a = title('1'), b = title('2');
  expect(distinctTitles([[a], [a, b]])).toEqual([a, b]);
  expect(nextCataloguePage([a, b], [[a], [a, b]], 2)).toBe(3);
  expect(nextCataloguePage([a], [[a], [a]], 2)).toBeUndefined();
  expect(nextCataloguePage([], [[a], []], 2)).toBeUndefined();
});

it('maps typed Anime categories to first-party paginated requests and forwards cancellation', async () => {
  const call = vi.fn(async () => ({ status: 200, body: fixtures.anime }));
  const service = new AnimeService({ call } as unknown as Platform);
  const controller = new AbortController();
  for (const category of ['most-popular', 'top-airing', 'recently-updated'] as const) {
    expect((await service.category(category, 2, controller.signal)).length).toBeGreaterThan(0);
    expect(call).toHaveBeenLastCalledWith('http', expect.objectContaining({ client: 'anime', url: `https://hianime.fm/${category}?page=2` }), controller.signal);
  }
  const count = call.mock.calls.length;
  for (const page of [0, -1, 1.5, 10001]) await expect(service.category('top-airing', page)).rejects.toThrow('CHANGED');
  await expect(service.category('../evil' as AnimeCategory, 1)).rejects.toThrow('CHANGED');
  expect(call).toHaveBeenCalledTimes(count);
  await service.browse('Naruto', 1, controller.signal);
  expect(call).toHaveBeenLastCalledWith('http', expect.objectContaining({ url: 'https://hianime.fm/search?page=1&keyword=Naruto' }), controller.signal);
});

it('normalizes and uses the configured Anime origin for requests and relative poster URLs', async () => {
  expect(normalizeAnimeBaseUrl(' anime.example/ ')).toBe('https://anime.example');
  for (const invalid of ['http://anime.example', 'https://anime.example/path', 'https://user@anime.example', 'https://127.0.0.1']) {
    expect(() => normalizeAnimeBaseUrl(invalid)).toThrow();
  }
  const call = vi.fn(async () => ({ status: 200, body: fixtures.anime }));
  const service = new AnimeService({ call } as unknown as Platform, () => 'https://anime.example');
  const titles = await service.browse('', 1);
  expect(call).toHaveBeenCalledWith('http', expect.objectContaining({
    client: 'anime', url: 'https://anime.example/most-popular?page=1',
    headers: expect.objectContaining({ Referer: 'https://anime.example/' }),
  }), undefined);
  expect(titles[0].poster).toContain('https://anime.example/');
});
