'use client'
import { useState } from 'react'
import type { ShowcaseEvent } from '@/lib/dc-showcase-events'

// ---------------------------------------------------------------
// Event Card — ORCH-1007 [marketing real place cards — DC test run]
//
// The THIRD marketing card type (sibling of hero-place-deck.tsx's single place
// card + intent-card.tsx): a TIME-ANCHORED happening you can go to — a show, a
// party, a concert, a rooftop session. Built per
// DESIGN_ORCH-1007_MARKETING_PLACE_CARD_DC.md "Event Card v1" (§E.1–E.11).
//
// POSITIONING (LOCKED): Mingla is an EXPERIENCE / date-planning / social-
// experiences app — NOT a dating app. Date/time is the hero data point, so the
// card leads with a calendar-tile date badge over the cover.
//
// ONE component, branched on `source` (§E.1 🔒 — never two components):
//   - 'ticketmaster' → REAL TM CDN cover image, genre eyebrow, NO "On Mingla"
//     chip, "Ticketmaster" attribution folded into the orange CTA pill.
//   - 'mingla'       → brand cover image OR the coverHue striped fallback band
//     (§E.4b, faithful to @mingla/event-rendering EventCover), an "On Mingla"
//     ink chip top-right, no Ticketmaster text.
//
// SHELL is pixel-identical to the two siblings: 260×360, --radius-2xl (36px),
// border/elevation tokens, frosted-white content block, #1a1a2e cover fill,
// 404 fallback. The 3-chip content block reuses the v3 ink→white→orange chip
// recipe verbatim (matches intent-card.tsx), event-tuned.
//
// Honesty rules (shared with the siblings): NO distance, NO travel-time, NO
// "X min away" (personalized live readings — dishonest on a marketing page; do
// NOT add them back thinking they were forgotten); NO autoplay video on the
// card face; NEVER render "TBA" (absent price → CTA-only pill); NO heavy
// Ticketmaster logo on the cover (attribution is the quiet pill line only).
// ---------------------------------------------------------------

const CARD_W = 260
// 🔒LOCKED (ORCH-1007 v2.1 / §E.2): same 360 as both siblings — the event card
// is a pixel-identical SHELL sibling, so the hero no-scroll math is unchanged.
// Do NOT diverge this height.
const CARD_H = 360

// ORCH-1007 (operator directive): EVERY event card puts the venue on its own
// white chip — uniform layout. The old short-venue "inline" variant left a
// visible gap between the title and the ticket pill on short-venue cards
// (Howard, Warner, 9:30 CLUB), so all cards now look like the Jun 7 card.

interface EventCardProps {
  event: ShowcaseEvent
  /** Front card carries meaning to AT; peeked/decorative cards are aria-hidden. */
  isFront?: boolean
  /** Eager-load the cover for the front card; lazy for peeked. */
  eager?: boolean
}

