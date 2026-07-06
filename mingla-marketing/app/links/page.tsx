// ORCH-1317 [Mingla link-in-bio page] — usemingla.com/links.
//
// The single link Mingla puts in its social bios (Linktree-style). This is a thin
// SERVER Component: it owns the SEO metadata and the default tagline, then renders
// the client <LinksExperience/> which holds the accessible tabs, CTAs, analytics,
// and socials. All link/tab data lives in lib/links-config.ts (extensible, §5).

import type { Metadata } from 'next'
import { LinksExperience } from '@/components/marketing/links-experience'

// Shipped default tagline (see the ORCH-1317 report for the alternates). It's the
// canonical brand line, so /links reads consistently with the rest of the site.
const LINKS_TAGLINE = 'Find a vibe, not a venue.'

export const metadata: Metadata = {
  title: 'Get Mingla',
  description:
    'Mingla is the experiences app for date nights, things to do, and your city’s hidden gems. Get the app, or if you run a venue, event, or trip, get started on the web.',
  alternates: { canonical: '/links' },
  openGraph: {
    title: 'Get Mingla',
    description:
      'The experiences app for date nights, things to do, and your city’s hidden gems.',
    url: '/links',
    type: 'website',
  },
}

export default function LinksPage() {
  return <LinksExperience tagline={LINKS_TAGLINE} />
}
