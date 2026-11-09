import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LandingMedia } from '@/components/landing/landing-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1003 [Venue Website Grader — growth tools, test cut] — the /tools hub.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav, the headline
// and four tool cards, each with its clip and opening its live tool page
// (/tools/venues, /tools/events, /tools/trips, /tools/pricing), over the
// canonical footer (app/tools/layout.tsx renders this page bare). The SEO
// contract is unchanged: the search_ready metadata for "/tools".
// #4339 phase 2c — the tool pages moved onto the same frame; the brand faces
// now come from app/tools/layout.tsx for the whole /tools tree.

export const metadata = searchRouteMetadata('/tools')

interface ToolCard {
  href: '/tools/venues' | '/tools/events' | '/tools/trips' | '/tools/pricing'
  title: string
  body: string
  forWho: string
  cta: string
  media: LandingMediaRef
}

const TOOLS: readonly ToolCard[] = [
  {
    href: '/tools/venues',
    title: 'Venue Website Grader',
    body: 'Find out what your website says to a first-timer, and exactly what it’s costing you. Free report in 60 seconds.',
    forWho: 'Restaurants · Bars · Cafés · Clubs',
    cta: 'Grade my website',
    media: 'v:cafe',
  },
  {
    href: '/tools/events',
    title: 'Event Turnout Predictor',
    body: 'How many people will actually show up? Get a turnout forecast, and see what your promo budget can buy. Free, in under a minute.',
    forWho: 'Event organisers · Promoters',
    cta: 'Forecast my turnout',
    media: 'v:crowd',
  },
  {
    href: '/tools/trips',
    title: 'Quote Any Trip',
    body: 'Price a group trip in a minute: real hotels and activities, a full cost sheet, and exactly what to charge per person. Free.',
    forWho: 'Travel organisers · Trip hosts',
    cta: 'Quote a trip',
    media: 'v:sailing',
  },
  {
    href: '/tools/pricing',
    title: 'The Undercharging Audit',
    body: 'Priced by guilt? See your true cost per head, including your own time, and the price you should actually charge. Free.',
    forWho: 'Experience hosts · Activity spaces',
    cta: 'Audit my pricing',
    media: 'v:pottery',
  },
]

export default function ToolsHubPage() {
  return (
    <div>
      <SitePage surface="host" current="tools">
        <PageHero
          title={
            <>
              Free AI tools for people who <em>run real places.</em>
            </>
          }
          lead="No sign-up, no sales call. Run one, get something useful in a minute, built by Mingla, the app that helps people find your place."
        />
        <section className="pb-100" aria-label="Free tools">
          <div className="wrap">
            <ul className="grid2">
              {TOOLS.map((tool) => (
                <li key={tool.href}>
                  <Link className="card tool-card reveal" href={tool.href}>
                    <div className="ph">
                      <LandingMedia media={tool.media} />
                    </div>
                    <div className="body">
                      <h2 className="h3">{tool.title}</h2>
                      <p className="muted">{tool.body}</p>
                      <span className="for">{tool.forWho}</span>
                      <span className="btn ink">
                        {tool.cta} <ArrowRight aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
