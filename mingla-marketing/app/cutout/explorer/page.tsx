import type { Metadata } from 'next'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import {
  CutoutFooter,
  CutoutHero,
  CutoutNav,
  CutoutSection,
  CutoutShell,
  CutReveal,
  DeviceCta,
  HeroGraphic,
} from '@/components/cutout'
import { CutoutPlaceCard } from '@/components/cutout/place-card'
import { LAGOS_VENUES } from '@/lib/design-preview/lagos-truth'

// #2902 — EXPLORER home, Cutout skin.
//
// Per Seth's ruling the Explorer home keeps its CURRENT shape: one viewport, a
// full hero, no long scroll. Only the styling and motion change. So this is not
// a landing page and deliberately does not carry the answer block, the section
// stack or the schema-heavy treatment — those belong to the city and intent
// pages, which is where Explorer search demand is actually served.
//
// What the Cutout skin adds here: the page shell, the floating pill nav with
// its overhanging device-aware action, and the deck rendered as cut-out media
// windows instead of the current dark stacked cards.

export const metadata: Metadata = {
  title: 'Explorer — #2902 Cutout preview',
  description: 'Review-only Cutout skin of the Mingla Explorer home.',
  robots: { index: false, follow: false },
}

const LEGAL = [
  { href: '/support', label: 'Support' },
  { href: '/privacy-policy', label: 'Privacy' },
  { href: '/terms-of-service', label: 'Terms' },
  { href: '/host', label: 'Mingla Host' },
]

export default function CutoutExplorerPage() {
  // Four full cards overflowed 1440x900 and ran clean off a 390x844 phone.
  // The Explorer home is a one-viewport page by ruling, so the deck is compact
  // and drops to two cards on a phone.
  const deck = LAGOS_VENUES.slice(0, 4)

  return (
    <CutoutShell>
      <CutoutNav surface="explorer" homeHref="/cutout/explorer" />

      {/* AIgocy's hero composition, on the Explorer surface. The page stays a
          SINGLE VIEWPORT per Seth's ruling: the deck sits inside the hero as a
          drifting card rail behind the scrim rather than as a second block. */}
      <CutoutHero
        eyebrow="Lagos · London · US cities"
        line1="Find a vibe,"
        line2={
          <>
            <span className="cut-gradient-brand">not a venue.</span>
            <HeroGraphic />
          </>
        }
        lede="Tell Mingla the night you want. Get a place — or a whole plan — that fits. On your own, or with the people you love."
        image={LAGOS_VENUES[0]?.photo ?? ''}
        actions={
          <>
            <DeviceCta surface="explorer" location="hero" variant="primary" size="lg" />
            <Link href="/cutout/host" className="cut-btn cut-btn-light h-[3.75rem] px-8 font-display text-base focus-ring">
              I run a place
            </Link>
          </>
        }
        scrollTo="#places"
        footnote={<span>Free. Live in Lagos, London and US cities.</span>}
      />

      {/* The deck — real Lagos places, framed through cut-out windows. Sits
          immediately under the fold so the hero itself stays one viewport. */}
      <CutoutSection id="places" rhythm="tight" aria-label="Places on Mingla in Lagos">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {deck.map((venue, i) => (
            <CutReveal key={venue.placeKey} variant="lift" delay={i * 0.08}>
              <CutoutPlaceCard venue={venue} eager={i < 2} compact />
            </CutReveal>
          ))}
        </div>
        <CutReveal delay={0.3}>
          <nav aria-label="Site information" className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="cut-btn-light rounded-full px-4 py-2.5 text-[0.8125rem] font-semibold text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </CutReveal>
      </CutoutSection>

      <CutoutFooter surface="explorer" />
    </CutoutShell>
  )
}