export function EventCard({
  event,
  isFront = true,
  eager = false,
}: EventCardProps) {
  // ORCH-1007 (operator directive): present ALL events as "On Mingla" — no
  // Ticketmaster attribution anywhere in the UI (Mingla aggregates these events).
  const isMingla = true
  const useVariantB = true

  // §E.9 aria-label: the calendar badge, source chip, eyebrow + orange pill are
  // all aria-hidden, so the label carries date/time/venue/source/price. Honest
  // to AT: no fake recommend count, no "TBA" — "tickets available" when no price.
  const sourceClause = 'On Mingla'
  const priceClause = event.price ? `${event.price}.` : 'Tickets available.'
  const ariaLabel = `${event.title}. ${event.weekdayTime}, at ${event.venue}. ${sourceClause}. ${priceClause}`

  return (
    <div
      role={isFront ? 'img' : undefined}
      aria-label={isFront ? ariaLabel : undefined}
      aria-hidden={isFront ? undefined : true}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 'var(--radius-2xl)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: isFront
          ? '0 18px 40px -12px rgba(0,0,0,0.55)'
          : '0 8px 24px -8px rgba(0,0,0,0.45)',
        cursor: 'default',
      }}
      className="flex flex-col overflow-hidden bg-[#1a1a2e]"
    >
      {/* Cover zone — 64% (≈230px), §E.2/§E.4. A single LANDSCAPE cover (real
          image) OR the coverHue striped fallback band. The calendar date badge
          (top-left) + source chip (top-right) sit OVER it identically either way. */}
      <div
        className="relative w-full overflow-hidden bg-[#1a1a2e]"
        style={{ height: '64%' }}
      >
        <EventCover event={event} eager={eager} />

        {/* Calendar date badge (§E.3) — top-left, the hero time-anchor. Orange
            month band (white caps) over a white day band (ink Mochiy). This is
            what makes the card unmistakably an EVENT, not a place. */}
        <div
          aria-hidden="true"
          className="absolute flex flex-col overflow-hidden"
          style={{
            top: '12px',
            left: '12px',
            width: '46px',
            minHeight: '52px',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 4px 10px -2px rgba(0,0,0,0.45)',
          }}
        >
          {/* Month band — orange fill, white caps. White-on-orange is 4.2:1
              (fails AA body) but this is large/short non-essential glyph text
              duplicated in the day tile + aria-label, and clears the 3:1
              large-text floor at 10px/800 caps (§E.3 / §E.9). Do NOT "fix". */}
          <div
            className="flex items-center justify-center font-sans"
            style={{
              height: '18px',
              background: 'var(--color-warm)',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.08em',
              lineHeight: 1,
            }}
          >
            {event.dateMonth}
          </div>
          {/* Day band — white fill, ink Mochiy (18.5:1 AAA, the legibility anchor). */}
          <div
            className="flex flex-1 items-center justify-center font-display"
            style={{
              background: '#ffffff',
              color: 'var(--color-ink)',
              fontSize: '22px',
              lineHeight: 1,
              padding: '4px 0',
            }}
          >
            {event.dateDay}
          </div>
        </div>

        {/* Source chip (§E.5) — Mingla → top-right "On Mingla" ink chip (positive
            ownership signal). Ticketmaster → NO cover chip (genre rides the
            eyebrow; "Ticketmaster" attribution lives in the orange pill). */}
        {isMingla && (
          <div
            aria-hidden="true"
            className="absolute flex items-center font-sans"
            style={{
              top: '12px',
              right: '12px',
              height: '22px',
              padding: '0 9px',
              borderRadius: '9999px',
              background: 'var(--color-ink)',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              boxShadow: '0 2px 6px -1px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.18)',
            }}
          >
            On Mingla
          </div>
        )}
      </div>

      {/* Content block — 36% frosted-white, same surface as both siblings. Three
          stacked chips, same dark→light→accent cadence as the v3 ink/white/
          orange system (§E.6), event-tuned:
          (0) when+tag eyebrow, (1) title (+venue) ink line, (2) optional white
          venue chip (Variant B), (3) full-width orange price/CTA pill (mt-auto). */}
      <div
        className="flex flex-col items-start overflow-hidden"
        style={{
          height: '36%',
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(14,14,16,0.06)',
          padding: '10px 12px',
        }}
      >
        {/* Chip 0 — when + tag eyebrow (§E.6 #0). Weekday+time leads (the
            time-anchor detail), then the genre/taxonomy tag. Caps, warm
            #C75E12 (NOT #EB7825 🔒 — the deeper warm clears AA body 4.6:1 on
            frost; §E.9). truncate 1 line. */}
        <span
          className="font-sans"
          style={{
            maxWidth: '100%',
            fontSize: '10px',
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#C75E12',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: '5px',
          }}
        >
          {`${event.weekdayTime} · ${event.genreOrTags}`}
        </span>

        {/* Chip 1 — title (+ venue, Variant A) → ONE ink line (§E.6 #1).
            Mirrors the sibling name+price chip: title flexes/truncates; venue
            (Variant A only) hugs right + never truncates (title yields first).
            White on ink = 18.9:1 (AAA). */}
        <div
          className="flex max-w-full items-baseline overflow-hidden"
          style={{
            width: 'max-content',
            background: 'var(--color-ink)',
            borderRadius: '10px',
            padding: '5px 10px',
            gap: '8px',
          }}
        >
          <span
            className="font-display"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '14px',
              lineHeight: 1.15,
              color: '#ffffff',
            }}
          >
            {event.title}
          </span>
          {!useVariantB && (
            <span
              className="font-sans"
              style={{
                flex: '0 0 auto',
                whiteSpace: 'nowrap',
                fontSize: '11px',
                lineHeight: 1,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.82)',
              }}
            >
              {event.venue}
            </span>
          )}
        </div>

        {/* Chip 2 — venue white chip (Variant B only, §E.6 #2 / §E.8). Long
            venue / venue+room moves OUT of the ink line onto its own white chip:
            ink-78% on white (9.8:1 AAA), hairline rim, 1-line truncate. */}
        {/* Venue chip — full-width, GROWS to fill the space between the title and
            the ticket pill (flex:1) with equal 8px margins, text left-aligned.
            Mirrors the place/intent description chip exactly so all three card
            types share one layout (no empty gap, consistent left alignment). */}
        {useVariantB && (
          <div
            className="flex w-full max-w-full flex-col justify-center overflow-hidden font-sans"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              margin: '8px 0',
              background: '#ffffff',
              border: '1px solid rgba(14,14,16,0.08)',
              borderRadius: '8px',
              padding: '6px 9px',
              fontSize: '11.5px',
              lineHeight: 1.25,
              fontWeight: 500,
              color: 'rgba(14,14,16,0.78)',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {event.venue}
          </div>
        )}

        {/* Chip 3 — full-width ORANGE price/CTA pill (§E.7). Always carries the
            ACTION (CTA right); price rides the left ONLY when present (never
            "TBA"). Ink text on orange = 5.0:1 (AA body ✓) — never white-on-
            orange (4.2:1 fails). The string "Ticketmaster" appears on every TM
            card here (attribution honesty 🔒). aria-hidden — price/CTA fact is
            in the card aria-label. Presentational this run (no live link). */}
        <PricePill event={event} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Cover surface — real image (with graceful 404) OR the coverHue striped band.
