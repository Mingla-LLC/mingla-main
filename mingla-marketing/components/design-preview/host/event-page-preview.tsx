'use client'
import { CalendarDays, MapPin, Ticket } from 'lucide-react'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'

// #2902 — the Host proof surface: what an organiser's event actually looks like
// once it is published.
//
// The tokens below are NOT invented for this page. They are the same values
// `app/event-preview/EventPreviewClient.tsx` already duplicates from
// `packages/offering-rendering/designTokens.ts` — the real renderer both Mingla
// apps use for an event. So this frame is a faithful replica of the shipped
// event page, not a marketing impression of one.
//
// The EVENT ITSELF is fictional, on purpose. Attaching an invented night to a
// real named Lagos or Triangle venue is exactly the claim this preview forbids,
// so the sample uses a made-up promoter and room, mirrors the shipped
// `/event-preview?sample=1` sample pattern, and is labelled illustrative.

const T = {
  bg: '#0c0e12',
  text: '#ffffff',
  text2: 'rgba(255,255,255,0.72)',
  text3: 'rgba(255,255,255,0.48)',
  accent: '#ff8a3b',
  accentWash: 'rgba(255,138,59,0.16)',
  accentBorder: 'rgba(255,138,59,0.32)',
  card: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.10)',
  inverse: '#0c0e12',
} as const

const TIERS = [
  { name: 'Early release', price: '£12', note: 'Sold out', soldOut: true },
  { name: 'General admission', price: '£18', note: '64 left', soldOut: false },
  { name: 'Table of six', price: '£150', note: '3 left', soldOut: false },
] as const

const TAGS = ['Live band', 'Late set', 'Standing', '18+'] as const

interface EventPagePreviewProps {
  /** Renders the frame without the outer label row, for use inside a demo panel. */
  bare?: boolean
}

export function EventPagePreview({ bare = false }: EventPagePreviewProps) {
  return (
    <div className="w-full max-w-[24rem]">
      {!bare ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
            The published page
          </span>
          <ProvenanceChip kind="illustrative" />
        </div>
      ) : null}

      <div
        role="img"
        aria-label="A published Mingla event page preview showing the cover, date, venue, description, tags and three ticket tiers."
        className="overflow-hidden rounded-[1.5rem] ring-1 ring-inset"
        style={{ background: T.bg, borderColor: T.border, boxShadow: 'var(--elev-3)' }}
      >
        <div
          aria-hidden="true"
          className="relative flex aspect-[4/3] w-full items-end overflow-hidden p-6"
          style={{
            background:
              'radial-gradient(circle at 78% 18%, rgba(255,138,59,0.6), transparent 34%), linear-gradient(145deg, #2e1747 0%, #10131d 52%, #090b10 100%)',
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div className="absolute left-[12%] top-[14%] h-28 w-28 rounded-full border border-white/15" />
          <div className="absolute right-[10%] top-[24%] h-20 w-20 rounded-full bg-warm/20 blur-xl" />
          <div className="relative max-w-[16rem] text-left">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-warm">Live in the room</span>
            <strong className="mt-2 block font-display text-3xl leading-tight text-white">Basement Sessions</strong>
            <span className="mt-2 block text-xs text-white/65">Music first. Late set. One unforgettable night.</span>
          </div>
        </div>

        <div className="p-5" style={{ fontFamily: 'var(--font-dashboard)' }}>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{
              background: T.accentWash,
              color: T.accent,
              border: `1px solid ${T.accentBorder}`,
            }}
          >
            Club night
          </span>

          <h3
            className="mt-3 text-[26px] font-black leading-[1.08] tracking-[-0.02em]"
            style={{ color: T.text }}
          >
            Basement Sessions — Volume Nine
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: T.text2 }}>
            A four-hour live-into-DJ set in a low room with a proper system. Doors at nine, band on
            at ten, no phones on the floor after midnight.
          </p>

          {/* Date + venue row — the real event page's card row. */}
          <div
            className="mt-4 flex flex-col gap-2.5 rounded-[18px] p-3.5"
            style={{ background: T.card, border: `1px solid ${T.border}` }}
          >
            <span className="flex items-center gap-2.5 text-[13px]" style={{ color: T.text }}>
              <CalendarDays className="h-4 w-4 shrink-0" style={{ color: T.accent }} aria-hidden="true" />
              Saturday, 4 October · Doors 21:00
            </span>
            <span className="flex items-center gap-2.5 text-[13px]" style={{ color: T.text }}>
              <MapPin className="h-4 w-4 shrink-0" style={{ color: T.accent }} aria-hidden="true" />
              The Long Room
            </span>
          </div>

          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {TAGS.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: T.card, color: T.text2, border: `1px solid ${T.border}` }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Inline tickets box — radius 18, matching the shipped renderer. */}
          <div
            className="mt-4 rounded-[18px] p-3.5"
            style={{ background: T.card, border: `1px solid ${T.border}` }}
          >
            <span
              className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ color: T.text3 }}
            >
              <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
              Tickets
            </span>
            <ul className="mt-3 space-y-2">
              {TIERS.map((tier) => (
                <li
                  key={tier.name}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${T.border}`,
                    opacity: tier.soldOut ? 0.5 : 1,
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold" style={{ color: T.text }}>
                      {tier.name}
                    </span>
                    <span className="block text-[11px]" style={{ color: T.text3 }}>
                      {tier.note}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-[15px] font-bold tabular-nums"
                    style={{ color: tier.soldOut ? T.text3 : T.text }}
                  >
                    {tier.price}
                  </span>
                </li>
              ))}
            </ul>
            <div
              className="mt-3 flex min-h-11 items-center justify-center rounded-full text-[14px] font-bold"
              style={{ background: T.accent, color: T.inverse }}
            >
              Get tickets
            </div>
            <p className="mt-2.5 text-center text-[11px] leading-relaxed" style={{ color: T.text3 }}>
              One all-in price. Fees and tax are a single line the buyer sees before paying.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
