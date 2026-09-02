'use client'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — one illustrative visual per tool.
//
// Ten compact figures, each ~76px tall so it sits inside a tool card without
// pushing the copy out. Drawn in CSS so they re-tint with the brand, animate on
// the compositor only, and cost nothing to load.
//
// They are ILLUSTRATIVE — they show the SHAPE of a thing, never a measured
// result, and the section says so once rather than tagging every card.
// Reduced motion renders every one in its final state, unanimated.
// ---------------------------------------------------------------

const EASE = [0.16, 1, 0.3, 1] as const
const ACCENT = 'var(--cut-accent)'
const FAINT = 'color-mix(in srgb, var(--cut-accent) 22%, transparent)'
const SUNK = 'var(--cut-card-sunken)'

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('mt-5 flex h-[76px] w-full items-end gap-1.5 rounded-xl px-3 py-2.5', className)}
      style={{ background: SUNK }}
      aria-hidden="true"
    >
      {children}
    </div>
  )
}

/** Bars that grow on view. */
function Bars({ values, hot = 0 }: { values: number[]; hot?: number }) {
  const reduced = useMinglaReducedMotion()
  const peak = Math.max(...values)
  return (
    <Frame>
      {values.map((v, i) => (
        <motion.span
          key={i}
          className="flex-1 rounded-t-[3px]"
          initial={reduced ? false : { height: 0 }}
          whileInView={{ height: `${(v / peak) * 100}%` }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : i * 0.05, ease: EASE }}
          style={{ background: i >= values.length - hot ? ACCENT : FAINT }}
        />
      ))}
    </Frame>
  )
}

/** Stacked progress rows. */
function Rows({ rows }: { rows: { label: string; pct: number }[] }) {
  const reduced = useMinglaReducedMotion()
  return (
    <div
      className="mt-5 flex h-[76px] w-full flex-col justify-center gap-2 rounded-xl px-3"
      style={{ background: SUNK }}
      aria-hidden="true"
    >
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--cut-muted)]">
            {r.label}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: FAINT }}>
            <motion.span
              className="block h-full rounded-full"
              initial={reduced ? false : { width: 0 }}
              whileInView={{ width: `${r.pct}%` }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: reduced ? 0 : 0.7, delay: reduced ? 0 : i * 0.08, ease: EASE }}
              style={{ background: ACCENT }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

/** A grid of cells that fill in — calendars, cohorts, slots. */
function Cells({ total, on, cols }: { total: number; on: number[]; cols: number }) {
  const reduced = useMinglaReducedMotion()
  return (
    <div
      className="mt-5 grid h-[76px] w-full place-content-center gap-1 rounded-xl px-3"
      style={{ background: SUNK, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      aria-hidden="true"
    >
      {Array.from({ length: total }).map((_, i) => (
        <motion.span
          key={i}
          className="h-[9px] w-[9px] rounded-[2px]"
          initial={reduced ? false : { opacity: 0.25, scale: 0.7 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: reduced ? 0 : 0.34, delay: reduced ? 0 : i * 0.018, ease: EASE }}
          style={{ background: on.includes(i) ? ACCENT : FAINT }}
        />
      ))}
    </div>
  )
}

/** Wireframe blocks assembling — a site building itself. */
function Wireframe() {
  const reduced = useMinglaReducedMotion()
  const blocks = [
    { w: '46%', h: 7 },
    { w: '100%', h: 20 },
    { w: '100%', h: 14 },
  ]
  return (
    <div
      className="mt-5 flex h-[76px] w-full flex-col justify-center gap-1.5 rounded-xl px-3"
      style={{ background: SUNK }}
      aria-hidden="true"
    >
      {blocks.map((b, i) => (
        <motion.span
          key={i}
          className="block rounded-[3px]"
          initial={reduced ? false : { opacity: 0, scaleX: 0.3 }}
          whileInView={{ opacity: 1, scaleX: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : i * 0.12, ease: EASE }}
          style={{
            width: b.w,
            height: b.h,
            transformOrigin: 'left center',
            background: i === 1 ? ACCENT : FAINT,
          }}
        />
      ))}
      {/* Bottom row of three, the card strip. */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 flex-1 rounded-[3px]"
            initial={reduced ? false : { opacity: 0, y: 4 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : 0.4 + i * 0.07, ease: EASE }}
            style={{ background: FAINT }}
          />
        ))}
      </div>
    </div>
  )
}

/** Chips lighting up in sequence — the things you can publish. */
function Chips({ items }: { items: string[] }) {
  const reduced = useMinglaReducedMotion()
  return (
    <div
      className="mt-5 flex h-[76px] w-full flex-wrap content-center items-center gap-1.5 rounded-xl px-3"
      style={{ background: SUNK }}
      aria-hidden="true"
    >
      {items.map((t, i) => (
        <motion.span
          key={t}
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
          initial={reduced ? false : { opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : i * 0.09, ease: EASE }}
          style={{
            background: i === 0 ? ACCENT : FAINT,
            color: i === 0 ? '#fff' : 'var(--cut-body)',
          }}
        >
          {t}
        </motion.span>
      ))}
    </div>
  )
}

/** Concentric reach rings — being found. */
function Rings() {
  const reduced = useMinglaReducedMotion()
  return (
    <div
      className="mt-5 flex h-[76px] w-full items-center justify-center rounded-xl"
      style={{ background: SUNK }}
      aria-hidden="true"
    >
      <span className="relative flex h-[58px] w-[58px] items-center justify-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            initial={reduced ? false : { scale: 0.35, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : i * 0.12, ease: EASE }}
            style={{
              width: 20 + i * 19,
              height: 20 + i * 19,
              border: `1.5px solid ${i === 0 ? ACCENT : FAINT}`,
            }}
          />
        ))}
        <span className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />
      </span>
    </div>
  )
}

const VISUALS: Record<string, React.ReactNode> = {
  site: <Wireframe />,
  host: <Chips items={['Events', 'Trips', 'Stays', 'Experiences']} />,
  venue: <Cells total={21} on={[3, 4, 9, 10, 11, 16, 17]} cols={7} />,
  orders: <Bars values={[18, 26, 22, 34, 30, 46, 58]} hot={2} />,
  reservations: <Cells total={14} on={[2, 3, 6, 8, 9, 12]} cols={7} />,
  discovery: <Rings />,
  email: <Rows rows={[{ label: 'Sent', pct: 100 }, { label: 'Opened', pct: 62 }, { label: 'Booked', pct: 24 }]} />,
  sms: <Rows rows={[{ label: 'Sent', pct: 100 }, { label: 'Read', pct: 84 }]} />,
  ads: <Bars values={[12, 20, 16, 30, 44, 38, 54]} hot={3} />,
  crm: <Cells total={24} on={[1, 5, 6, 11, 14, 15, 19, 22]} cols={8} />,
}

export function ToolVisual({ id }: { id: string }) {
  return VISUALS[id] ?? null
}
