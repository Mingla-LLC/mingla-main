// #4137 — small pure helpers shared by blog components (server and client).

/** `d MMM yyyy` in en-GB, using the post's UTC date. */
export function formatBlogDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function readTime(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min read`
}

export function blogPostPath(slug: string): `/blog/${string}` {
  return `/blog/${slug}`
}
