import { all, attr, document, one, text, unique } from './html';
import { secureUrl, USER_AGENT } from './flixtor';
import { ServiceError, titleKey, episodeKey, type AnimeVersion, type Detail, type Episode, type Stream, type Title } from '../domain/models';
import type { HttpResponse, Platform } from '../platform/platform';
export const DEFAULT_ANIME_BASE = 'https://hianime.fm';
export type AnimeCategory = 'most-popular' | 'top-airing' | 'recently-updated';
export function normalizeAnimeBaseUrl(value: string) {
  const input = value.trim();
  if (!input) return DEFAULT_ANIME_BASE;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Enter a valid Anime source URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || !url.hostname.includes('.') || url.hostname.endsWith('.local') || /^[\d.]+$/.test(url.hostname)
    || url.hostname.includes(':') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS domain only, without a path, port, or query.');
  }
  return url.origin;
}
function fragment(raw: string) { const data = JSON.parse(raw); if (data.status === false) throw new ServiceError('UNAVAILABLE'); if (typeof data.html !== 'string') throw new ServiceError('CHANGED'); return document(data.html); }
function firstParty(path: string, base: string) { const url = new URL(secureUrl(path, base)); if (url.origin !== base) throw new ServiceError('ACCESS'); return url; }
export function parseAnimeCards(html: string, base = DEFAULT_ANIME_BASE): Title[] {
  const doc = document(html); if (/just a moment|cf-chl-/i.test(html)) throw new ServiceError('ACCESS');
  const cards = all(doc, '.film_list-wrap .flw-item').flatMap(card => {
    const link = one(card, '.film-name a'); let path: string;
    try { path = firstParty(attr(link, 'href'), base).pathname; } catch { return []; }
    const id = /-(\d+)$/.exec(path)?.[1]; const name = attr(link, 'title') || text(link); if (!id || !name) return [];
    const img = one(card, '.film-poster-img'); let poster = ''; try { poster = secureUrl(attr(img, 'data-src') || attr(img, 'src'), base); } catch { /* optional */ }
    return [{ id, path, name, poster, source: 'HIANIME' as const, type: all(card, '.fdi-item').some(n => /^movie$/i.test(text(n))) ? 'MOVIE' as const : 'SERIES' as const }];
  });
  const explicitEmpty = all(doc, '#main-content .film_list p').some(node => /^no animes? found\.?$/i.test(text(node)));
  if (!cards.length && (!one(doc, '.film_list-wrap') || one(doc, '.flw-item')) && !explicitEmpty) throw new ServiceError('CHANGED');
  return unique(cards, titleKey);
}
export function parseAnimeEpisodes(raw: string): Episode[] {
  return unique(all(fragment(raw), '.ep-item').flatMap((n, index) => {
    const providerId = attr(n, 'data-id'); if (!/^\d+$/.test(providerId)) return [];
    const displayNumber = attr(n, 'data-number') || String(index + 1);
    return [{ season: 1, number: /^\d+$/.test(displayNumber) ? Number(displayNumber) : index + 1,
      name: attr(n, 'title') || text(one(n, '.ep-name')), providerId, displayNumber, order: index }];
  }), episodeKey);
}
export function parseAnimeServers(raw: string): Partial<Record<AnimeVersion, string>> {
  const servers: Partial<Record<AnimeVersion, string>> = {};
  for (const node of all(fragment(raw), '[data-server-name="ZokoAnime"][data-hash]')) {
    const version = attr(node, 'data-type').toUpperCase(); if (version !== 'DUB' && version !== 'SUB') continue;
    try { servers[version] ??= secureUrl(atob(attr(node, 'data-hash'))); } catch { /* unsupported embed */ }
  }
  return servers;
}
export function animeMapping(embed: string) {
  const match = /\/mal\/(\d+)\/(\d+)(?:\/|$)/.exec(new URL(embed).pathname);
  return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? { malId: Number(match[1]), episode: Number(match[2]) } : undefined;
}
export function parseAnimeStream(html: string, embed: string): Stream {
  try {
    const encoded = /window\.__P\s*=\s*["']([^"']+)["']/.exec(html)?.[1]; if (!encoded) throw new Error();
    const blob = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); const key = new TextEncoder().encode('otaku-embed-v1');
    const data = JSON.parse(new TextDecoder().decode(blob.map((b, i) => b ^ key[i % key.length])));
    const uri = secureUrl(data.src);
    return { uri, captions: (Array.isArray(data.subtitles) ? data.subtitles : []).slice(0, 64).flatMap((c: { src: string; label?: string; lang?: string; default?: boolean }) => {
      try { const uri = secureUrl(c.src, embed); return [{ uri, label: c.label || c.lang || '', default: c.default, mime: new URL(uri).pathname.endsWith('.srt') ? 'application/x-subrip' : 'text/vtt' }]; } catch { return []; }
    }), headers: { Referer: new URL('/', embed).href, 'User-Agent': USER_AGENT }, mime: new URL(uri).pathname.endsWith('.mp4') ? 'video/mp4' : 'application/x-mpegURL', animeMapping: animeMapping(embed) };
  } catch { throw new ServiceError('CHANGED'); }
}
export class AnimeService {
  constructor(private platform: Platform, private configuredBase: () => string = () => DEFAULT_ANIME_BASE) {}
  private base() { return normalizeAnimeBaseUrl(this.configuredBase()); }
  private async raw(url: string, signal?: AbortSignal) {
    const r = await this.platform.call<HttpResponse>('http', { client: 'anime', url: secureUrl(url), headers: { 'User-Agent': USER_AGENT, Referer: this.base() + '/' } }, signal);
    if ([401, 403].includes(r.status)) throw new ServiceError('ACCESS');
    if (r.status === 429 || r.status >= 500) throw new ServiceError('UNAVAILABLE');
    if (r.status < 200 || r.status >= 300 || r.body.length > 2_097_152) throw new ServiceError('CHANGED');
    return r.body;
  }
  async browse(query: string, page: number, signal?: AbortSignal) {
    if (query.length > 64 || page < 1 || page > 10000) throw new ServiceError('CHANGED');
    const base = this.base(), url = new URL(query ? '/search' : '/most-popular', base); url.searchParams.set('page', String(page)); if (query) url.searchParams.set('keyword', query);
    return parseAnimeCards(await this.raw(url.href, signal), base);
  }
  async category(category: AnimeCategory, page: number, signal?: AbortSignal) {
    if (!['most-popular', 'top-airing', 'recently-updated'].includes(category) || !Number.isInteger(page) || page < 1 || page > 10000) throw new ServiceError('CHANGED');
    const base = this.base(), url = new URL(`/${category}`, base); url.searchParams.set('page', String(page));
    return parseAnimeCards(await this.raw(url.href, signal), base);
  }
  async detail(t: Title, signal?: AbortSignal): Promise<Detail> {
    const base = this.base(), doc = document(await this.raw(firstParty(t.path, base).href, signal)); if (!one(doc, '.anisc-detail')) throw new ServiceError('CHANGED');
    return { title: { ...t, synopsis: text(one(doc, '.film-description .text, .item-title .text')), genres: all(doc, '.item-list a[href*="/genre/"]').map(text).join(', ') },
      episodes: parseAnimeEpisodes(await this.raw(`${base}/api/theme/episode/list/${t.id}`, signal)) };
  }
  async servers(e: Episode, signal?: AbortSignal) { if (!e.providerId || !/^\d+$/.test(e.providerId)) throw new ServiceError('CHANGED'); return parseAnimeServers(await this.raw(`${this.base()}/api/theme/episode/servers?episodeId=${e.providerId}`, signal)); }
  async playback(e: Episode, version: AnimeVersion, signal?: AbortSignal) { const embed = (await this.servers(e, signal))[version]; if (!embed) throw new ServiceError('UNAVAILABLE'); return parseAnimeStream(await this.raw(embed, signal), embed); }
}
