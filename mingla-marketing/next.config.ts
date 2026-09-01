import path from 'node:path'
import type { NextConfig } from 'next'
import { nextRedirectsFromRegistry } from './lib/search/route-registry'

// Security + content-protection headers. SEO-safe: crawlers still receive the
// full server-rendered HTML/metadata; these only stop the site (and its
// creative) from being embedded/framed by other origins, block MIME sniffing,
// and trim referrer leakage.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

const config: NextConfig = {
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
