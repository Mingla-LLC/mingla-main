import path from 'node:path'
import type { NextConfig } from 'next'
import { nextRedirectsFromRegistry } from './lib/search/route-registry'

// Security + content-protection headers. SEO-safe: crawlers still receive the
// full server-rendered HTML/metadata; these only stop the site (and its
// creative) from being embedded/framed by other origins, block MIME sniffing,
// and trim referrer leakage.
//
// #4339 round B (anti-copy) — a Content-Security-Policy. Two headers:
//
//   ENFORCED     frame-ancestors 'self' (unchanged), object-src 'none',
//                base-uri 'self', form-action 'self', and script-src: our own
//                scripts (and Next's inline bootstrap, which App Router needs
//                without per-request nonces) plus GA4 (googletagmanager) and
//                PostHog's asset host. An injected third-party scraper or
//                widget script does not run.
//   REPORT-ONLY  the full policy, adding connect-src, img-src, media-src,
//                frame-src, font-src and style-src. These depend on runtime
//                origins we cannot prove from source alone (Bamboo's HLS CDN
//                for the help videos, blog YouTube/Vimeo embeds, event covers
//                hosted elsewhere), so the browser reports instead of
//                blocking until a live check shows no violations; then move
//                them into the enforced header.
function supabaseOrigins(): string[] {
  const out = new Set<string>(['https://gqnoajqerqhnvulmnyvv.supabase.co', 'https://gqnoajqerqhnvulmnyvv.functions.supabase.co'])
  for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL]) {
    try {
      if (value) out.add(new URL(value).origin)
    } catch {
      // A malformed value adds nothing; the authority origins stay.
    }
  }
  return [...out]
}

const CSP_SCRIPT_SRC = [
  "'self'",
  "'unsafe-inline'",
  'https://www.googletagmanager.com',
  'https://*.googletagmanager.com',
  'https://us-assets.i.posthog.com',
]

function contentSecurityPolicy(): { enforced: string; reportOnly: string } {
  const base = [
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `script-src ${CSP_SCRIPT_SRC.join(' ')}`,
  ]
  const full = [
    "default-src 'self'",
    ...base,
    `connect-src 'self' ${supabaseOrigins().join(' ')} https://us.i.posthog.com https://us-assets.i.posthog.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://stats.g.doubleclick.net https://cdnapi.bamboo-cloud.com https://*.bamboo-cloud.com https://*.kaltura.com`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ]
  return { enforced: base.join('; '), reportOnly: full.join('; ') }
}

const csp = contentSecurityPolicy()
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: csp.enforced },
  { key: 'Content-Security-Policy-Report-Only', value: csp.reportOnly },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

// #4137 — blog images are served from the public `blog-media` bucket and go
// through next/image (optimised on Vercel, never Supabase's billed
// /render/image, hold #1643). The host follows NEXT_PUBLIC_SUPABASE_URL so a
// local stack works too; production falls back to the authority project.
// No Google host is listed: place photos can never go through the optimiser.
function blogMediaPattern() {
  const fallback = 'https://gqnoajqerqhnvulmnyvv.supabase.co'
  let url: URL
  try {
    url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || fallback)
  } catch {
    url = new URL(fallback)
  }
  return {
    protocol: url.protocol.replace(':', '') as 'http' | 'https',
    hostname: url.hostname,
    ...(url.port ? { port: url.port } : {}),
    pathname: '/storage/v1/object/public/blog-media/**',
  }
}

// #4339 round B — the event covers on the city pages' "This weekend" cards
// (public `event_covers` bucket), optimised by next/image on Vercel, never by
// Supabase's billed /render/image (hold #1643). Same host rule as blog media.
function eventCoversPattern() {
  return { ...blogMediaPattern(), pathname: '/storage/v1/object/public/event_covers/**' }
}

// #4339 round B (SEO audit 13) — AI crawlers that read HTML without running
// JavaScript get the page's metadata (title, canonical, robots) blocking in
// <head> instead of streamed. Search and answer bots plus the AI training and
// assistant crawlers named in app/robots.ts.
const HTML_LIMITED_BOTS =
  /Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot|Applebot-Extended|CCBot|cohere-ai|Amazonbot|Meta-ExternalAgent|meta-externalfetcher|Bytespider|DuckAssistBot|MistralAI-User/i

