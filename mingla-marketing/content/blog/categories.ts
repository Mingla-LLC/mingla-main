// #4137 — the four blog categories, mirrored from the blog_categories seed in
// supabase/migrations/20280120004137_issue_4137_blog_schema.sql. The route
// registry projects one search contract per category from this list, so the
// category pages and the sitemap never need the database to exist.
// There is no city category, ever (Seth: blogs are not city guides).

export interface BlogCategoryRecord {
  readonly slug: 'going-out' | 'date-ideas' | 'host-playbook' | 'product-news'
  readonly label: string
  readonly description: string
}

export const BLOG_CATEGORIES = [
  {
    slug: 'going-out',
    label: 'Going out',
    description: 'Where to go and what to do: plans for nights out, weekends and slow afternoons, from the people building Mingla.',
  },
  {
    slug: 'date-ideas',
    label: 'Date ideas',
    description: 'First dates, second dates and the ones after: easy plans for talking, laughing and finding somewhere worth going together.',
  },
  {
    slug: 'host-playbook',
    label: 'Host playbook',
    description: 'The playbook for hosts: pricing, selling out, marketing and running the door for events, venues, trips and experiences.',
  },
  {
    slug: 'product-news',
    label: 'Product news',
    description: 'What is new in Mingla and Mingla Host: features that just shipped, what they do and how to use them.',
  },
] as const satisfies readonly BlogCategoryRecord[]

export type BlogCategorySlug = (typeof BLOG_CATEGORIES)[number]['slug']

export function blogCategoryForSlug(slug: string): BlogCategoryRecord | null {
  return BLOG_CATEGORIES.find((category) => category.slug === slug) ?? null
}

export function blogCategoryPath(slug: BlogCategorySlug): `/blog/category/${string}` {
  return `/blog/category/${slug}`
}
