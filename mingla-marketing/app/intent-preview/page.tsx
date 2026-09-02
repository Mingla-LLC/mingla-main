import { IntentCard } from '@/components/sections/explorer-home/intent-card'
import { EventCard } from '@/components/sections/explorer-home/event-card'
import { HeroPlaceDeck } from '@/components/sections/explorer-home/hero-place-deck'
import { DC_INTENT_PLANS } from '@/lib/dc-intent-plans'
import { DC_SHOWCASE_EVENTS } from '@/lib/dc-showcase-events'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// ---------------------------------------------------------------
// Intent Cards — preview route (ORCH-1007 [marketing real place cards — DC])
//
// Standalone "let's see" preview. Renders all 4 intent cards in a responsive
// grid on the marketing background, plus ONE existing single place-card deck
// beside them for side-by-side comparison. The production hero stays
// untouched — this is purely additive (new route + new component + new data).
// ---------------------------------------------------------------

export const metadata = publicNoindexMetadata('/intent-preview', {
  title: 'Intent cards — preview',
})

export default function IntentPreviewPage() {
  return (
    <main
      className="min-h-screen w-full"
      style={{ background: 'var(--color-smoke)' }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-16">
        <header className="mb-12 text-center">
          <p
            className="font-sans"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-warm)',
            }}
          >
            ORCH-1007 · preview
          </p>
          <h1
            className="font-display"
            style={{
              marginTop: '8px',
              fontSize: '28px',
              lineHeight: 1.15,
              color: '#ffffff',
            }}
          >
            Intent cards — preview
          </h1>
          <p
            className="font-sans"
            style={{
              marginTop: '10px',
              maxWidth: '34rem',
              fontSize: '14px',
              lineHeight: 1.45,
              color: 'rgba(255,255,255,0.62)',
            }}
          >
            A snapshot of a multi-stop Mingla experience — a themed sequence of
            real DC places you&rsquo;d do together. The single place card sits
            beside them for comparison.
          </p>
        </header>

        {/* Intent cards — responsive grid, centered */}
        <section
          aria-label="Intent card previews"
          className="flex w-full flex-wrap items-start justify-center gap-8"
        >
          {DC_INTENT_PLANS.map((plan) => (
            <IntentCard key={plan.id} plan={plan} isFront eager />
          ))}
        </section>

        {/* Side-by-side: one existing single place-card deck for comparison */}
        <section
          aria-label="Single place card, for comparison"
          className="mt-20 flex w-full flex-col items-center"
        >
          <p
            className="font-sans"
            style={{
              marginBottom: '8px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            for comparison — the single place card
          </p>
          <HeroPlaceDeck />
        </section>

        {/* Event cards — the THIRD marketing card type (ORCH-1007 §E.1–E.11).
            All 6 DC showcase events: 4 real Ticketmaster events + 2 Mingla Host
            samples (one photo cover, one coverHue striped fallback).
            Rendered statically (like the intent grid) for the "let's see" pass. */}
        <section
          aria-label="Event card previews"
          className="mt-20 flex w-full flex-col items-center"
        >
          <p
            className="font-sans"
            style={{
              marginBottom: '4px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-warm)',
            }}
          >
            Event cards
          </p>
          <h2
            className="font-display"
            style={{
              marginBottom: '24px',
              fontSize: '22px',
              lineHeight: 1.15,
              color: '#ffffff',
            }}
          >
            Events happening in DC
          </h2>
          <div className="flex w-full flex-wrap items-start justify-center gap-8">
            {DC_SHOWCASE_EVENTS.map((event) => (
              <EventCard
                key={`${event.source}-${event.title}`}
                event={event}
                isFront
                eager
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
