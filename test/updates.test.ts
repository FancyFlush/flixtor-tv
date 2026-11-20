import { describe, expect, it } from 'vitest';
import { createUpdates } from '../src/features/updates/updates';
import type { HostInfo, HttpResponse, Platform } from '../src/platform/platform';

const stableApi = 'https://api.github.com/repos/FancyFlush/flixtor-tv/releases/latest';
const mainApi = 'https://api.github.com/repos/FancyFlush/flixtor-tv/releases/tags/main-latest';
const stableMetadata = 'https://github.com/FancyFlush/flixtor-tv/releases/download/v1.0.7/release.json';
const mainMetadata = 'https://github.com/FancyFlush/flixtor-tv/releases/download/main-latest/release.json';

function fixture(mainStatus = 200) {
  const prepared: Record<string, unknown>[] = [];
  const host: HostInfo = { platform: 'android', version: '1.0.7', versionCode: 1007, sdk: 34, commit: 'old', reportUrl: '', contribution: false };
  const platform: Platform = {
    async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
      if (method === 'installer.prepare') { prepared.push(args); return { ready: true } as T; }
      if (method !== 'http') throw new Error(`Unexpected call: ${method}`);
      const url = String(args.url);
      let response: HttpResponse;
      if (url === stableApi) response = { status: 200, body: JSON.stringify({ assets: [{ name: 'release.json', browser_download_url: stableMetadata }] }) };
      else if (url === mainApi) response = mainStatus === 404
        ? { status: 404, body: '' }
        : { status: 200, body: JSON.stringify({ prerelease: true, assets: [{ name: 'release.json', browser_download_url: mainMetadata }] }) };
      else if (url === stableMetadata) response = { status: 200, body: JSON.stringify(metadata(1007, '1.0.7', 'v1.0.7')) };
      else if (url === mainMetadata) response = { status: 200, body: JSON.stringify(metadata(1008, '1.0.0-main.8', 'main-latest')) };
      else throw new Error(`Unexpected URL: ${url}`);
      return response as T;
    },
    onEvent: () => () => {},
    dispose: () => {},
  };
  return { host, platform, prepared };
}

function metadata(versionCode: number, versionName: string, tag: string) {
  return {
    versionCode,
    versionName,
    minSdk: 29,
    sha256: 'a'.repeat(64),
    apkUrl: `https://github.com/FancyFlush/flixtor-tv/releases/download/${tag}/app-release.apk`,
  };
}

describe('main push updates', () => {
  it('prepares the newer main build even when the stable release is unchanged', async () => {
    const f = fixture();
    const updates = createUpdates(f.platform, f.host);
    try {
      await updates.check();
      expect(updates.state.phase).toBe('ready');
      expect(f.prepared[0]?.versionName).toBe('1.0.0-main.8');
    } finally { updates.dispose(); }
  });

  it('continues checking stable releases before the first main build is published', async () => {
    const f = fixture(404);
    const updates = createUpdates(f.platform, { ...f.host, versionCode: 1006 });
    try {
      await updates.check();
      expect(updates.state.phase).toBe('ready');
      expect(f.prepared[0]?.versionName).toBe('1.0.7');
    } finally { updates.dispose(); }
  });
});
