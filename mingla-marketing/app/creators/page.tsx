import type { Metadata } from 'next'
import { searchRouteMetadata } from '@/lib/search/metadata'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Mingla Creators, in the approved design: the headline, four
// clips and the three steps. The step copy is the live page's programme facts.
//
// #4339 Creators and Locals calls (Seth approved, 9 Nov): creator setup lives
// in the Mingla (Explorer) app, so the primary button is "Get Mingla to join",
// the device-aware Explorer hand-off (a phone goes to the Explorer store, a
// computer gets the QR sheet with no web option). The second button and the
// closing band are "Book a call" (/schedule/creators). The Creator agreement
// is accepted in the app; one line of fine print links to it.

// #4339 round B: registered in lib/search/route-registry.ts (one absolute title).
export const metadata: Metadata = searchRouteMetadata('/creators')

const CLIPS: readonly LandingMediaRef[] = ['v:amapiano', 'v:salsa', 'v:pottery', 'v:beach']

const STEPS = [
  {
    title: 'Set up your profile',
    body: 'Build your profile in Mingla. Creator mode stays private until every readiness check is complete.',
  },
  {
    title: 'Get hired',
    body: 'See the city, format, dates and budget before you raise your hand. Host names stay private until a hire is agreed.',
  },
  {
    title: 'Get paid',
    body: 'Your contract, delivery and payout status stay together. Mingla does not turn your earnings into a wallet balance.',
  },
]

export default function CreatorsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="host">
        <PageHero
          title={
            <>
              Get hired to show people what a city <em>feels like.</em>
            </>
          }
          lead="Mingla Creators make the videos and photos that help people choose. Become a Creator and complete paid gigs for places and events on Mingla."
        >
          <div className="row">
            <ExplorerHandoffButton location="creators_join" className="btn cta" withArrow>
              Get Mingla to join
            </ExplorerHandoffButton>
            <Link className="btn soft" href="/schedule/creators">
              Book a call
            </Link>
          </div>
        </PageHero>

        <section className="pb-100" aria-label="How Mingla Creators works">
          <div className="wrap">
            <div className="grid4 reel-grid" aria-hidden="true">
              {CLIPS.map((clip) => (
                <div className="ph reveal" key={clip}>
                  <LandingMedia media={clip} />
                </div>
              ))}
            </div>
            <ol className="grid3 mt-24 steps-list">
              {STEPS.map((step, index) => (
                <li key={step.title} className="step reveal">
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <h2 className="step-title">{step.title}</h2>
                  <p className="muted">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="band reveal mt-24">
              <LandingMedia media="v:salsa" />
              <div className="in">
                <h2>
                  Questions <em>first?</em>
                </h2>
                <div className="glassbar">
                  <span className="bring">Talk to the Creators team</span>
                  <Link className="btn white" href="/schedule/creators">
                    Book a call <ArrowRight aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
            <p className="fine-legal">
              You’ll read and accept the <Link href="/creator-agreement">Creator agreement</Link> inside Mingla before
              your first gig.
            </p>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
