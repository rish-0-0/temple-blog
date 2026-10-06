declare module '@astrojs/sitemap' {
  import type { AstroIntegration } from 'astro';

  interface SitemapItem {
    url: string;
    lastmod?: string;
    changefreq?: string;
    priority?: number;
  }

  interface SitemapOptions {
    filter?: (page: string) => boolean;
    serialize?: (item: SitemapItem) => SitemapItem | undefined | Promise<SitemapItem | undefined>;
  }

  export default function sitemap(options?: SitemapOptions): AstroIntegration;
}
