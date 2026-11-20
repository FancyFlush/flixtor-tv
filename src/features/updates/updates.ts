import { createStore } from 'solid-js/store';
import type { HostInfo, HttpResponse, Platform } from '../../platform/platform';
import type { Release } from '../../domain/models';
const REPO = 'https://api.github.com/repos/FancyFlush/flixtor-tv/releases/latest';
const MAIN_REPO = 'https://api.github.com/repos/FancyFlush/flixtor-tv/releases/tags/main-latest';
export function createUpdates(platform: Platform, host: HostInfo) {
  const [state, set] = createStore<{ phase: string; version: string; progress: number; incident?: boolean; report: string; error?: string }>({ phase: 'idle', version: '', progress: 0, report: host.reportUrl ? 'idle' : 'unconfigured' });
  let working = false, generation = 0;
  async function response(url: string, signal?: AbortSignal, depth = 0): Promise<HttpResponse> {
    if (depth > 5 || !url.startsWith('https://')) throw new Error('Invalid release response');
    const r = await platform.call<HttpResponse>('http', { client: 'updates', url }, signal);
    if ([301, 302, 303, 307, 308].includes(r.status) && r.location) return response(new URL(r.location, url).href, signal, depth + 1);
    return r;
  }
  async function json(url: string): Promise<Record<string, any>> {
    const r = await response(url);
    if (r.status !== 200) throw new Error('Update service unavailable');
    return JSON.parse(r.body);
  }
  async function optionalJson(url: string): Promise<Record<string, any> | undefined> {
    const r = await response(url);
    if (r.status === 404) return undefined;
    if (r.status !== 200) throw new Error('Update service unavailable');
    return JSON.parse(r.body);
  }
  async function release(latest: Record<string, any>, allowPrerelease: boolean): Promise<Release> {
    const asset = latest.assets?.find((a: { name: string }) => a.name === 'release.json');
    if (!asset || latest.draft || (!allowPrerelease && latest.prerelease)) throw new Error('No release metadata');
    const result = await json(asset.browser_download_url) as unknown as Release;
    if (!Number.isInteger(result.versionCode) || result.versionCode < 1 || !Number.isInteger(result.minSdk) || result.minSdk < 29 ||
      !result.versionName || result.versionName.length > 64 || !/^[a-f\d]{64}$/i.test(result.sha256) ||
      !result.apkUrl?.startsWith('https://github.com/FancyFlush/flixtor-tv/releases/download/') ||
      !/\/(?:flixtor|app-release)\.apk$/.test(result.apkUrl)) throw new Error('Invalid release metadata');
    return result;
  }
  async function check(fingerprint?: string) {
    if (working) return; working = true; const request = ++generation; set({ phase: 'checking', error: undefined });
    try {
      const [stableRelease, mainLatest] = await Promise.all([
        json(REPO),
        optionalJson(MAIN_REPO).catch(() => undefined),
      ]);
      const candidates = [await release(stableRelease, false)];
      if (mainLatest) candidates.push(await release(mainLatest, true));
      const latestRelease = candidates.reduce((latest, candidate) => candidate.versionCode > latest.versionCode ? candidate : latest);
      if (request !== generation) return;
      if (latestRelease.versionCode > host.versionCode) {
        if (latestRelease.minSdk > host.sdk) { set({ phase: 'incompatible', version: latestRelease.versionName }); return; }
        set({ phase: 'downloading', version: latestRelease.versionName });
        await platform.call('installer.prepare', latestRelease as unknown as Record<string, unknown>);
        if (request === generation) set({ phase: 'ready', progress: 100 });
      } else set({ phase: 'current', version: latestRelease.versionName });
      if (fingerprint) {
        try {
          const feed = await json('https://raw.githubusercontent.com/FancyFlush/flixtor-tv/main/incidents.json');
          set('incident', feed.incidents?.some((i: { fingerprint: string; status: string; minVersionCode: number; maxVersionCode: number }) => i.fingerprint === fingerprint && i.status === 'pending' && host.versionCode >= i.minVersionCode && host.versionCode <= i.maxVersionCode) ?? false);
        } catch { set('incident', undefined); }
      }
    } catch { if (request === generation) set({ phase: 'failed', error: 'Update status unavailable. Try again.' }); }
    finally { working = false; }
  }
  async function report(operation: string) {
    if (!host.reportUrl || state.report === 'sending' || state.report === 'sent') return;
    set('report', 'sending');
    try {
      const r = await platform.call<HttpResponse>('http', { client: 'report', url: host.reportUrl, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionCode: host.versionCode, commit: host.commit, operation, fingerprint: operation.toLowerCase() + '.response-v1', category: 'CHANGED' }) });
      if (r.status < 200 || r.status >= 300) throw new Error(); set('report', 'sent');
    } catch { set('report', 'failed'); }
  }
  const timer = setInterval(() => void check(), 6 * 60 * 60_000);
  const unsubscribe = platform.onEvent(event => { if (event.type === 'installer') set('progress', (event.value as { progress: number }).progress); });
  return { state, check, report, install: () => platform.call<{ permission: boolean }>('installer.install'), dispose() { generation++; clearInterval(timer); unsubscribe(); } };
}
