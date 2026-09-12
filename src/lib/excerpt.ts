import type { TemplePost } from './strapi';

// Short description: prefer SEO meta description, else a plain-text excerpt of the body
export function shortDescription(post: TemplePost): string {
  if (post.seo?.meta_description) return post.seo.meta_description;
  if (!post.body) return '';
  const text = post.body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 150 ? `${text.slice(0, 150).replace(/\S*$/, '').trim()}…` : text;
}
