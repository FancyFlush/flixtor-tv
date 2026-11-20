import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack, type JSX } from 'solid-js';
import { createInfiniteQuery, createQuery } from '@tanstack/solid-query';
import { useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { Column, Row, VirtualGrid } from '@solidtv/solid/primitives';
import { useApp } from '../../app/context';
import { Button, Menu, palette, Poster, Status, restoreFocus, time } from '../../ui/components';
import { Overlay } from '../../ui/Overlay';
import { TextField, type FieldHandle } from '../../ui/Input';
import { failureOf, finished, titleKey, type Title, type Viewing } from '../../domain/models';
import { ContentError } from '../../ui/ContentError';
import type { ContentOperation } from '../../ui/content-recovery';
import { catalogueKey, distinctTitles, nextCataloguePage, resumeEpisode, resumeViewing, searchMode, type SearchMode } from './catalog-state';
import { activeScope } from '../../ui/focus';
import { narratePage } from '../../ui/narration';
import { CINEMETA_TTL, matchPlayableTitle, type DiscoveryTitle } from '../../services/cinemeta';

import { CatalogShelves, isDiscovery, shelfTitleKey as homeKey, type ShelfTitle as HomeTitle } from './CatalogShelves';
import { TitleGrid } from './TitleGrid';
import { EntityResults, movieRoute } from './Discovery';
import { METADATA_TTL } from '../../services/tmdb';
import { BrowseShelves } from './BrowseShelves';
type HomeShelf = { id: string; label: string; titles: HomeTitle[]; continuing?: boolean };
const genreIds: Record<string, number> = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const genres = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'];
const searchPosterLayouts = { small: { columns: 10, gap: 8 }, medium: { columns: 6, gap: 12 }, large: { columns: 4, gap: 16 } } as const;
type SearchPosterSize = keyof typeof searchPosterLayouts;


export function Catalog() {
  const app = useApp(), location = useLocation(), navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const destination = () => location.pathname.slice(1) || 'home', query = () => String(params.q || '').slice(0, 64), sort = () => String(params.sort || 'latest');
  const mode = () => searchMode(params.mode);
  const filterKey = () => String(params.shelf || '') + String(params.genre || '') + JSON.stringify(catalogueKey(destination(), query(), sort(), app.profileId(), app.authRevision(), mode()));
  function changeSearch(value: string, next: SearchMode = mode(), replace = true) {
    if (value !== query() || next !== mode()) {
      app.browseOrigins.delete(JSON.stringify(catalogueKey('search', value, sort(), app.profileId(), app.authRevision(), next)));
    }
    setParams({ mode: next === 'media' ? undefined : next, q: value || undefined, page: undefined }, { replace });
  }
  narratePage(() => destination() === 'search' ? 'Search' : destination() === 'home' ? 'Home' : destination() === 'shows' ? 'TV shows' : destination() === 'list' ? 'My List' : destination() === 'continue' ? 'Continue Watching' : destination() === 'anime' ? 'Anime' : 'Movies');
  const [sortMenu, setSortMenu] = createSignal(false);
  const home = createQuery(() => ({ queryKey: ['home', app.profileId(), app.authRevision()], enabled: destination() === 'home', queryFn: ({ signal }) => app.flixtor.home(signal), retry: 1 }));
  const trending = createQuery(() => ({ queryKey: ['tmdb', 'trending'], enabled: destination() === 'home' && !!app.host.tmdb, staleTime: METADATA_TTL, retry: false, queryFn: ({ signal }) => app.tmdb.movies({ shelf: 'trending', page: 1 }, signal) }));
  const topRated = createQuery(() => ({ queryKey: ['tmdb', 'rated'], enabled: destination() === 'home' && !!app.host.tmdb, staleTime: METADATA_TTL, retry: false, queryFn: ({ signal }) => app.tmdb.movies({ shelf: 'rated', page: 1 }, signal) }));
  const popularMovies = createQuery(() => ({ queryKey: ['discovery', 'movie', 'top'], enabled: destination() === 'home', queryFn: ({ signal }) => app.cinemeta.catalog('movie', 'top', undefined, signal), staleTime: CINEMETA_TTL, retry: false }));
  const featuredMovies = createQuery(() => ({ queryKey: ['discovery', 'movie', 'imdbRating'], enabled: destination() === 'home', queryFn: ({ signal }) => app.cinemeta.catalog('movie', 'imdbRating', undefined, signal), staleTime: CINEMETA_TTL, retry: false }));
  const popularSeries = createQuery(() => ({ queryKey: ['discovery', 'series', 'top'], enabled: destination() === 'home', queryFn: ({ signal }) => app.cinemeta.catalog('series', 'top', undefined, signal), staleTime: CINEMETA_TTL, retry: false }));
  const featuredSeries = createQuery(() => ({ queryKey: ['discovery', 'series', 'imdbRating'], enabled: destination() === 'home', queryFn: ({ signal }) => app.cinemeta.catalog('series', 'imdbRating', undefined, signal), staleTime: CINEMETA_TTL, retry: false }));
  const categoryBrowse = () => ['movies', 'shows', 'anime'].includes(destination());
  const genre = () => genres.includes(String(params.genre)) ? String(params.genre) : '';
  const setGenre = (value: string) => setParams({ genre: value || undefined });
  const [genreMenu, setGenreMenu] = createSignal(false);
  const genreMovies = createQuery(() => ({ queryKey: ['discovery', 'movie', 'genre', genre()], enabled: destination() === 'home' && !!genre(), queryFn: ({ signal }) => app.cinemeta.catalog('movie', 'top', genre(), signal), staleTime: CINEMETA_TTL, retry: false }));
  const genreSeries = createQuery(() => ({ queryKey: ['discovery', 'series', 'genre', genre()], enabled: destination() === 'home' && !!genre(), queryFn: ({ signal }) => app.cinemeta.catalog('series', 'top', genre(), signal), staleTime: CINEMETA_TTL, retry: false }));
  const remote = createInfiniteQuery(() => ({
    queryKey: catalogueKey(destination(), query(), sort(), app.profileId(), app.authRevision(), mode()),
    initialPageParam: 1, maxPages: 8,
    enabled: destination() === 'search' && ['media', 'anime'].includes(mode()) && !!query().trim(),
    queryFn: ({ pageParam, signal }) => mode() === 'anime' ? app.anime.browse(query(), pageParam, signal) : app.flixtor.search(query(), pageParam, signal),
    getNextPageParam: (last, pages, page) => nextCataloguePage(last, pages, page),
    retry: (count, error) => failureOf(error) === 'NETWORK' && count < 1,
  }));
  const library = () => app.data.libraries[app.profileId()];
  const continuing = () => library()?.viewing.filter(v => !finished(v)) || [];
  const seed = () => library()?.viewing.filter(v => v.title.source !== 'HIANIME' && v.title.type !== 'SERIES' && !v.title.path.startsWith('/watch/tv/')).at(0)?.title;
  const seedMovie = createQuery(() => ({ queryKey: ['tmdb', 'seed', app.profileId(), seed()?.imdb, seed()?.name, seed()?.year], enabled: destination() === 'home' && !!app.host.tmdb && !!seed(), staleTime: METADATA_TTL, retry: false, queryFn: ({ signal }) => app.tmdb.identify(seed()!, signal) }));
  const similar = createQuery(() => ({ queryKey: ['tmdb', 'similar', app.profileId(), seedMovie.data?.tmdbId], enabled: destination() === 'home' && !!seedMovie.data, staleTime: METADATA_TTL, retry: false, queryFn: ({ signal }) => app.tmdb.movies({ shelf: 'similar', movie: seedMovie.data!.tmdbId, page: 1 }, signal) }));
  const discoveryQueries = () => [popularMovies, featuredMovies, popularSeries, featuredSeries];
  const discoveryLoading = () => discoveryQueries().some(query => query.isPending);
  const shelves = createMemo<HomeShelf[]>(() => {
    const resume: HomeShelf[] = continuing().length ? [{ id: 'continue', label: 'Continue Watching', titles: distinctTitles([continuing().map(v => v.title)]), continuing: true }] : [];
    const curated: HomeShelf[] = [
      { id: 'movies-popular', label: trending.data?.titles.length ? 'Trending Movies' : 'Popular Movies', titles: trending.data?.titles.length ? trending.data.titles : popularMovies.data || [] },
      { id: 'movies-rated', label: topRated.data?.titles.length ? 'Top Rated Movies' : 'Featured Movies', titles: topRated.data?.titles.length ? topRated.data.titles : featuredMovies.data || [] },
      ...(similar.data?.titles.length ? [{ id: 'movies-similar', label: `More like ${seed()?.name}`, titles: similar.data.titles }] : []),
      { id: 'series-popular', label: 'Popular Series', titles: popularSeries.data || [] },
      { id: 'series-featured', label: 'Featured Series', titles: featuredSeries.data || [] },
      ...(genre() ? [{ id: 'genre-movies', label: `${genre()} Movies`, titles: genreMovies.data || [] }, { id: 'genre-series', label: `${genre()} Series`, titles: genreSeries.data || [] }] : []),
    ].filter(shelf => shelf.titles.length);
    const fallback = !curated.length ? (home.data || []).map(shelf => ({ ...shelf, id: `provider:${shelf.label}` })) : [];
    return [...resume, ...(curated.length ? curated : fallback)];
  });
  const titles = createMemo(() => destination() === 'list' ? library()?.favorites || [] : destination() === 'continue' ? distinctTitles([continuing().map(v => v.title)]) : distinctTitles(remote.data?.pages || []));
  const [highlighted, setHighlighted] = createSignal<HomeTitle>();
  const [availabilityMessage, setAvailabilityMessage] = createSignal('');
  const [checkingId, setCheckingId] = createSignal('');
  const [availabilityFailure, setAvailabilityFailure] = createSignal<ContentOperation>();
  let availabilityRequest: AbortController | undefined;
  let dwell: ReturnType<typeof setTimeout> | undefined;
  function highlight(title: HomeTitle) { clearTimeout(dwell); dwell = setTimeout(() => { setHighlighted(title); setAvailabilityMessage(''); }, 250); }
  createEffect(on(filterKey, () => { clearTimeout(dwell); setHighlighted(undefined); availabilityRequest?.abort(); setAvailabilityFailure(undefined); setAvailabilityMessage(''); setCheckingId(''); }));
  onCleanup(() => clearTimeout(dwell));
  onCleanup(() => availabilityRequest?.abort());
  const hero = () => highlighted() || shelves()[0]?.titles[0];
  const playableHero = () => { const value = hero(); return value && !isDiscovery(value) ? value : undefined; };
  const heroDetail = createQuery(() => ({ queryKey: ['detail', playableHero() ? titleKey(playableHero()!) : '', app.profileId(), app.authRevision()],
    enabled: destination() === 'home' && !!playableHero(), queryFn: ({ signal }) => playableHero()!.source === 'HIANIME' ? app.anime.detail(playableHero()!, signal) : app.flixtor.detail(playableHero()!, signal), retry: false }));
  createEffect(() => {
    if (destination() === 'search') return;
    const title = highlighted() || (destination() === 'home' ? heroDetail.data?.title || hero() : titles()[0]);
    app.setStage(title ? { poster: title.poster, backdrop: title.backdrop } : undefined);
  });
  const [delayed, setDelayed] = createSignal(false);
  createEffect(() => {
    const fetching = destination() === 'home' ? home.isFetching || discoveryQueries().some(query => query.isFetching) || genreMovies.isFetching || genreSeries.isFetching : remote.isFetching;
    if (!fetching) setDelayed(false);
    const timer = setTimeout(() => setDelayed(fetching), 120); onCleanup(() => clearTimeout(timer));
  });
  function open(title: Title, focus: string) {
    app.setSelected(title); app.titleCache.set(titleKey(title), title);
    if (app.titleCache.size > 256) app.titleCache.delete(app.titleCache.keys().next().value!);
    app.lastFocus = focus; navigate(`/detail?title=${encodeURIComponent(titleKey(title))}`);
  }
  async function openDiscovery(item: DiscoveryTitle, focus: string) {
    if (app.host.tmdb && item.type === 'movie') { app.lastFocus = focus; navigate(movieRoute(item)); return; }
    availabilityRequest?.abort(); const request = new AbortController(); availabilityRequest = request;
    setCheckingId(homeKey(item)); setAvailabilityMessage('Checking FlixTor availability…');
    try { const candidates = await app.queries.fetchQuery({ queryKey: ['availability', 'cinemeta', item.id, item.name, item.year, item.type, app.profileId(), app.authRevision()], queryFn: ({ signal }) => app.flixtor.search(item.name, 1, request.signal) });
      if (request.signal.aborted) return; const match = matchPlayableTitle(item, candidates);
      if (match) { setAvailabilityMessage(''); open(match, focus); } else setAvailabilityMessage(`${item.name} is not available on FlixTor.`);
    } catch (error) { if (!request.signal.aborted) setAvailabilityFailure({ id: 'availability', error, retry: () => openDiscovery(item, focus) }); }
    finally { if (availabilityRequest === request) { availabilityRequest = undefined; setCheckingId(''); } }
  }

  function chooseHomeTitle(item: HomeTitle, focus: string) {
    if (isDiscovery(item)) void app.run(() => openDiscovery(item, focus));
    else open(item, focus);
  }
  function remember(rail: number, item: number, focus: string, shelf?: string, title?: string) {
    const previous = app.browseOrigins.get(filterKey());
    const positions = { ...previous?.positions };
    if (shelf && title) positions[shelf] = { title, item };
    app.browseOrigins.set(filterKey(), { rail, item, focus, shelf, title, positions });
    if (app.browseOrigins.size > 32) app.browseOrigins.delete(app.browseOrigins.keys().next().value!);
  }
  const pending = () => destination() === 'home' ? home.isPending : remote.isEnabled && remote.isPending;
  const error = () => destination() === 'home' ? home.error : remote.error;
  const retry = () => destination() === 'home' ? home.refetch() : remote.isFetchNextPageError ? remote.fetchNextPage() : remote.refetch();
  const recoveryOperations = (): ContentOperation[] => {
    if (destination() === 'search') return [{ id: 'search', error: remote.error, fetching: remote.isFetching, retry }];
    if (destination() !== 'home') return [];
    const discovery = [...discoveryQueries(), ...(genre() ? [genreMovies, genreSeries] : [])];
    const usable = shelves().some(shelf => !shelf.continuing && shelf.titles.length);
    return [
      ...(availabilityFailure() ? [availabilityFailure()!] : []),
      ...(!usable ? [{ id: 'home', error: home.error, fetching: home.isFetching, retry: () => home.refetch() },
        ...discovery.map((query, index) => ({ id: `discovery-${index}`, error: query.error, fetching: query.isFetching, retry: () => query.refetch() }))] : []),
    ];
  };
  const loadMore = () => { if (remote.hasNextPage && !remote.isFetching && !remote.isFetchNextPageError) void remote.fetchNextPage(); };
  return <>
    <Show when={destination() === 'search' ? `search:${app.profileId()}:${app.authRevision()}` : filterKey()} keyed>{layoutKey => {
      const key = filterKey();
      // Route changes replace this keyed owner. Do not also swap its old subtree
      // during disposal: SolidTV would retain scene nodes whose native parents died.
      const homeLayout = untrack(destination) === 'home', browseLayout = untrack(categoryBrowse);
      const origin = untrack(() => app.browseOrigins.get(key));
      const focusId = (rail: number, title: HomeTitle) => `${key}:${rail}:${homeKey(title)}`;
      const shelfFocus = (shelf: string, title: HomeTitle, index: number, rail: number, id: string) => {
        remember(rail, index, id, shelf, homeKey(title)); highlight(title);
      };
      const heading = () => (
          <Row width={1728} height={82} gap={24} skipFocus={!['movies', 'shows'].includes(destination())}
            onUp={() => restoreFocus(`nav-${destination() === 'continue' ? 'home' : destination()}`)}>
            <text skipFocus width={800} height={76} fontSize={54} fontFamily="Roboto700" maxLines={1}>{destination() === 'shows' ? 'TV shows' : destination() === 'list' ? 'My List' : destination() === 'continue' ? 'Continue Watching' : destination() === 'anime' ? 'Anime' : 'Movies'}</text>
            <Show when={['movies', 'shows'].includes(destination())}><Button id="catalog-sort" label={sort() === 'best' ? 'Top rated' : sort() === 'name' ? 'A–Z' : 'Latest'} width={220} action={() => setSortMenu(true)} /></Show>
            <Show when={destination() === 'movies' && app.host.tmdb}><Button label="Explore genres" width={280} action={() => setGenreMenu(true)} /></Show>
            <Show when={delayed() && destination() !== 'search'}><text skipFocus width={280} height={54} fontSize={24} color={palette.muted}>{remote.isFetchingNextPage ? 'Loading more…' : 'Refreshing…'}</text></Show>
          </Row>
      );
      return <Show when={homeLayout} fallback={
        <Column width={1728} height={848} gap={24} scroll="none">
          <Show when={!browseLayout && destination() !== 'search' && !titles().length}>{heading()}</Show>
          <Show when={browseLayout} fallback={<>
          <Show when={destination() === 'search'} fallback={<>
            <Show when={pending()}><Status message="Loading catalogue…" /></Show>
            <Show when={!pending() && !titles().length && !error()}><Column width={1500} height={240} gap={24}>
              <Status message={destination() === 'list' ? 'Save the stories you want to watch. They’ll be here when you’re ready.' : destination() === 'continue' ? 'Your next watch starts here.' : 'No titles found.'} />
              <Button label="Browse movies" autofocus action={() => navigate('/movies')} />
            </Column></Show>
            <Show when={titles().length}><TitleGrid header={heading()} up={() => restoreFocus(`nav-${destination() === 'continue' ? 'home' : destination()}`)} titles={titles()} prefix={key} columns={6} width={1728} height={848} initial={origin?.item || 0}
              viewing={continuing()} focus={(title, index) => { remember(0, index, focusId(0, title)); highlight(title); }} open={title => open(title, focusId(0, title))} end={loadMore} /></Show>
          </>}>
            <SearchResults mode={mode()} switchMode={(next, value) => changeSearch(value, next, false)}
              query={query()} change={value => changeSearch(value)} titles={titles()} pending={pending()} error={error()} retry={retry} prefix={filterKey()}
              initial={app.browseOrigins.get(filterKey())?.item || 0} restore={!!app.browseOrigins.get(filterKey())} focus={(title, index) => remember(0, index, `${filterKey()}:0:${titleKey(title)}`)} open={title => open(title, `${filterKey()}:0:${titleKey(title)}`)} end={loadMore} />
          </Show>

          </>}>
            <BrowseShelves full={String(params.shelf || '')} header={heading()} destination={destination()} sort={sort()} query={query()} prefix={key} origin={origin}
              viewing={continuing()} focus={shelfFocus} open={open} />
          </Show>
        </Column>
      }>
        <CatalogShelves shelves={shelves().map(shelf => ({ ...shelf, viewAll: shelf.continuing ? () => navigate('/continue') : undefined }))}
          prefix={key} height={848} origin={origin} viewing={continuing()} focus={shelfFocus} open={chooseHomeTitle} header={<>
          <Column width={1728} height={availabilityMessage() ? 560 : 456} gap={18} scroll="none">
            <Show when={hero()} fallback={<text skipFocus width={950} height={150} fontSize={76} fontFamily="Roboto700">Welcome, {app.profile()?.name || 'FlixTor'}</text>}>{selectedHero => {
              const current = selectedHero() as HomeTitle;
              const external = isDiscovery(current) ? current : undefined;
              const playable = external ? undefined : current as Title;
              return <>
              <text skipFocus width={950} height={160} fontSize={76} lineHeight={76} fontFamily="Roboto700" maxLines={2}>{current.name}</text>
              <text skipFocus width={920} height={38} fontSize={26} color={palette.muted} maxLines={1}>{[
                current.year,
                external ? external.genres.slice(0, 2).join(' · ') : current.genres,
                external ? external.type === 'series' ? 'TV Series' : 'Movie' : playable?.source === 'HIANIME' ? 'Anime' : '',
              ].filter(Boolean).join('   ·   ')}</text>
              <text skipFocus width={850} height={105} fontSize={28} color={palette.muted} maxLines={3}>{external ? external.synopsis || 'Discover a story to watch.' : heroDetail.data?.title.synopsis || playable?.synopsis || 'Settle in. Find something worth watching.'}</text>
              <Row width={1420} height={72} gap={18} onUp={() => restoreFocus('nav-home')}>
                <Show when={external} fallback={<>
                  <Button id="hero-play" label={resumeViewing(continuing(), playable!) ? 'Resume' : 'Play'} icon="play" primary autofocus={!origin} width={220} disabled={!heroDetail.data} action={() => app.run(async () => {
                    const detail = heroDetail.data; if (!detail) return;
                    const viewing = resumeViewing(continuing(), detail.title); navigate('/player'); await app.playback!.start(detail, resumeEpisode(detail, viewing), viewing?.version || undefined);
                  })} />
                  <Button id="hero-details" label="Details" width={220} action={() => open(playable!, focusId(0, playable!))} />
                </>}>
                  {item => <Button id="hero-find" label="Details" icon="play" primary autofocus={!origin} width={290} disabled={!!checkingId()} action={() => void app.run(() => openDiscovery(item(), focusId(0, item())))} />}
                </Show>
                <Button label={genre() ? `Genre: ${genre()}` : 'Browse genres'} icon="film" width={290} action={() => setGenreMenu(true)} />
                <Show when={home.isError}><Button label="Refresh catalogue" action={() => void home.refetch()} /></Show>
              </Row>
              <Show when={availabilityMessage()}><Status width={1000} message={availabilityMessage()} error={!checkingId()} /></Show>
            </>;
            }}</Show>
          </Column>
          <Show when={!shelves().length && (home.isPending || discoveryLoading())}><Status message="Finding something to watch…" /></Show>
        </>} />

      </Show>;
    }}</Show>
    <ContentError screenKey={filterKey()} operations={recoveryOperations()} />
    <Show when={sortMenu()}><Overlay title="Sort titles" close={() => setSortMenu(false)} width={700} height={510}><Menu width={620} height={438} title="Sort titles" options={[
      ['latest', 'Latest'], ['best', 'Top rated'], ['name', 'A–Z'],
    ].map(([value, label]) => ({ id: value, label, selected: sort() === value, action: () => { setSortMenu(false); setParams({ sort: value, shelf: params.shelf ? value : undefined, page: undefined, window: undefined }); } }))} /></Overlay></Show>
    <Show when={genreMenu()}><Overlay title="Discover by genre" close={() => setGenreMenu(false)} width={760} height={740}><Menu width={680} height={660} title="Discover by genre" back={() => setGenreMenu(false)} options={[
      { id: 'all', label: 'All genres', selected: !genre(), action: () => { setGenre(''); setGenreMenu(false); } },
      ...genres.filter(value => destination() !== 'movies' || genreIds[value]).map(value => ({ id: value, label: value, selected: genre() === value, action: () => { setGenreMenu(false); if (destination() === 'movies') navigate(`/discover?genre=${genreIds[value]}&name=${encodeURIComponent(value + ' movies')}`); else setGenre(value); } })),
    ]} /></Overlay></Show>
  </>;
}


function SearchResults(props: { mode: SearchMode; switchMode(mode: SearchMode, query: string): void; query: string; change(value: string): void; titles: Title[]; pending: boolean; error: unknown; retry(): void; prefix: string; initial: number; restore: boolean; focus(title: Title, index: number): void; open(title: Title): void; end(): void }) {
  const app = useApp(); const [draft, setDraft] = createSignal(props.query);
  const [firstEntityFocus, setFirstEntityFocus] = createSignal('');
  const [selected, setSelected] = createSignal<Title>(), [previewTitle, setPreviewTitle] = createSignal<Title>();
  const [gridFocus, setGridFocus] = createSignal<{ prefix: string; index: number }>();
  const posterSize = () => app.data.searchPosterSize;
  const gridInitial = (prefix: string) => {
    const saved = gridFocus();
    return saved?.prefix === prefix ? saved.index : props.initial;
  };
  const setPosterSize = (size: SearchPosterSize) => app.run(() => app.repo.change(data => { data.searchPosterSize = size; }));
  const cyclePosterSize = () => {
    const sizes = Object.keys(searchPosterLayouts) as SearchPosterSize[];
    setPosterSize(sizes[(sizes.indexOf(posterSize()) + 1) % sizes.length]);
  };
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let backdropTimer: ReturnType<typeof setTimeout> | undefined;
  const selectTitle = (title: Title) => {
    setSelected(title);
    clearTimeout(previewTimer);
    clearTimeout(backdropTimer);
    previewTimer = setTimeout(() => setPreviewTitle(title), 250);
    backdropTimer = setTimeout(() => app.setStage(title), 500);
  };
  const preview = createQuery(() => ({
    queryKey: ['detail', previewTitle() ? titleKey(previewTitle()!) : '', app.profileId(), app.authRevision()],
    enabled: !!previewTitle() && !previewTitle()!.synopsis,
    retry: false,
    queryFn: ({ signal }) => previewTitle()!.source === 'HIANIME'
      ? app.anime.detail(previewTitle()!, signal) : app.flixtor.detail(previewTitle()!, signal),
  }));
  createEffect(on(() => [props.query, props.titles[0]] as const, ([query, first]) => {
    clearTimeout(previewTimer);
    if (!query || !first) {
      clearTimeout(backdropTimer);
      setSelected(undefined); setPreviewTitle(undefined); app.setStage(undefined);
    }
    else selectTitle(first);
  }));
  onCleanup(() => { clearTimeout(previewTimer); clearTimeout(backdropTimer); });
  let field: FieldHandle | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => [props.query, props.mode] as const, ([value]) => { clearTimeout(timer); setDraft(value); }));
  const change = (value: string) => { setDraft(value); clearTimeout(timer); timer = setTimeout(() => props.change(value.trim().slice(0, 64)), 300); };
  const label = () => props.mode === 'anime' ? 'Search anime' : props.mode === 'people' ? 'Search actors and directors' : props.mode === 'studios' ? 'Search production studios' : 'Search films and TV shows';
  const switchMode = (mode: SearchMode) => { if (mode === props.mode) return; clearTimeout(timer); props.switchMode(mode, draft().trim().slice(0, 64)); };
  const submit = (value = draft()) => {
    clearTimeout(timer);
    const query = value.trim().slice(0, 64);
    setDraft(query);
    props.change(query);
  };
  const focusField = () => { clearTimeout(timer); field?.focus(); };
  const rightToResults = () => {
    const first = props.titles[0];
    if (first) return restoreFocus(`${props.prefix}:0:${titleKey(first)}`);
    return firstEntityFocus() ? restoreFocus(firstEntityFocus()) : false;
  };
  const previewMatches = () => !!previewTitle() && !!selected() && titleKey(previewTitle()!) === titleKey(selected()!);
  const synopsis = () => selected()?.synopsis || (previewMatches() ? preview.data?.title.synopsis : '');
  const previewMessage = () => !selected() ? 'Choose a title to see its description.'
    : synopsis() ? '' : !previewMatches() || preview.isFetching ? 'Loading description…'
      : preview.error ? 'Description unavailable.' : 'No description available.';
  const keydown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || document.querySelector('dialog[open]') || app.inputRequest() || activeScope() !== 'screen') return;
    if (event.key.length === 1 || event.key === 'Backspace') { event.preventDefault(); event.stopImmediatePropagation(); field?.edit(event.key === 'Backspace' ? 'Delete' : event.key); }
  };
  window.addEventListener('keydown', keydown, true);
  onCleanup(() => { clearTimeout(timer); window.removeEventListener('keydown', keydown, true); });
  return <Column width={1728} height={848} gap={24} scroll="none">
    <Row width={1728} height={82} gap={24} onUp={() => restoreFocus('nav-search')}>
      <text skipFocus width={580} height={76} fontSize={54} lineHeight={64} fontFamily="Roboto700" maxLines={1}>Find your next story.</text>
      <Button id="search-mode-media" label="Movies & TV" width={220} selected={props.mode === 'media'} action={() => switchMode('media')} />
      <Button id="search-mode-anime" label="Anime" width={140} selected={props.mode === 'anime'} action={() => switchMode('anime')} />
      <Button id="search-mode-people" label="People" width={160} selected={props.mode === 'people'} action={() => switchMode('people')} />
      <Button id="search-mode-studios" label="Studios" width={160} selected={props.mode === 'studios'} action={() => switchMode('studios')} />
    </Row>
    <view width={1728} height={742} clipping={[0, 20, 20, 20]} forwardFocus={0}>
      <Row width={1728} height={742} gap={32}>
        <Column width={400} height={742} gap={20} scroll="none">
          <TextField id="search-field" label={label()} value={draft()} change={change} width={400} maxLength={64} autofocus={!props.restore}
            activate={focusField} handle={handle => field = handle} up={() => restoreFocus(`search-mode-${props.mode}`)}
            down={() => restoreFocus('search-poster-size')} right={rightToResults} submit={() => submit()} />
          <Row width={400} height={64} gap={8}>
            <text skipFocus width={96} height={64} fontSize={22} color={palette.muted}>Poster size</text>
            <Button id="search-poster-size" label={`Poster size: ${posterSize()}`} icon={`grid-${posterSize()}`} iconOnly width={64} height={60} selected action={cyclePosterSize} />
          </Row>
          <Show when={!props.query}><Status width={400} message="Use your remote or type a title." /></Show>
          <Show when={selected()} keyed>{title => <view width={400} height={510} color={palette.panelSolid} borderRadius={20}>
            <Column x={20} y={20} width={360} height={470} gap={14} scroll="none">
              <text skipFocus width={360} height={80} fontSize={34} fontFamily="Roboto700" maxLines={2}>{title.name}</text>
              <text skipFocus width={360} height={36} fontSize={22} color={palette.muted} maxLines={1}>{[title.year, title.rating ? `Rating ${title.rating}` : '', title.genres].filter(Boolean).join('   ·   ')}</text>
              <Show when={synopsis()}><text skipFocus width={360} height={310} fontSize={24} color={palette.foreground} maxLines={8}>{synopsis()}</text></Show>
              <Show when={previewMessage()}><Status width={360} message={previewMessage()} /></Show>
            </Column>
          </view>}</Show>
        </Column>
        <Column width={1296} height={742} gap={16} scroll="none" onLeft={() => restoreFocus('search-field')}>
          <Show when={props.pending}><Status width={1296} message="Searching…" /></Show>
          <Show when={['media', 'anime'].includes(props.mode) && props.query && !props.pending && !props.error && !props.titles.length}><Status width={1296} message={`No results for “${props.query}”. Try a different title.`} /></Show>
          <Show when={props.mode === 'people' || props.mode === 'studios' ? props.prefix : undefined} keyed>{prefix => <EntityResults kind={props.mode as 'people' | 'studios'} query={props.query} prefix={prefix} width={1296} firstFocus={setFirstEntityFocus} />}</Show>
          <Show when={props.prefix} keyed>{prefix => <Show when={posterSize()} keyed>{size => <Show when={props.titles.length}>
            <TitleGrid titles={props.titles} prefix={prefix} columns={searchPosterLayouts[size].columns} rowGap={searchPosterLayouts[size].gap} width={1296} height={742} initial={gridInitial(prefix)} autofocus={props.restore} compact focus={(title, index) => { setGridFocus({ prefix, index }); selectTitle(title); props.focus(title, index); }} open={props.open} end={props.end} />
          </Show>}</Show>}</Show>
        </Column>
      </Row>
    </view>
  </Column>;
}
