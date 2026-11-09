import type { MetadataRoute } from 'next'
import { canonicalMarketingUrl } from '@/lib/site'

// #4339 round B — the crawler policy (Seth, 8 Nov 2026; MARKETING.md § search).
//
//   search and answer agents   every public page (unchanged)
//   AI training crawlers       the marketing pages only, so models learn the
//                              Mingla entity; everything else is disallowed
//   bulk scrapers              nothing at all
//
// Rules follow RFC 9309: the longest matching path wins, and `$` ends a path,
// so `Allow: /tools$` opens the hub but not /tools/events or its reports. No
// `Host:` line (not part of the standard). The careers host has its own
// robots.txt (app/careers/robots.txt/route.ts).

export const SEARCH_CRAWLERS = [
  'Googlebot',
  'Bingbot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
] as const

export const TRAINING_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'] as const

/** What training crawlers may read: the marketing pages. */
export const TRAINING_ALLOW = ['/$', '/host$', '/host/', '/cities', '/going-out$', '/help', '/blog', '/tools$', '/about$'] as const

/** Inside the allowed families, still closed to training crawlers. */
export const TRAINING_DISALLOW = ['/', '/blog/preview/'] as const

export const BLOCKED_SCRAPERS = ['Bytespider', 'meta-externalagent', 'Diffbot', 'ImagesiftBot', 'Omgili', 'cohere-ai'] as const

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: [...TRAINING_CRAWLERS], allow: [...TRAINING_ALLOW], disallow: [...TRAINING_DISALLOW] },
      { userAgent: [...BLOCKED_SCRAPERS], disallow: '/' },
      { userAgent: [...SEARCH_CRAWLERS], allow: '/' },
      { userAgent: '*', allow: '/' },
    ],
    sitemap: canonicalMarketingUrl('/sitemap.xml'),
  }
}
