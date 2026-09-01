import type { MetadataRoute } from 'next'
import { canonicalMarketingUrl, SITE_ORIGIN } from '@/lib/site'

const SEARCH_CRAWLERS = [
  'Googlebot',
  'Bingbot',
  'OAI-SearchBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
] as const

const TRAINING_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Google-Extended'] as const

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: [...TRAINING_CRAWLERS], disallow: '/' },
      { userAgent: [...SEARCH_CRAWLERS], allow: '/' },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: canonicalMarketingUrl('/sitemap.xml'),
    host: SITE_ORIGIN,
  }
}