// #4339 round B (anti-copy) — work-item references never ship. Developer
// error messages in the source carry the issue that owns them ("#4339
// going-out: …"); this strips the "#<number> " lead from every emitted JS
// string literal after minification, so the built HTML and JS name no issue.
// Only a quote/backtick/[ directly before "#<3–4 digits> " (or "#<n>: ") and
// a lowercase word after it match: CSS colours (#111) and street numbers ("St #120,")
// never do. The gate .github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs
// fails the build if anything is left.
const ISSUE_REF_IN_STRING = /(["'`[])#[1-9]\d{2,3}(?::? (?=[a-z])|: )/g

class StripIssueRefsPlugin {
  apply(compiler: { hooks: { thisCompilation: { tap: (name: string, fn: (compilation: never) => void) => void } }; webpack: { Compilation: { PROCESS_ASSETS_STAGE_SUMMARIZE: number }; sources: { RawSource: new (source: string) => unknown } } }) {
    const { Compilation, sources } = compiler.webpack
    compiler.hooks.thisCompilation.tap('StripIssueRefsPlugin', (compilation: never) => {
      const c = compilation as unknown as {
        hooks: { processAssets: { tap: (opts: { name: string; stage: number }, fn: (assets: Record<string, unknown>) => void) => void } }
        getAsset: (name: string) => { source: { source: () => string | Buffer } } | undefined
        updateAsset: (name: string, source: unknown) => void
      }
      c.hooks.processAssets.tap({ name: 'StripIssueRefsPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE }, (assets) => {
        for (const name of Object.keys(assets)) {
          if (!name.endsWith('.js')) continue
          const asset = c.getAsset(name)
          if (!asset) continue
          const text = asset.source.source().toString()
          const next = text.replace(ISSUE_REF_IN_STRING, '$1')
          if (next !== text) c.updateAsset(name, new sources.RawSource(next))
        }
      })
    })
  }
}

// #4339 speed fix — the city route imports components/cities/city-route.tsx
// (the redesigned page only). The #2983 append-only build lane
// (MINGLA_HISTORICAL_2983_BUILD=1, see lib/search/historical-city-build.ts)
// renders the historical layout instead, so in that build alone the module is
// swapped for city-hub.tsx. The release build never sees city-hub.tsx, so the
// city route ships none of its client islands (framer-motion among them).
const CITY_ROUTE_MODULE = /[\\/]components[\\/]cities[\\/]city-route\.tsx$/
const HISTORICAL_CITY_LAYOUT = path.join(__dirname, 'components/cities/city-hub.tsx')

class HistoricalCityLayoutPlugin {
  apply(compiler: { hooks: { normalModuleFactory: { tap: (name: string, fn: (factory: never) => void) => void } } }) {
    compiler.hooks.normalModuleFactory.tap('HistoricalCityLayoutPlugin', (factory: never) => {
      const f = factory as unknown as {
        hooks: { afterResolve: { tap: (name: string, fn: (data: { createData?: { resource?: string } }) => void) => void } }
      }
      f.hooks.afterResolve.tap('HistoricalCityLayoutPlugin', (data) => {
        const created = data.createData
        if (created?.resource && CITY_ROUTE_MODULE.test(created.resource)) created.resource = HISTORICAL_CITY_LAYOUT
      })
    })
  }
}

const config: NextConfig = {
  webpack(webpackConfig) {
    webpackConfig.plugins = [...(webpackConfig.plugins ?? []), new StripIssueRefsPlugin()]
    if (process.env.MINGLA_HISTORICAL_2983_BUILD === '1') webpackConfig.plugins.push(new HistoricalCityLayoutPlugin())
    return webpackConfig
  },
  htmlLimitedBots: HTML_LIMITED_BOTS,
  // #4339 round B (anti-copy): no `x-powered-by: Next.js` header.
  poweredByHeader: false,
  // #4339 round B (anti-copy): test ids never ship (the gate
  // .github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs fails a
  // build that still contains one).
  compiler: {
    reactRemoveProperties: { properties: ['^data-testid$'] },
  },
  reactStrictMode: true,
  devIndicators: false,
  // Pin trace root to this app so Next does not climb into the parent monorepo
  // and pick up the user-home lockfile.
  outputFileTracingRoot: path.join(__dirname),
  // Never ship original-source browser source maps to production clients, so the
  // un-minified TSX/JSX can't be reconstructed from the deployed bundle.
  productionBrowserSourceMaps: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'framerusercontent.com' },
      blogMediaPattern(),
      eventCoversPattern(),
      // #4339 speed fix — the help centre's video thumbnails (Bamboo's public
      // poster frames), resized to the card by next/image on Vercel instead
      // of a 480 px cross-origin JPEG. Not Supabase: hold #1643 is untouched.
      { protocol: 'https', hostname: 'cdnapi.bamboo-cloud.com', pathname: '/p/0/sp/000/thumbnail/entry_id/**' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // issue #2981 — lifecycle redirects are declared once in the typed search
  // registry, beside sitemap/noindex ownership. Query strings are preserved by
  // Next.js for these path redirects.
  async redirects() {
    return [...nextRedirectsFromRegistry()]
  },
  // #2470 — brand the links that go out in marketing email.
  //
  // Both edge functions already accept a branded origin and fall back to the
  // raw `…supabase.co/functions/v1/…` endpoint when none is configured, which
  // is what every Mingla marketing email carried until now. A bare cloud
  // hostname that shares nothing with the From domain reads as spam to every
  // mailbox provider, and reads as phishing to a human.
  //
  // These land on the apex because brand senders are `<slug>@usemingla.com`,
  // so the link domain and the sender domain become the same registered
  // domain. `/m` is not an existing route, and the middleware passes both
  // paths through untouched (middleware.ts — neither is a careers host nor a
  // public-share path).
  //
  // `/unsubscribe` itself stays exactly as it is: a human-facing opt-out form.
  // Only the tokenised sub-path is proxied, which previously 404'd.
  async rewrites() {
    const functions = 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1'
    return [
      { source: '/m/:trackingId', destination: `${functions}/marketing-track-click/:trackingId` },
      { source: '/unsubscribe/:token', destination: `${functions}/marketing-unsubscribe/:token` },
    ]
  },
}

export default config
