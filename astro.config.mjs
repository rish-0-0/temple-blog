// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

const SITE = 'https://temples.sibani-panigrahy.com';
const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Strapi credentials for post lastmod only. Page rendering still reads
 * import.meta.env. loadEnv applies .env files for the build mode, then
 * process.env wins. Missing credentials omit lastmod; they do not fail the build.
 * @returns {{ apiUrl?: string, token?: string }}
 */
function strapiCredentials() {
  const mode = process.env.NODE_ENV || 'production';
  const env = loadEnv(mode, root, '');
  return {
    apiUrl: env.STRAPI_API_URL,
    token: env.STRAPI_API_TOKEN,
  };
}

/** @type {Promise<Map<string, string>> | undefined} */
let postLastmods;

function loadPostLastmods() {
  postLastmods ??= fetchPostLastmods();
  return postLastmods;
}

/** Slug → ISO timestamp (updatedAt, then publishedAt). */
async function fetchPostLastmods() {
  /** @type {Map<string, string>} */
  const lastmods = new Map();
  const { apiUrl, token } = strapiCredentials();
  if (!apiUrl || !token) {
    console.warn('[sitemap] STRAPI_API_URL or STRAPI_API_TOKEN missing; post lastmod omitted.');
    return lastmods;
  }

  const origin = apiUrl.replace(/\/$/, '');
  let page = 1;
  let pageCount = 1;
  try {
    while (page <= pageCount && page <= 100) {
      const endpoint = new URL(`${origin}/api/temple-posts`);
      endpoint.searchParams.set('sort', 'publishedAt:desc');
      endpoint.searchParams.set('pagination[page]', String(page));
      endpoint.searchParams.set('pagination[pageSize]', '100');
      endpoint.searchParams.set('fields[0]', 'slug');
      endpoint.searchParams.set('fields[1]', 'updatedAt');
      endpoint.searchParams.set('fields[2]', 'publishedAt');
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn(`[sitemap] Post date lookup failed (${res.status}); post lastmod omitted.`);
        return lastmods;
      }
      const json = await res.json();
      pageCount = Number(json?.meta?.pagination?.pageCount ?? page);
      for (const post of json?.data ?? []) {
        const date = post?.updatedAt || post?.publishedAt;
        if (typeof post?.slug === 'string' && typeof date === 'string') {
          lastmods.set(post.slug, date);
        }
      }
      page += 1;
    }
  } catch (err) {
    console.warn(
      `[sitemap] Post date lookup failed (${err instanceof Error ? err.message : 'unknown error'}); post lastmod omitted.`,
    );
  }
  return lastmods;
}

export default defineConfig({
  site: SITE,
  // Static directory URLs (/about/, /posts/<slug>/), matching in-page links.
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter(page) {
        const pathname = new URL(page).pathname.replace(/\/$/, '') || '/';
        return pathname !== '/404';
      },
      async serialize(item) {
        const lastmods = await loadPostLastmods();
        const slug = new URL(item.url).pathname.match(/^\/posts\/([^/]+)\/$/)?.[1];
        const date = slug ? lastmods.get(decodeURIComponent(slug)) : undefined;
        if (date) {
          const parsed = new Date(date);
          if (!Number.isNaN(parsed.getTime())) item.lastmod = parsed.toISOString();
        }
        return item;
      },
    }),
  ],
});
