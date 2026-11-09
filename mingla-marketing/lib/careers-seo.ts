// #4339 round B (SEO audit 19, 20) — career.usemingla.com's own search
// surface: one title template, JobPosting markup on each open role, and the
// host's own robots.txt and sitemap (the apex ones describe usemingla.com).
// React-free and pure (the node test loads it).

import type { JobPosting } from './careers-data'

export const CAREERS_ORIGIN = 'https://career.usemingla.com'
export const CAREERS_TITLE_TEMPLATE = '%s | Mingla Careers'
export const CAREERS_DEFAULT_TITLE = 'Careers at Mingla'

/** A role title as the page title: never a second brand suffix. */
export function careersPageTitle(title: string): string {
  const clean = title.replace(/\s*[—–|-]\s*Mingla(?: Careers)?\s*$/i, '').trim()
  return clean || 'Role'
}

const EMPLOYMENT: Readonly<Record<string, string>> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  contractor: 'CONTRACTOR',
  internship: 'INTERN',
  intern: 'INTERN',
  temporary: 'TEMPORARY',
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** schema.org JobPosting for one OPEN role (Google for Jobs). */
export function jobPostingStructuredData(role: JobPosting): Record<string, unknown> {
  const remote = /remote/i.test(role.location)
  const description = plainText(role.body ?? '') || role.summary
  const posting: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: careersPageTitle(role.title),
    description,
    datePosted: role.created_at.slice(0, 10),
    url: `${CAREERS_ORIGIN}/roles/${role.slug}`,
    identifier: { '@type': 'PropertyValue', name: 'Mingla', value: role.slug },
    hiringOrganization: {
      '@type': 'Organization',
      name: 'Mingla',
      sameAs: 'https://usemingla.com',
      logo: 'https://usemingla.com/brand/mingla-logo-white-on-orange.png',
    },
    directApply: true,
  }
  const employment = EMPLOYMENT[role.employment_type]
  if (employment) posting.employmentType = employment
  if (remote) {
    posting.jobLocationType = 'TELECOMMUTE'
    const region = role.location.replace(/remote/i, '').replace(/[()·,\-–—]/g, ' ').trim()
    if (region) posting.applicantLocationRequirements = { '@type': 'Country', name: region }
  } else {
    posting.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: role.location } }
  }
  return posting
}

export function serializeJobPosting(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** career.usemingla.com/robots.txt: everything public, its own sitemap, no Host line. */
export function careersRobotsTxt(): string {
  return ['User-Agent: *', 'Allow: /', 'Disallow: /roles/*/apply', '', `Sitemap: ${CAREERS_ORIGIN}/sitemap.xml`, ''].join('\n')
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** career.usemingla.com/sitemap.xml: the index and every open role. */
export function careersSitemapXml(roles: readonly Pick<JobPosting, 'slug' | 'created_at'>[]): string {
  const urls = [
    `<url><loc>${CAREERS_ORIGIN}/</loc></url>`,
    ...roles.map((role) => `<url><loc>${escapeXml(`${CAREERS_ORIGIN}/roles/${encodeURIComponent(role.slug)}`)}</loc><lastmod>${escapeXml(role.created_at.slice(0, 10))}</lastmod></url>`),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
