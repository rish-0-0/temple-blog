const API_URL = import.meta.env.STRAPI_API_URL;
const API_TOKEN = import.meta.env.STRAPI_API_TOKEN;

export interface StrapiImage {
  url: string;
  alternativeText: string | null;
  caption: string | null;
  width: number;
  height: number;
  formats?: Record<string, { url: string; width: number; height: number }>;
}

export interface TemplePost {
  id: number;
  title: string;
  temple_name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  slug: string;
  body: string | null;
  publishedAt: string;
  cover_image: StrapiImage | null;
  author: { display_name: string; bio: string | null; avatar: StrapiImage | null } | null;
  tags: { name: string; slug: string }[];
  post_images: { caption: string | null; order: number | null; image: StrapiImage | null }[];
  seo: { meta_title: string | null; meta_description: string | null; og_image: StrapiImage | null } | null;
}

const POPULATE = [
  'populate[cover_image]=true',
  'populate[tags]=true',
  'populate[author][populate][avatar]=true',
  'populate[post_images][populate][image]=true',
  'populate[seo][populate][og_image]=true',
].join('&');

export async function getTemplePosts(): Promise<TemplePost[]> {
  const res = await fetch(
    `${API_URL}/api/temple-posts?${POPULATE}&sort=publishedAt:desc&pagination[pageSize]=100`,
    { headers: { Authorization: `Bearer ${API_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`Strapi request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data as TemplePost[];
}
