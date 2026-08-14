import path from 'node:path'
import type { NextConfig } from 'next'

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
  // #2050 — the Host marketing surface is canonical at /host. Preserve both
  // historical route families with permanent redirects and their sub-paths.
  async redirects() {
    return [
      { source: '/organisers', destination: '/host', permanent: true },
      { source: '/organisers/:path*', destination: '/host/:path*', permanent: true },
      { source: '/business', destination: '/host', permanent: true },
      { source: '/business/:path*', destination: '/host/:path*', permanent: true },
      // #1086 — the scheduler moved /tools/book → /schedule (top-level). Keep the
      // short-lived old path working (it shipped in #1084). Query string is
      // preserved automatically, so ?venue/?report_url/?source carry through.
      { source: '/tools/book', destination: '/schedule', permanent: true },
    ]
  },
}

export default config
