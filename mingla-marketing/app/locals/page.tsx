import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import { PageHero, SitePage } from '@/components/site/site-page'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Mingla Locals, in the approved design: the headline, "Get
// Mingla to apply" (the Explorer hand-off, §3: applications live in the app)
// and "Local agreement" (→ /local-agreement), the three steps, the two
// programme facts and the closing band. The programme facts are the live
// page's, word for word where they are terms (#3872 pins them): up to three
// Locals per open city, $150 after approval, paid by Mingla, never by the place.

export const metadata: Metadata = {
  title: 'Mingla Locals — One honest city review every month',
  description:
    'Apply to represent your city, choose one eligible place each month, publish a first-hand review and earn $150 after Mingla approves it.',
}

const STEPS = [
  {
    title: 'Choose one eligible place',
    body: 'Pick somewhere in your city that no Mingla Local has covered recently and where you have no personal or paid connection.',
  },
  {
    title: 'Visit on your own terms',
    body: 'Go during the month and pay for your own visit. The $150 monthly payment is designed to cover the outing and your work.',
  },
  {
    title: 'Publish a useful first-hand review',
    body: 'Share a specific written review, strong photos or a short video, and your disclosed social post. Mingla reviews the work, not the place.',
  },
]

export default function LocalsPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <PageHero
          title={
            <>
              One honest review, <em>every month.</em>
            </>
          }
          lead="Mingla chooses up to three Locals in each open city. Complete one useful, independent place review each month and earn $150 after approval."
        >
          <div className="row">
            <ExplorerHandoffButton location="locals_apply" className="btn cta" withArrow>
              Get Mingla to apply
            </ExplorerHandoffButton>
            <Link className="btn soft" href="/local-agreement">
              Local agreement
            </Link>
          </div>
        </PageHero>

        <section className="pb-100" aria-labelledby="locals-how">
          <div className="wrap">
            <h2 className="h2 reveal" id="locals-how">
              Independent by design, <em>paid by Mingla.</em>
            </h2>
            <ol className="grid3 mt-40 steps-list">
              {STEPS.map((step, index) => (
                <li key={step.title} className="step reveal">
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{step.title}</h3>
                  <p className="muted">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="grid2 mt-24">
              <div className="card pad fact-card reveal">
                <h3 className="h3">$150 after approval</h3>
                <p>
                  Your payout is converted into your payout currency when it is queued, shown to you, and sent through your
                  connected payout provider. It never comes from the place you reviewed.
                </p>
              </div>
              <div className="card pad fact-card reveal">
                <h3 className="h3">Trust comes first</h3>
                <p>
                  You must disclose the Mingla Local relationship. Personal ties and recent paid work with a place make it
                  ineligible. A place may reply publicly, but it cannot choose, pay or silence you.
                </p>
              </div>
            </div>
            <div className="band reveal mt-24">
              <LandingMedia media="v:amb-locals" />
              <div className="in">
                <div className="band-copy">
                  <h2>
                    Your city, <em>in your words.</em>
                  </h2>
                  <p>
                    Applications appear in Mingla only when a city is open. With three seats per city, a thoughtful sample
                    matters more than a giant following.
                  </p>
                </div>
                <ExplorerHandoffButton location="locals_band" className="btn white">
                  Get Mingla to apply <ArrowRight aria-hidden="true" />
                </ExplorerHandoffButton>
              </div>
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
