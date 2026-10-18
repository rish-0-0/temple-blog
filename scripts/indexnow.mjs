// Notifies IndexNow after a production Workers build.
// Cloudflare runs the same `astro build` for preview branches and for production.
// It does not set a production flag, so this submits only when Workers Builds is
// building this repo's production branch (`main`). Local builds and every other
// branch skip the request. A failed request never fails the build.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDEXNOW_KEY = 'c89cc9f9fdb036ab6b915b639fbad731';
export const INDEXNOW_HOST = 'temples.sibani-panigrahy.com';
export const PRODUCTION_BRANCH = 'main';
export const RECENT_POST_DAYS = 14;
export const RECENT_POST_MS = RECENT_POST_DAYS * 24 * 60 * 60 * 1000;
export const MAX_URLS = 100;
const SUBMIT_TIMEOUT_MS = 8000;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const POST_URL = new RegExp(`^https://${INDEXNOW_HOST.replaceAll('.', '\\.')}/posts/[^/]+/$`);

export function isProductionWorkersBuild(env = process.env) {
  return env.WORKERS_CI === '1' && env.WORKERS_CI_BRANCH === PRODUCTION_BRANCH;
}

export function indexnowIntegration() {
  return {
    name: 'indexnow',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        try {
          await submitIndexNow({ distDir: fileURLToPath(dir), logger });
        } catch (err) {
          warn(logger, `IndexNow submit failed (${errorMessage(err)}); build continues.`);
        }
      },
    },
  };
}

/**
 * @param {{
 *   distDir: string,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: Date,
 *   logger?: { info?: (msg: string) => void, warn?: (msg: string) => void },
 *   recentMs?: number,
 *   limit?: number,
 * }} options
 */
export async function submitIndexNow({
  distDir,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  logger,
  recentMs = RECENT_POST_MS,
  limit = MAX_URLS,
}) {
  const keyReady = await confirmKeyFile(distDir, logger);
  if (!isProductionWorkersBuild(env)) {
    const branch = env.WORKERS_CI_BRANCH || 'unset';
    const workersCi = env.WORKERS_CI || 'unset';
    info(
      logger,
      `IndexNow submit skipped (WORKERS_CI=${workersCi}, WORKERS_CI_BRANCH=${branch}). Submits run only for the production Workers build of ${PRODUCTION_BRANCH}.`,
    );
    return { submitted: 0, skipped: true };
  }
  if (!keyReady) return { submitted: 0, skipped: true };

  try {
    const urlList = await recentPostUrls(distDir, now, recentMs, limit);
    if (urlList.length === 0) {
      info(logger, `IndexNow submit skipped; no post URLs changed within the last ${RECENT_POST_DAYS} days.`);
      return { submitted: 0, skipped: true };
    }
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      warn(
        logger,
        `IndexNow submit failed (HTTP ${res.status}); build continues. ${detail.slice(0, 200)}`.trim(),
      );
      return { submitted: 0, error: true };
    }
    info(logger, `IndexNow submitted ${urlList.length} post URL(s).`);
    return { submitted: urlList.length };
  } catch (err) {
    warn(logger, `IndexNow submit failed (${errorMessage(err)}); build continues.`);
    return { submitted: 0, error: true };
  }
}

async function confirmKeyFile(distDir, logger) {
  const file = join(distDir, `${INDEXNOW_KEY}.txt`);
  try {
    const body = await readFile(file, 'utf8');
    if (body !== INDEXNOW_KEY) {
      warn(logger, `IndexNow key file ${file} does not contain exactly the expected key.`);
      return false;
    }
    info(logger, `IndexNow key file ready at ${file} (${Buffer.byteLength(body)} bytes).`);
    return true;
  } catch (err) {
    warn(logger, `IndexNow key file missing at ${file} (${errorMessage(err)}).`);
    return false;
  }
}

async function recentPostUrls(distDir, now, recentMs, limit) {
  const indexXml = await readFile(join(distDir, 'sitemap-index.xml'), 'utf8');
  const childNames = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => sitemapFileName(decodeXml(match[1].trim())))
    .filter((name) => name && /^sitemap-\d+\.xml$/.test(name));

  const cutoff = now.getTime() - recentMs;
  /** @type {{ loc: string, time: number }[]} */
  const recent = [];
  for (const name of childNames) {
    const xml = await readFile(join(distDir, name), 'utf8');
    for (const entry of parseUrlset(xml)) {
      if (!POST_URL.test(entry.loc) || !entry.lastmod) continue;
      const time = Date.parse(entry.lastmod);
      if (Number.isNaN(time) || time < cutoff) continue;
      recent.push({ loc: entry.loc, time });
    }
  }
  recent.sort((a, b) => b.time - a.time);
  return recent.slice(0, limit).map((entry) => entry.loc);
}

function sitemapFileName(loc) {
  try {
    const name = new URL(loc).pathname.split('/').pop() ?? '';
    return name.includes('..') ? '' : name;
  } catch {
    return '';
  }
}

function parseUrlset(xml) {
  /** @type {{ loc: string, lastmod?: string }[]} */
  const entries = [];
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = match[1];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    if (!loc) continue;
    entries.push({
      loc: decodeXml(loc.trim()),
      lastmod: lastmod ? decodeXml(lastmod.trim()) : undefined,
    });
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function info(logger, message) {
  if (typeof logger?.info === 'function') logger.info(message);
  else console.log(message);
}

function warn(logger, message) {
  if (typeof logger?.warn === 'function') logger.warn(message);
  else console.warn(message);
}

function errorMessage(err) {
  return err instanceof Error ? err.message : 'unknown error';
}
