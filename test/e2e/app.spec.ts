import { createHash } from 'node:crypto';
import { dehydrate, QueryClient } from '@tanstack/solid-query';
import { test, expect, type Page } from '@playwright/test';
async function activate(page: Page, name: string | RegExp) { const control = page.getByRole('button', { name }).first(); await control.focus(); await page.keyboard.press('Enter'); }
async function home(page: Page) { await page.goto('/'); await activate(page, 'My profile'); await expect(page).toHaveURL(/home/); }
async function openTestSeries(page: Page) { await activate(page, 'TV shows'); await activate(page, 'The Test Series'); }

test('remote profiles → detail → episode → player → settings → back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await home(page); await openTestSeries(page); await expect(page).toHaveURL(/detail/);
  await activate(page, '1. Chapter 1'); await expect(page).toHaveURL(/player/);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeAttached();
  await activate(page, 'Settings');
  await expect(page.getByRole('button', { name: /settings, Video quality/ })).toBeAttached();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/player/);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/detail/);
  expect(errors).toEqual([]);
});
test('Back hides visible player controls, then exits on the second press', async ({ page }) => {
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape'); await expect(settings).toBeHidden();
  await expect(page).toHaveURL(/player/);
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/detail/);
});
test('main navigation can move right into profile and settings', async ({ page }) => {
  await home(page);
  const focused = page.locator('button[data-focused="true"]');
  await page.getByRole('button', { name: 'Search', exact: true }).focus();
  await expect(focused).toHaveText('Search');
  await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText('My profile');
  await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText('Settings');
  await page.keyboard.press('ArrowLeft'); await expect(focused).toHaveText('My profile');
});
test('Anime source URL can be changed and reset in main Settings', async ({ page }) => {
  await home(page); await activate(page, 'Settings'); await expect(page).toHaveURL(/settings/);
  await expect(page.getByRole('button', { name: 'Anime', exact: true })).toHaveCount(2);
  const animeSection = page.getByRole('button', { name: 'Anime', exact: true }).last(); await animeSection.focus(); await page.keyboard.press('Enter');
  await activate(page, /Anime source URL/);
  await page.getByRole('textbox', { name: 'Anime source URL', exact: true }).fill('anime.example');
  await activate(page, 'Save');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).animeBaseUrl)).toBe('https://anime.example');
  await activate(page, 'Reset Anime source URL');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).animeBaseUrl)).toBe('https://hianime.fm');
});
test('hidden player controls map D-pad left and right to ten-second seeks', async ({ page }) => {
  await home(page); await page.evaluate(() => sessionStorage.removeItem('flixtor-fixture:playerSeeks')); await openTestSeries(page); await activate(page, '1. Chapter 1');
  const timeline = page.getByRole('slider', { name: 'Seek', exact: true, includeHidden: true });
  await page.waitForTimeout(3500); await expect(timeline).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(1);
  const seeks = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]') as { from: number; position: number }[]);
  expect((await seeks())[0].position - (await seeks())[0].from).toBeGreaterThan(8000);
  expect((await seeks())[0].position - (await seeks())[0].from).toBeLessThan(12_000);
  await expect(timeline).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(2);
  expect((await seeks())[1].position - (await seeks())[1].from).toBeGreaterThan(-12_000);
  expect((await seeks())[1].position - (await seeks())[1].from).toBeLessThan(-8000);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(3);
  await page.waitForTimeout(3100);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true })));
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(4);
  expect((await seeks())[3].position - (await seeks())[3].from).toBeGreaterThan(58_000);
  expect((await seeks())[3].position - (await seeks())[3].from).toBeLessThan(62_000);
});
test('timeline seeks automatically after three seconds without an OK press', async ({ page }) => {
  await home(page); await page.evaluate(() => sessionStorage.removeItem('flixtor-fixture:playerSeeks')); await openTestSeries(page); await activate(page, '1. Chapter 1');
  const timeline = page.getByRole('slider', { name: 'Seek', exact: true });
  await timeline.focus(); await expect(timeline).toBeFocused();
  const original = Number(await timeline.inputValue());
  await page.keyboard.press('ArrowRight');
  const target = Number(await timeline.inputValue());
  expect(target - original).toBe(30_000);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]'))).toEqual([]);
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(1);
  const seek = await page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]')[0] as { from: number; position: number });
  expect(Math.abs(seek.position - target)).toBeLessThan(1000);
});
test('player seek buttons jump one minute and repeat while OK is held', async ({ page }) => {
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  await page.evaluate(() => sessionStorage.removeItem('flixtor-fixture:playerSeeks'));
  const forward = page.getByRole('button', { name: '+1 minute', exact: true });
  await forward.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(1);
  const first = await page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]')[0] as { from: number; position: number });
  expect(first.position - first.from).toBe(60_000);
  await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })));
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]').length)).toBe(2);
  const second = await page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:playerSeeks') || '[]')[1] as { from: number; position: number });
  expect(second.position).toBe(120_000);
});
test('subtitle settings offer three sizes and appearances and persist both sync directions', async ({ page }) => {
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  await activate(page, 'Settings'); await activate(page, /settings, Subtitles/);
  await expect(page.getByRole('button', { name: /subtitle settings, Subtitle track/ })).toBeAttached();
  await activate(page, 'Text size');
  for (const size of ['Small', 'Medium', 'Large']) await expect(page.getByRole('button', { name: new RegExp(`subtitle size, ${size}`, 'i') })).toBeAttached();
  await activate(page, 'Large');
  await activate(page, 'Appearance'); await activate(page, 'Outline');
  await activate(page, 'Subtitle sync'); await activate(page, 'Later by 0.1 seconds');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).profiles[0].subtitleDelay)).toBe(100);
  await activate(page, 'Earlier by 0.1 seconds');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).profiles[0].subtitleDelay)).toBe(0);
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).profiles[0]);
  expect(profile).toMatchObject({ subtitleSize: 'large', subtitleAppearance: 'outline', subtitleDelay: 0 });
});
test('playback settings switch between fill screen and native aspect ratio', async ({ page }) => {
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  await activate(page, 'Settings'); await activate(page, /settings, Video fit/);
  await activate(page, 'Fill screen');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).profiles[0].videoFit)).toBe('fill');
  await activate(page, 'Video fit'); await activate(page, 'Native aspect ratio');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('flixtor-fixture:app')!).profiles[0].videoFit)).toBe('native');
});
test('detail remote selects an episode before playback', async ({ page }) => {
  await home(page); await openTestSeries(page);
  const focused = page.locator('button[data-focused="true"]');
  await expect(focused).toHaveText('Play');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('Season 1');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('1. Chapter 1');
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:requests') || '[]').filter((path: string) => path.startsWith('/ajax/info/e/')).at(-1))).toBe('/ajax/info/e/1/1/1');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('2. Chapter 2');
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('flixtor-fixture:requests') || '[]').filter((path: string) => path.startsWith('/ajax/info/e/')).at(-1))).toBe('/ajax/info/e/1/1/2');
  await page.keyboard.press('ArrowLeft'); await expect(focused).toHaveText('2. Chapter 2');
  await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText('2. Chapter 2');
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('1. Chapter 1');
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Season 1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(focused).toHaveText('1. Chapter 1');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('2. Chapter 2');
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/player/);
  await activate(page, 'Episodes');
  await expect(focused).toHaveText('2. Chapter 2');
});
test('player arrows navigate transport and episodes without seeking', async ({ page }) => {
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  const focused = page.locator('button[data-focused="true"]');
  await expect(focused).toHaveText('Settings');
  await page.keyboard.press('ArrowLeft'); await expect(focused).toHaveText('Episodes');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Episodes', exact: true })).toBeAttached();
  await expect(focused).toHaveText('1. Chapter 1');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
  await expect(focused).toHaveText('1. Chapter 1');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('2. Chapter 2');
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(focused).toHaveText('Settings');
  await page.keyboard.press('ArrowUp');
  const timeline = page.getByRole('slider', { name: 'Seek', exact: true });
  await expect(timeline).toBeFocused();
  const position = Number(await timeline.inputValue());
  await page.keyboard.press('ArrowRight');
  await expect(timeline).toHaveValue(String(position + 10_000));
  await page.waitForTimeout(600); await expect(timeline).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('Settings');
  await page.keyboard.press('ArrowLeft'); await expect(focused).toHaveText('Episodes');
  await page.waitForTimeout(1100); await expect(focused).toHaveText('Episodes');
});
for (const height of [1080, 720]) test(`remote reaches skip and undo through timeline at ${height}p while playback updates continue`, async ({ page }) => {
  await page.setViewportSize({ width: height * 16 / 9, height });
  await page.addInitScript(() => localStorage.setItem('flixtor-fixture:app', JSON.stringify({
    schema: 1, profiles: [{ id: 'default', name: 'My profile', avatar: 0, quality: 0, autoplay: false, largerBuffer: false, locked: false }],
    libraries: { default: { favorites: [], viewing: [] } }, fit: { horizontal: 5, vertical: 5 },
    skip: { 'mark:t:1:1:1': JSON.stringify([{ id: 'intro', type: 'intro', typeId: 'intro', start: 0, end: 60_000 }]) },
  })));
  await home(page); await openTestSeries(page); await activate(page, '1. Chapter 1');
  const focused = page.locator('button[data-focused="true"]');
  await expect(focused).toHaveText('Settings');
  await page.keyboard.press('ArrowUp'); await expect(page.getByRole('slider', { name: 'Seek' })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Skip intro');
  await page.waitForTimeout(1100); await expect(focused).toHaveText('Skip intro');
  await page.screenshot({ path: `test-results/player-skip-${height}.png` });
  await page.keyboard.press('Enter'); await expect(focused).toHaveText('Skipped intro · Undo');
  await page.waitForTimeout(600); await expect(focused).toHaveText('Skipped intro · Undo');
  await page.keyboard.press('Enter'); await expect(page.getByRole('slider', { name: 'Seek' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Skip intro', exact: true })).toBeAttached();
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Skip intro');
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('slider', { name: 'Seek' })).toBeFocused();
});
test('playback failure retry closes modal and account action leaves player', async ({ page }) => {
  await home(page); await openTestSeries(page);
  await page.evaluate(() => localStorage.setItem('flixtor-fixture:httpOverrides', JSON.stringify({ '/ajax/v4/e/1/1/1': { status: 502, body: '' } })));
  await activate(page, '1. Chapter 1');
  await expect(page.getByRole('dialog', { name: 'Playback unavailable' })).toBeAttached();
  await page.evaluate(() => localStorage.removeItem('flixtor-fixture:httpOverrides'));
  await activate(page, /Try again/); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeAttached();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await expect(page).toHaveURL(/detail/);
  await page.evaluate(() => localStorage.setItem('flixtor-fixture:httpOverrides', JSON.stringify({ '/ajax/v4/e/1/1/1': { status: 502, body: '' } })));
  await activate(page, '1. Chapter 1');
  await activate(page, /Check account in Settings/); await expect(page).toHaveURL(/settings\/account/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('sort choices reorder shelves, preserve profile data and restore after browser navigation', async ({ page }) => {
  await home(page); await activate(page, 'Movies');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); await page.getByRole('button', { name: 'Latest', exact: true }).focus(); await page.keyboard.press('Enter'); await activate(page, 'A–Z'); await expect(page).toHaveURL(/sort=name/);
  await activate(page, 'Northbound'); await expect(page).toHaveURL(/detail/); await page.goBack();
  await expect(page).toHaveURL(/sort=name/); await expect(page.locator('button[data-focused="true"]')).toHaveText('Northbound');
  await activate(page, 'My List'); await expect(page).toHaveURL(/list/); await page.reload();
  await expect(page.getByRole('button', { name: 'My profile', exact: true })).toBeAttached();
});
test('Home starts with discovery, D-pad moves through a distinct movie rail, and detail restores its origin', async ({ page }) => {
  await home(page); await expect(page.locator('button[data-focused="true"]')).toHaveText('Details');
  await page.keyboard.press('ArrowDown'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Northbound');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Northbound');
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Northbound');
  await page.keyboard.press('ArrowUp'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Details');
  await page.keyboard.press('ArrowUp'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Home');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Movies');
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/tmdb=2|imdb=tt1234567|title=m%3A2/);
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/home/);
  await expect(page.locator('button[data-focused="true"]')).toHaveText('Northbound');
});
test('Home restores its saved discovery snapshot on launch', async ({ page }) => {
  await home(page); await expect(page.getByRole('button', { name: 'Northbound', exact: true })).toBeAttached();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => localStorage.getItem('flixtor-fixture:querySnapshot'))).toBeTruthy();
  await page.reload(); await activate(page, 'My profile');
  await expect(page.getByRole('button', { name: 'Northbound', exact: true })).toBeAttached();
});
test('Home keeps its horizontal position across short rails and restores the focused title', async ({ page }) => {
  await home(page);
  const focused = page.locator('button[data-focused="true"]');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('Northbound');
  await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('The Test Series');
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Quiet Harbour');
  await page.keyboard.press('ArrowLeft'); await expect(focused).toHaveText('Northbound');
  await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText('Quiet Harbour');
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/detail/);
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/home/);
  await expect(focused).toHaveText('Quiet Harbour');
});
test('vertical navigation selects visible media without moving either rail horizontally', async ({ page }) => {
  const queries = new QueryClient();
  for (const [catalog, label] of [['top', 'Popular'], ['imdbRating', 'Featured']]) {
    queries.setQueryData(['discovery', 'movie', catalog], Array.from({ length: 18 }, (_, index) => ({
      id: `tt${catalog}${index}`, type: 'movie', name: `${label} ${index + 1}`, genres: [],
    })));
  }
  const snapshot = JSON.stringify({ version: 1, savedAt: Date.now(), state: dehydrate(queries) });
  queries.clear();
  await page.addInitScript(snapshot => localStorage.setItem('flixtor-fixture:querySnapshot', snapshot), snapshot);
  await home(page);
  const focused = page.locator('button[data-focused="true"]');
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText('Popular 1');
  for (let index = 2; index <= 11; index++) {
    await page.keyboard.press('ArrowRight'); await expect(focused).toHaveText(`Popular ${index}`);
  }
  // Let horizontal motion settle before measuring the row's on-screen slots.
  await page.waitForTimeout(400);
  const popular = page.getByRole('button', { name: 'Popular 11', exact: true, includeHidden: true });
  const featured = page.getByRole('button', { name: 'Featured 1', exact: true, includeHidden: true });
  const popularX = await popular.evaluate(node => parseFloat(node.style.left));
  const featuredX = await featured.evaluate(node => parseFloat(node.style.left));
  await page.keyboard.press('ArrowDown'); await expect(focused).toHaveText(/^Featured [1-6]$/);
  await page.waitForTimeout(400);
  expect(await featured.evaluate(node => parseFloat(node.style.left))).toBeCloseTo(featuredX, 0);
  await page.keyboard.press('ArrowUp'); await expect(focused).toHaveText('Popular 11');
  await page.waitForTimeout(400);
  expect(await popular.evaluate(node => parseFloat(node.style.left))).toBeCloseTo(popularX, 0);
});
test('movie shelves keep full posters inside the viewport', async ({ page }) => {
  await home(page); await activate(page, 'Movies');
  const card = page.getByRole('button', { name: 'Northbound', exact: true }).first();
  await expect(card).toBeAttached();
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeGreaterThan(450);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1080);
});
test('confirmation traps focus and restores it after cancellation', async ({ page }) => {
  await home(page); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Exit FlixTor TV?' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeDisabled();
  await expect(page.locator('button[data-focused="true"]')).toHaveText('Stay');
  await page.keyboard.press('Tab'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Exit app');
  await page.keyboard.press('Tab'); await expect(page.locator('button[data-focused="true"]')).toHaveText('Stay');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
});
test('PIN pad rejects wrong digits, ignores held digits and unlocks with hardware input', async ({ page }) => {
  const hash = createHash('sha256').update('default:1234').digest('hex');
  await page.addInitScript(hash => {
    localStorage.setItem('flixtor-fixture:app', JSON.stringify({ schema: 1, profiles: [{ id: 'default', name: 'My profile', avatar: 0, quality: 0, autoplay: true, largerBuffer: false, locked: true }], libraries: { default: { favorites: [], viewing: [] } }, skip: {}, fit: { horizontal: 5, vertical: 5 } }));
    localStorage.setItem('flixtor-fixture:pin:default', hash);
  }, hash);
  await page.goto('/'); await activate(page, 'My profile');
  await expect(page.getByRole('dialog', { name: 'Unlock My profile' })).toBeAttached();
  await page.keyboard.type('1111'); await expect(page.locator('#status')).toContainText('Incorrect PIN');
  await page.keyboard.down('1'); await page.keyboard.down('1'); await page.keyboard.up('1'); await page.keyboard.type('234');
  await expect(page).toHaveURL(/home/); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('profile text entry uses the shared keyboard and persists the name', async ({ page }) => {
  await page.goto('/'); await activate(page, 'Add profile'); await expect(page.getByRole('dialog', { name: 'Profile name' })).toBeAttached();
  await page.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Alice'); await activate(page, 'Save');
  await expect(page.getByRole('button', { name: 'Alice', exact: true })).toBeAttached();
  await page.reload(); await expect(page.getByRole('button', { name: 'Alice', exact: true })).toBeAttached();
});
test('search preserves text focus through refresh and supports direct hardware typing', async ({ page }) => {
  await home(page); await activate(page, 'Search');
  const field = page.getByRole('textbox', { name: 'Search films and TV shows' });
  await field.fill('north'); await expect(page).toHaveURL(/q=north/); await expect(field).toBeFocused();
  await field.fill('quiet'); await expect(page).toHaveURL(/q=quiet/); await expect(field).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.type('abc'); await expect(field).toHaveValue('quietabc');
  await expect(page).toHaveURL(/q=quietabc/);
});
test('search keeps entry inline and Right moves from the field to results', async ({ page }) => {
  await home(page); await activate(page, 'Search');
  await expect(page.getByRole('button', { name: 'View results' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: 'Search films and TV shows' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(field).toBeFocused();
  await expect(page.getByRole('button', { name: 'Voice search' })).toHaveCount(0);
  await page.keyboard.type('north'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=north/);
  await expect(page.getByRole('button', { name: 'The Test Series', exact: true })).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('button[data-focused="true"]')).toHaveText('The Test Series');
  const bounds = await page.getByRole('button', { name: 'The Test Series', exact: true }).boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.height).toBeGreaterThan(bounds!.width * 1.3);
});
test('search voice fills and submits the recognized text', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('flixtor-fixture:voice', JSON.stringify({ text: 'Northbound' })));
  await home(page); await activate(page, 'Search');
  const voice = page.getByRole('button', { name: 'Voice search', exact: true });
  await expect(voice).toBeAttached();
  await activate(page, 'Voice search');
  await expect(page).toHaveURL(/q=Northbound/);
  await expect(page.getByRole('textbox', { name: 'Search films and TV shows', exact: true })).toHaveValue('Northbound');
  await expect(page.getByRole('button', { name: 'The Test Series', exact: true })).toBeAttached();
});
test('screen-fit Cancel discards draft and Save persists it', async ({ page }) => {
  await home(page); await activate(page, 'Settings'); await activate(page, 'Display'); await activate(page, /Display, Adjust screen fit/);
  await activate(page, 'Increase horizontal'); await activate(page, 'Cancel');
  await expect(page.getByRole('button', { name: /Display, Adjust screen fit, 5% \/ 5%/ })).toBeAttached();
  await activate(page, /Display, Adjust screen fit/); await activate(page, 'Increase horizontal'); await activate(page, 'Save screen fit');
  await expect(page.getByRole('button', { name: /Display, Adjust screen fit, 6% \/ 5%/ })).toBeAttached();
});
for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
  test(`pointer targets match animated controls at ${viewport.height}p`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/');
    await page.getByRole('button', { name: 'My profile', exact: true }).click();
    await page.getByRole('button', { name: 'TV shows', exact: true }).click();
    await page.getByRole('button', { name: 'The Test Series', exact: true }).first().click();
    await page.getByRole('button', { name: '2. Chapter 2', exact: true }).click(); await expect(page).toHaveURL(/player/);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /settings, Subtitles/ }).click();
    await expect(page.getByRole('button', { name: /subtitle settings, Subtitle track/ })).toBeAttached();
  });
}
