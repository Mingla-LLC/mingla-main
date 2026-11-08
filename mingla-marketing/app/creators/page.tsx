import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LandingMedia } from '@/components/landing/landing-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { hostWebPageHref } from '@/lib/app-handoff'
import { siteAttribution } from '@/lib/links-src'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Mingla Creators, in the approved design: the headline,
// "Set up my creator profile" (→ host.usemingla.com/creator/setup on every
// device, §8, built through the #4137 seam: lib/app-handoff.ts
// hostWebPageHref → lib/cta-destination.ts) and "Creator agreement"
// (→ /creator-agreement), four clips and the three steps. The step copy is the
// live page's programme facts.

export const metadata: Metadata = {
  title: 'Mingla Creators — Get hired to show people what a city feels like',
  description:
    'Create short videos for Mingla hosts, agree the work before the shoot, deliver privately and get paid through your connected payout provider.',
}

const CREATOR_SETUP_HREF = hostWebPageHref('/creator/setup', siteAttribution('business_hero'))

const CLIPS: readonly LandingMediaRef[] = ['v:amapiano', 'v:salsa', 'v:pottery', 'v:beach']

const STEPS = [
  {
    title: 'Set up your profile',
    body: 'Build your profile now. Creator mode stays private until every readiness check is complete.',
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
            <a className="btn cta" href={CREATOR_SETUP_HREF}>
              Set up my creator profile <ArrowRight aria-hidden="true" />
            </a>
            <Link className="btn soft" href="/creator-agreement">
              Creator agreement
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
          </div>
        </section>
      </SitePage>
    </div>
  )
}
