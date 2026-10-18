import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  indexnowIntegration,
  isProductionWorkersBuild,
  submitIndexNow,
} from './indexnow.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('isProductionWorkersBuild', () => {
  it('accepts only the production Workers build of main', () => {
    assert.equal(isProductionWorkersBuild({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' }), true);
    assert.equal(isProductionWorkersBuild({}), false);
    assert.equal(isProductionWorkersBuild({ CI: 'true', WORKERS_CI_BRANCH: 'main' }), false);
    assert.equal(
      isProductionWorkersBuild({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'cursor/indexnow-key-42ee' }),
      false,
    );
    assert.equal(isProductionWorkersBuild({ WORKERS_CI: '1' }), false);
    assert.equal(isProductionWorkersBuild({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'MAIN' }), false);
  });
});

describe('key file', () => {
  it('is the exact key with no trailing newline', async () => {
    const body = await readFile(new URL('../public/c89cc9f9fdb036ab6b915b639fbad731.txt', import.meta.url));
    assert.deepEqual(body, Buffer.from(INDEXNOW_KEY));
  });
});

describe('submitIndexNow', () => {
  it('does not call IndexNow outside the production Workers build', async () => {
    const dist = await fixture();
    try {
      let called = false;
      const result = await submitIndexNow({
        distDir: dist,
        env: { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'cursor/indexnow-key-42ee' },
        fetchImpl: async () => {
          called = true;
          throw new Error('should not be called');
        },
        now: NOW,
        logger: silent(),
      });
      assert.equal(called, false);
      assert.deepEqual(result, { submitted: 0, skipped: true });
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  it('posts recent post URLs and ignores a failed response', async () => {
    const dist = await fixture();
    try {
      /** @type {RequestInit | undefined} */
      let init;
      const ok = await submitIndexNow({
        distDir: dist,
        env: { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' },
        fetchImpl: async (_url, options) => {
          init = options;
          return { ok: true, text: async () => '' };
        },
        now: NOW,
        logger: silent(),
      });
      assert.equal(ok.submitted, 2);
      assert.equal(init?.method, 'POST');
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(payload, {
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: [
          `https://${INDEXNOW_HOST}/posts/new-temple/`,
          `https://${INDEXNOW_HOST}/posts/a&b/`,
        ],
      });

      const failed = await submitIndexNow({
        distDir: dist,
        env: { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' },
        fetchImpl: async () => {
          throw new Error('network down');
        },
        now: NOW,
        logger: silent(),
      });
      assert.deepEqual(failed, { submitted: 0, error: true });

      const rejected = await submitIndexNow({
        distDir: dist,
        env: { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' },
        fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'key not found' }),
        now: NOW,
        logger: silent(),
      });
      assert.deepEqual(rejected, { submitted: 0, error: true });
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  it('does not throw from the build hook when the output directory is missing', async () => {
    const previous = { WORKERS_CI: process.env.WORKERS_CI, WORKERS_CI_BRANCH: process.env.WORKERS_CI_BRANCH };
    process.env.WORKERS_CI = '1';
    process.env.WORKERS_CI_BRANCH = 'main';
    try {
      await indexnowIntegration().hooks['astro:build:done']({
        dir: new URL(`file://${join(tmpdir(), 'indexnow-missing-dist')}/`),
        logger: silent(),
      });
    } finally {
      restoreEnv(previous);
    }
  });
});

async function fixture() {
  const dist = await mkdtemp(join(tmpdir(), 'indexnow-'));
  const recent = new Date(NOW.getTime() - DAY).toISOString();
  const alsoRecent = new Date(NOW.getTime() - 2 * DAY).toISOString();
  const stale = new Date(NOW.getTime() - 20 * DAY).toISOString();
  await writeFile(join(dist, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  await writeFile(
    join(dist, 'sitemap-index.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex><sitemap><loc>https://${INDEXNOW_HOST}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
  );
  await writeFile(
    join(dist, 'sitemap-0.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset>
      <url><loc>https://${INDEXNOW_HOST}/</loc><lastmod>${recent}</lastmod></url>
      <url><loc>https://${INDEXNOW_HOST}/posts/</loc><lastmod>${recent}</lastmod></url>
      <url><loc>https://${INDEXNOW_HOST}/about/</loc><lastmod>${recent}</lastmod></url>
      <url><loc>https://${INDEXNOW_HOST}/posts/old-temple/</loc><lastmod>${stale}</lastmod></url>
      <url><loc>https://${INDEXNOW_HOST}/posts/undated/</loc></url>
      <url><loc>https://${INDEXNOW_HOST}/posts/new-temple/</loc><lastmod>${recent}</lastmod></url>
      <url><loc>https://${INDEXNOW_HOST}/posts/a&amp;b/</loc><lastmod>${alsoRecent}</lastmod></url>
    </urlset>`,
  );
  return dist;
}

function silent() {
  return { info() {}, warn() {} };
}

function restoreEnv(previous) {
  if (previous.WORKERS_CI === undefined) delete process.env.WORKERS_CI;
  else process.env.WORKERS_CI = previous.WORKERS_CI;
  if (previous.WORKERS_CI_BRANCH === undefined) delete process.env.WORKERS_CI_BRANCH;
  else process.env.WORKERS_CI_BRANCH = previous.WORKERS_CI_BRANCH;
}
