import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin tracing root to this app dir; otherwise Next walks up and may pick a
  // sibling lockfile from the user's home directory.
  outputFileTracingRoot: path.join(__dirname),
  // ORCH-0697-P1-FIX-001: dev server must trust subdomain origins so that
  // Webpack chunk requests from explore.localhost / business.localhost don't
  // time out during client hydration. Production unaffected — Vercel serves
  // all subdomains from one edge origin.
  allowedDevOrigins: [
    'localhost',
    'explore.localhost',
    'business.localhost',
    '127.0.0.1',
  ],
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
