'use client'
import { motion } from 'framer-motion'
import {
  CalendarCheck,
  UtensilsCrossed,
  Compass,
  Sparkles,
  MapPin,
  type LucideIcon,
} from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

// ORCH-1010 — adapted from 21st.dev ServerManagementTable (isaiahbjork) into an
// "Active listings" product table. Dashboard font (Inter), warm light theme.
// All rows are ILLUSTRATIVE Mingla mockups (ORCH-1007 reality-anchor posture) —
// event tickets / reservations / trips / experiences, not live account data.
// Dropped: dark theme, OS/flag SVGs, CPU bars, country flags, click-modal.
// Kept: staggered row entrance + row hover lift (both reduced-motion gated).

type Kind = 'event' | 'reservation' | 'trip' | 'experience'
type Status = 'selling' | 'almost-full' | 'draft'

interface Listing {
  no: string
  name: string
  kind: Kind
  city: string
  date: string
  filled: number
  capacity: number
  status: Status
}

const KIND_ICON: Record<Kind, LucideIcon> = {
  event: CalendarCheck,
  reservation: UtensilsCrossed,
  trip: Compass,
  experience: Sparkles,
}

const LISTINGS: Listing[] = [
  { no: '01', name: 'Rooftop Sessions', kind: 'event', city: 'Washington, DC', date: 'Fri, Jun 6', filled: 84, capacity: 100, status: 'selling' },
  { no: '02', name: "Chef's table — Fri", kind: 'reservation', city: 'Raleigh, NC', date: 'Fri, Jun 6', filled: 11, capacity: 12, status: 'almost-full' },
  { no: '03', name: 'Lagos Weekend Escape', kind: 'trip', city: 'Lagos, NG', date: 'Jun 20–22', filled: 18, capacity: 24, status: 'selling' },
  { no: '04', name: 'Pasta-making class', kind: 'experience', city: 'Washington, DC', date: 'Sat, Jun 7', filled: 6, capacity: 16, status: 'draft' },
  { no: '05', name: 'Sunset Sail', kind: 'experience', city: 'Raleigh, NC', date: 'Sun, Jun 8', filled: 22, capacity: 24, status: 'almost-full' },
]

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    selling: {
      label: 'Selling',
      cls: 'text-[var(--color-success)] bg-[rgba(63,139,92,0.10)] ring-[rgba(63,139,92,0.22)]',
    },
    'almost-full': {
      label: 'Almost full',
      cls: 'text-warm-ink bg-warm/10 ring-[rgba(168,69,14,0.20)]',
    },
    draft: {
      label: 'Draft',
      cls: 'text-text-muted bg-[rgba(14,14,16,0.04)] ring-[rgba(14,14,16,0.08)]',
    },
  }
  const { label, cls } = map[status]
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        cls,
      )}
    >
      {label}
    </span>
  )
}

function SeatsBar({ filled, capacity }: { filled: number; capacity: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((filled / capacity) * 100)))
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full max-w-[88px] overflow-hidden rounded-full bg-[rgba(14,14,16,0.06)]">
        <div
          className="h-full rounded-full bg-warm"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="min-w-[3.25rem] text-xs font-semibold tabular-nums text-text-secondary">
        {filled}/{capacity}
      </span>
    </div>
  )
}

export function ActiveListingsTable() {
  const reduced = useMinglaReducedMotion()

  const container = reduced
    ? undefined
    : {
        hidden: {},
        visible: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
      }
  const row = reduced
    ? undefined
    : {
        hidden: { opacity: 0, x: -18, filter: 'blur(3px)' },
        visible: {
          opacity: 1,
          x: 0,
          filter: 'blur(0px)',
          transition: { type: 'spring' as const, stiffness: 380, damping: 28, mass: 0.6 },
        },
      }

  return (
    <div
      className="font-dashboard w-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-[rgba(14,14,16,0.05)] md:p-6"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
            )}
            <span className="relative inline-flex size-2.5 rounded-full bg-[var(--color-success)]" />
          </span>
          <h3 className="text-base font-semibold text-text-primary">Active listings</h3>
        </div>
        <span className="text-xs font-medium text-text-secondary">4 live · 1 draft</span>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden grid-cols-[2.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] gap-3 px-3 pb-2 text-[0.68rem] font-semibold uppercase tracking-wider text-text-muted md:grid">
        <span>No</span>
        <span>Name</span>
        <span>Location</span>
        <span>Date</span>
        <span>Capacity</span>
        <span className="text-right">Status</span>
      </div>

      <motion.div
        className="flex flex-col gap-2"
        variants={container}
        initial={reduced ? false : 'hidden'}
        animate={reduced ? false : 'visible'}
      >
        {LISTINGS.map((l) => {
          const Icon = KIND_ICON[l.kind]
          return (
            <motion.div
              key={l.no}
              variants={row}
              whileHover={reduced ? undefined : { y: -1 }}
              className="rounded-xl bg-[rgba(14,14,16,0.018)] p-3 ring-1 ring-[rgba(14,14,16,0.05)] transition-colors hover:bg-warm/[0.04] md:px-3"
            >
              {/* Desktop grid row */}
              <div className="hidden grid-cols-[2.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] items-center gap-3 md:grid">
                <span className="text-lg font-bold tabular-nums text-text-muted">{l.no}</span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-warm/10 text-warm-ink"
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="truncate text-sm font-semibold text-text-primary">{l.name}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-sm text-text-secondary">
                  <MapPin className="size-3.5 flex-shrink-0 text-text-muted" strokeWidth={2} aria-hidden="true" />
                  <span className="truncate">{l.city}</span>
                </div>
                <span className="text-sm text-text-secondary">{l.date}</span>
                <SeatsBar filled={l.filled} capacity={l.capacity} />
                <div className="flex justify-end">
                  <StatusBadge status={l.status} />
                </div>
              </div>

              {/* Mobile stacked card */}
              <div className="md:hidden">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-warm/10 text-warm-ink"
                    >
                      <Icon className="size-4" strokeWidth={2} />
                    </span>
                    <span className="truncate text-sm font-semibold text-text-primary">{l.name}</span>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
                    <MapPin className="size-3 flex-shrink-0 text-text-muted" strokeWidth={2} aria-hidden="true" />
                    <span className="truncate">{l.city}</span>
                    <span className="text-text-muted">·</span>
                    <span className="flex-shrink-0">{l.date}</span>
                  </div>
                </div>
                <div className="mt-2">
                  <SeatsBar filled={l.filled} capacity={l.capacity} />
                </div>
              </div>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}