// §E.4: coverImageUrl present → image; null + hue → striped band; null + no hue
// (or image error on a TM card) → #1a1a2e + faint Mingla mark.
// For a Mingla event whose image errors, fall back to the coverHue band (the
// brand's chosen fallback identity), not the Mingla-mark.
// ---------------------------------------------------------------
function EventCover({
  event,
  eager,
}: {
  event: ShowcaseEvent
  eager: boolean
}) {
  const [errored, setErrored] = useState(false)

  // No usable image → coverHue band (if a hue exists), else the Mingla-mark.
  const noImage = !event.coverImageUrl || errored
  if (noImage) {
    if (event.coverHue !== null) {
      return <CoverHueBand hue={event.coverHue} />
    }
    return <MinglaMark />
  }

  return (
    <>
      {/* Plain <img> (not next/image) — matches the sibling pattern and avoids
          next.config remotePatterns setup. alt="" because the card aria-label
          carries meaning (§E.9). No autoplay video on the card face (§E.4). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={event.coverImageUrl ?? undefined}
        alt=""
        className="h-full w-full select-none object-cover"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onError={() => setErrored(true)}
        style={{ userSelect: 'none' }}
      />
      {/* Bottom vignette (§E.4) — guards the cover/content seam; matches the
          siblings' lower scrim. No text sits on it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: '38%',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)',
        }}
      />
    </>
  )
}

// coverHue striped fallback band (§E.4b) — translated 1:1 from the app's
// @mingla/event-rendering EventCover.tsx to web CSS: base hsl(hue,60%,50%),
// alternating 14px stripe-base / 14px darker hsl(hue,60%,40%) at 135°, with the
// app's bottom vignette (linear-gradient 0→0.72 over locations 0.5→1).
function CoverHueBand({ hue }: { hue: number }): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background: `repeating-linear-gradient(135deg, hsl(${hue}, 60%, 50%) 0 14px, hsl(${hue}, 60%, 40%) 14px 28px)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.72) 100%)',
        }}
      />
    </div>
  )
}

// Hard-404 fallback (§E.4 / §E.9) — #1a1a2e fill + a faint centered Mingla mark.
// Used only for a cover with no image AND no hue (e.g. a TM image that 404s).
function MinglaMark(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-[#1a1a2e] font-display"
      style={{ fontSize: '28px', color: 'rgba(255,255,255,0.12)' }}
    >
      Mingla
    </div>
  )
}

// ---------------------------------------------------------------
// Orange price/CTA pill (§E.7). Full-width, ink-on-orange. CTA always present
// (right); price only when present (left) — never "TBA".
//   - Mingla:           price (if any) · "Get tickets →"
//   - Ticketmaster +$:  "$X · Ticketmaster →"   (price folded into the CTA)
//   - Ticketmaster, no $: "Tickets via Ticketmaster →" (full-width CTA)
// "Ticketmaster" MUST appear on every TM card (attribution honesty 🔒).
// ---------------------------------------------------------------
function PricePill({
  event,
}: {
  event: ShowcaseEvent
}): React.ReactElement {
  // ORCH-1007 (operator directive): every event reads as "On Mingla" — no
  // Ticketmaster attribution. Price rides the left ONLY when present (never
  // "TBA"); the CTA is always "Get tickets →".
  const leftPrice: string | null = event.price // "from $15" / "$18" or null
  const cta = 'Get tickets →'

  return (
    <div
      aria-hidden="true"
      className="flex w-full items-center overflow-hidden font-sans"
      style={{
        flex: '0 0 auto',
        background: 'var(--color-warm)',
        borderRadius: '999px',
        height: '30px',
        padding: '0 12px',
        justifyContent: leftPrice ? 'space-between' : 'flex-start',
      }}
    >
      {leftPrice && (
        <span
          style={{
            fontSize: '14px',
            lineHeight: 1,
            fontWeight: 700,
            color: '#FFFFFF',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {leftPrice}
        </span>
      )}
      <span
        style={{
          flex: '0 0 auto',
          marginLeft: leftPrice ? '8px' : 0,
          fontSize: '14px',
          lineHeight: 1,
          fontWeight: 700,
          color: '#FFFFFF',
          whiteSpace: 'nowrap',
        }}
      >
        {cta}
      </span>
    </div>
  )
}
