import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mingla — Date Plans & City Gems',
    short_name: 'Mingla',
    description: 'Find date plans, city gems, events, and experiences that fit the vibe.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#08090b',
    theme_color: '#eb7825',
    icons: [
      {
        src: '/brand/mingla-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/mingla-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
