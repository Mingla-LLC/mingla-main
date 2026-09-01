import type { Metadata } from 'next'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import {
  CutoutFooter,
  CutoutNav,
  CutoutSection,
  CutoutShell,
  CutReveal,
  DeviceCta,
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

      <CutoutSection
        rhythm="hero"
        aria-label="Mingla for Explorers"
        className="flex min-h-[calc(100svh-1rem)] flex-col justify-center pb-8 pt-28 sm:pb-10 sm:pt-32"
      >
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <CutReveal variant="headline">
              <h1 className="max-w-[13ch] font-display text-[clamp(2.75rem,6.2vw,5rem)] leading-[1.0] tracking-[-0.035em] text-[var(--cut-ink)]">
                Find a vibe,{' '}
                <span className="text-[var(--cut-accent)]">not a venue.</span>
              </h1>
            </CutReveal>

            <CutReveal delay={0.12}>
              <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)] sm:text-lg">
                Tell Mingla what kind of night it is. Get back a plan you can send to the group —
                real places, in the right order, that everyone can agree on before Friday.
              </p>
            </CutReveal>

            <CutReveal delay={0.22}>
              {/* Both actions must sit on ONE row at 390px or the hero loses a
                  whole line of vertical budget it does not have. */}
              <div className="mt-8 flex flex-nowrap items-center gap-2.5 sm:gap-3">
                <DeviceCta
                  surface="explorer"
                  location="hero"
                  variant="primary"
                  size="lg"
                  className="!h-12 !px-5 sm:!h-14 sm:!px-7"
                />
                <Link
                  href="/cutout/host"
                  className="inline-flex h-12 shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--cut-card)] px-5 font-display text-[0.9375rem] font-medium text-[var(--cut-ink)] shadow-[var(--cut-shadow-card)] transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:shadow-[var(--cut-shadow-card-hover)] focus-ring sm:h-14 sm:px-7 sm:text-base"
                >
                  I run a place
                </Link>
              </div>
            </CutReveal>

            <CutReveal delay={0.3}>
              <p className="mt-5 text-[0.8125rem] leading-relaxed text-[var(--cut-muted)]">
                Live in Lagos, London and US cities. Free to download.
              </p>
            </CutReveal>
          </div>

          {/* The deck — real Lagos places, each framed through a cut-out window.
              The third and fourth cards are desktop-only: on a phone they are
              the difference between one viewport and two. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {deck.map((venue, i) => (
              <CutReveal
                key={venue.placeKey}
                variant="lift"
                delay={0.16 + i * 0.09}
                className={cn(
                  i % 2 === 1 ? 'lg:translate-y-6' : undefined,
                  i > 1 ? 'hidden sm:block' : undefined,
                )}
              >
                <CutoutPlaceCard venue={venue} eager={i < 2} compact />
              </CutReveal>
            ))}
          </div>
        </div>

        <CutReveal delay={0.42}>
          <nav
            aria-label="Site information"
            className="mt-8 hidden flex-wrap items-center justify-center gap-2 sm:mt-12 sm:flex"
          >
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-full bg-[var(--cut-card)] px-4 py-2 text-[0.8125rem] font-medium text-[var(--cut-body)] shadow-[var(--cut-shadow-card)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
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
