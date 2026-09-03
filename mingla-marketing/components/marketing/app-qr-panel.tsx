'use client'
// ORCH-1319 — the desktop "Get the app" QR dialog. Opened by the explorer nav CTA
// when the visitor is on desktop/other (phones go straight to their store).
//
// Small, accessible, NO form / NO inputs — it only shows a device-smart QR + the
// two live store badges as a click-through fallback. The a11y patterns
// (role=dialog + aria-modal + ESC + backdrop-close + focus trap + focus-restore +
// body-scroll-lock + AnimatePresence/reduced-motion) mirror the deleted explorer
// lead modal so nothing regresses.

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { DownloadQr } from '@/components/marketing/download-qr'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

export interface AppQrPanelProps {
  open: boolean
  onClose: () => void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

export function AppQrPanel({ open, onClose }: AppQrPanelProps) {
  const reduced = useMinglaReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  // The element focused when the panel opened — restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Keep SSR and the first hydrated render identical, then place the overlay at
  // document level so transformed cards cannot trap it in a lower stacking context.
  useEffect(() => {
    setPortalHost(document.body)
  }, [])

  // ── Capture the trigger + restore focus to it on close ──────────────────────
  useEffect(() => {
    if (open && portalHost) {
      restoreFocusRef.current =
        (document.activeElement as HTMLElement | null) ?? null
      return
    }
    // Closing: return focus to the trigger (the nav CTA).
    const el = restoreFocusRef.current
    if (el && typeof el.focus === 'function') el.focus()
    restoreFocusRef.current = null
  }, [open, portalHost])

  // ── ESC closes ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Body scroll lock while open ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // ── Move focus into the panel on open (Close button) ─────────────────────────
  useEffect(() => {
    if (!open || !portalHost) return
    const panel = panelRef.current
    if (!panel) return
    const id = window.setTimeout(
      () => {
        const first = panel.querySelector<HTMLElement>(FOCUSABLE)
        first?.focus()
      },
      reduced ? 0 : 60,
    )
    return () => window.clearTimeout(id)
  }, [open, portalHost, reduced])

  // ── Focus trap: keep Tab / Shift+Tab within the panel ────────────────────────
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const panelMotion = reduced
    ? { initial: false, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, scale: 0.96, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 8 },
        transition: { type: 'spring' as const, stiffness: 240, damping: 28 },
      }

  if (!portalHost) return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="appqr-backdrop"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.22 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="fixed inset-0 z-[200] flex items-center justify-center px-4"
          style={{
            background: 'rgba(8,9,12,0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <motion.div
            key="appqr-panel"
            ref={panelRef}
            data-theme="light"
            {...panelMotion}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[360px] overflow-hidden rounded-[32px] bg-parchment p-6 text-center shadow-[var(--elev-3)] ring-1 ring-[var(--glass-border)] sm:p-7"
            style={{ maxHeight: '90vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="glass-soft absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full text-text-primary transition-all duration-200 hover:brightness-110 focus-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <h2
              id={headingId}
              className="pr-10 text-left font-display text-2xl tracking-[-0.01em] text-text-primary"
            >
              Scan to get Mingla
            </h2>
            <p className="mt-2 text-left text-[15px] leading-relaxed text-text-secondary">
              Point your phone camera at the code — it opens the App Store or
              Google Play for whatever phone you&apos;re on.
            </p>

            {/* Device-smart QR on a solid white card (contrast for scanners). */}
            <div className="mt-6 flex justify-center">
              <div className="rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(14,14,16,0.08)]">
                <DownloadQr size={200} />
              </div>
            </div>

            {/* Divider */}
            <div className="mt-6 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-divider-strong" />
              <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                or
              </span>
              <span className="h-px flex-1 bg-divider-strong" />
            </div>

            {/* Both live store badges (click-through fallback). */}
            <div className="mt-6 flex justify-center">
              <AppStoreBadges />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalHost,
  )
}
