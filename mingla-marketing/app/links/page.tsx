// ORCH-1317 [Mingla link-in-bio page] — usemingla.com/links.
//
// The single link Mingla puts in its social bios (Linktree-style). This is a thin
// SERVER Component: it owns the SEO metadata and the default tagline, then renders
// the client <LinksExperience/> which holds the accessible tabs, CTAs, analytics,
// and socials. All link/tab data lives in lib/links-config.ts (extensible, §5).

import { LinksExperience } from '@/components/marketing/links-experience'
import { sanitizeLinksSrc } from '@/lib/links-src'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// Shipped default tagline (see the ORCH-1317 report for the alternates). It's the
// canonical brand line, so /links reads consistently with the rest of the site.
const LINKS_TAGLINE = 'Find a vibe, not a venue.'

export const metadata = publicNoindexMetadata('/links', {
  title: 'Get Mingla',
  description:
    'Mingla is the experiences app for date nights, things to do, and your city’s hidden gems. Get the app, or if you run a venue, event, or trip, get started on the web.',
})

// ORCH-1399 [links-src-tracking-getapp-stack] — `?src=` SOURCE TRACKING.
//
// `usemingla.com/links?src=youtube` carries the source into the OneLink as
// `pid=bio_youtube`, so an install from Seth's YouTube bio is attributable whichever
// app the visitor picks. Today every bio install is anonymous.
//
// WHY THE SERVER `searchParams` PROP AND NOT `useSearchParams()`:
//  - no Suspense boundary needed (useSearchParams() requires one, or the build errors)
//  - the value is present in the FIRST PAINT — no client-only flicker / hydration risk
//  - it stays a pure function, testable with the repo's plain tsc+node pattern
// Reading searchParams opts this route into dynamic rendering — correct and intended.
// The route is explicitly public-noindex, so `?src=` variants cannot fragment search.
//
// `src` is UNTRUSTED INPUT that reaches an OUTBOUND URL. It is sanitised HERE, once,
// at the boundary — never passed raw. Next hands repeated params (`?src=a&src=b`) as
// `string[]`, which sanitizeLinksSrc treats as ambiguous and fails safe on.
//
// Resolved ONCE here and passed DOWN as a prop, so it is a page-level value that
// switching Explorer↔Business cannot lose — by structure, not by discipline (§4.4).
export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string | string[] }>
}) {
  const { src } = await searchParams
  return <LinksExperience tagline={LINKS_TAGLINE} src={sanitizeLinksSrc(src)} />
}
