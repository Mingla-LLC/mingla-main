import { Star } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CutoutCard, CutoutMedia } from './primitives'
import type { LagosVenue } from '@/lib/design-preview/lagos-truth'

// #2902 — a real Mingla place, in Cutout grammar.
//
// The card frames the photograph through an inset media window; that framing IS
// the cut-out. Everything on it is a verbatim place-pool record: name,
// category, Google rating, review count, price band, and a photo served from
// Mingla's own storage bucket.
//
// It deliberately carries NO "N locals recommend" pill. The shipped
// `PlaceCard` renders that unconditionally from `recommendCount`, which its own
// source marks as decorative with no real data behind it — fabricated social
// proof on a real, named business. Rating and review count are real, so they
// take its place.

export function CutoutPlaceCard({
  venue,
  eager = false,
  className,
  compact = false,
}: {
  venue: LagosVenue
  eager?: boolean
  className?: string
  /**
   * Drops the blurb and shortens the meta row. The Explorer home is a ONE
   * VIEWPORT page by ruling, and the full card stacked four-up overflowed
   * 900px of desktop and ran clean off a 390x844 phone.
   */
  compact?: boolean
}) {
  return (
    <CutoutCard
      pad="sm"
      interactive
      className={cn('flex h-full flex-col', className)}
      as="article"
    >
      <CutoutMedia ratio={compact ? 'wide' : 'landscape'}>
        <img
          src={venue.photo}
          alt={`${venue.name} in Lagos`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </CutoutMedia>

      <div className={cn('flex flex-1 flex-col px-2 pb-1', compact ? 'pt-3' : 'pt-4')}>
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">
          {venue.category}
        </p>
        <h3 className="mt-1.5 font-display text-[1.0625rem] leading-tight tracking-[-0.015em] text-[var(--cut-ink)]">
          {venue.name}
        </h3>
        {venue.blurb && !compact ? (
          <p className="mt-2 line-clamp-2 text-[0.875rem] leading-snug text-[var(--cut-body)]">
            {venue.blurb}
          </p>
        ) : null}

        <div className={cn('mt-auto flex items-center gap-3', compact ? 'pt-2.5' : 'pt-4')}>
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-bold tabular-nums text-[var(--cut-ink)]">
            <Star
              className="h-3.5 w-3.5 fill-[var(--cut-accent)] text-[var(--cut-accent)]"
              aria-hidden="true"
            />
            {venue.rating.toFixed(1)}
          </span>
          <span className="text-[0.8125rem] tabular-nums text-[var(--cut-muted)]">
            {venue.reviewCount.toLocaleString('en-US')}
            {compact ? '' : ' reviews'}
          </span>
          {venue.priceRange ? (
            <span className="ml-auto rounded-full bg-[var(--cut-card-sunken)] px-2.5 py-1 text-[0.75rem] font-semibold tabular-nums text-[var(--cut-body)]">
              {venue.priceRange}
            </span>
          ) : null}
        </div>
      </div>
    </CutoutCard>
  )
}
