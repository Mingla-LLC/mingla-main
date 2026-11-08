'use client'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'react-qr-code'
import { X } from 'lucide-react'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { detectClientPlatform } from '@/lib/device-platform'
import type { OneLinkAttribution } from '@/lib/links-src'
import { appHandoffHrefs, hostWebLabel, withLandingCampaign, type AppHandoffSheet } from '@/lib/app-handoff'
import { captureMarketing, isMarketingAdsOn } from '@/components/marketing/posthog-provider'
import { readLandingCampaign } from '@/lib/landing-campaign'
import type { SearchIcp } from '@/lib/page-measurement'

// #4339 §3 — the two computer sheets of the site-wide app hand-off.
//
//   host    → "Host on Mingla": the Host app QR and both Host store buttons,
//             or "Continue on host.usemingla.com".
//   explore → "Mingla lives on your phone": a photo, the Explorer app QR and
//             both Explorer store buttons. There is NO web option: Explorer
//             only exists on a phone.
//
// Every href comes from lib/app-handoff.ts → lib/cta-destination.ts (#4137);
// this file holds no URL. The sheet closes on X, a tap outside and Escape,
// traps Tab, and the opener gets focus back (useHandoffSheet).

const SHEET_COPY: Record<AppHandoffSheet, { photo: string; title: ReactNode; lead: string; qrTitle: string; titleId: string }> = {
  host: {
    photo: '/marketing/site/m/hostess.jpg',
    title: (
      <>
        Host on <em>Mingla.</em>
      </>
    ),
    lead: 'Scan to get the Mingla Host app, or keep going on the web.',
    qrTitle: 'QR code that opens the Mingla Host app on your phone',
    titleId: 'lp-host-sheet-title',
  },
  explore: {
    photo: '/marketing/site/m/cozy.jpg',
    title: (
      <>
        Mingla lives on <em>your phone.</em>
      </>
    ),
    lead: 'Scan with your phone camera to get the app.',
    qrTitle: 'QR code that opens the Mingla app on your phone',
    titleId: 'lp-explore-sheet-title',
  },
}

/**
 * Open/close state for a hand-off sheet, returning focus to whatever opened it.
 *
 * `trigger` holds the dialog ARIA for the button. It is empty in the server
 * HTML and on phones, where the button is a plain link to the store (#4137
 * AC-D1: no CTA is a dialog trigger before hydration); once React runs on a
 * computer it says the button opens a dialog and whether it is open.
 */
export function useHandoffSheet() {
  const [open, setOpen] = useState(false)
  const [computer, setComputer] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setComputer(detectClientPlatform() === 'other')
  }, [])

  const show = useCallback((event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    const opener = openerRef.current
    window.requestAnimationFrame(() => opener?.focus({ preventScroll: true }))
  }, [])

  const trigger: { 'aria-haspopup'?: 'dialog'; 'aria-expanded'?: boolean } = computer
    ? { 'aria-haspopup': 'dialog', 'aria-expanded': open }
    : {}

  return { open, show, close, trigger }
}

/** A modified click (new tab, new window, middle button) keeps the plain link. */
export function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

interface HandoffSheetProps {
  sheet: AppHandoffSheet
  attribution: OneLinkAttribution
  onClose: () => void
  /** #4339 round B: the page's ICP (Host landing pages) and where the button sat. */
  icp?: SearchIcp
  sourceKind?: string
}

interface SheetFrameProps {
  /** `data-sheet` on the overlay (styling and tests). */
  kind: string
  labelledBy: string
  onClose: () => void
  children: ReactNode
}

/**
 * The dialog chrome every computer sheet shares (#4339 §3): the overlay that
 * closes on a tap outside, X, Escape, a Tab trap, scroll lock and focus on X
 * when it opens. Portalled into the page's brand root.
 */
export function SheetFrame({ kind, labelledBy, onClose, children }: SheetFrameProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus({ preventScroll: true })
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      root.style.overflow = previousOverflow
    }
  }, [onClose])

  const node: ReactNode = (
    <div
      data-landing-sheet=""
      data-sheet={kind}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} className="modal-in" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button ref={closeRef} type="button" className="x" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  )

  // Into the page's brand root, so the sheet keeps the route-scoped faces.
  return createPortal(node, document.querySelector('[data-landing]') ?? document.body)
}

/** The app's two store buttons, for a computer sheet. */
export function StoreButtons({
  stores,
  onStore,
}: {
  stores: { appStore: string; googlePlay: string }
  /** #4339 round B: which store was clicked (handoff_store_clicked). */
  onStore?: (store: 'app_store' | 'google_play') => void
}) {
  return (
    <div className="gs-st">
      <a className="store" href={stores.appStore} target="_blank" rel="noopener" onClick={() => onStore?.('app_store')}>
        <AppleMark />
        <span>
          <small>Download on the</small>
          <b>App Store</b>
        </span>
      </a>
      <a className="store" href={stores.googlePlay} target="_blank" rel="noopener" onClick={() => onStore?.('google_play')}>
        <PlayMark />
        <span>
          <small>Get it on</small>
          <b>Google Play</b>
        </span>
      </a>
    </div>
  )
}

export function HandoffSheet({ sheet, attribution, onClose, icp, sourceKind }: HandoffSheetProps) {
  // #4339 round B: the visitor's landing campaign rides into the QR's OneLink
  // (af_sub1–3) and the host web link (utm_*), only while ads are on.
  const hrefs = withLandingCampaign(
    appHandoffHrefs(sheet === 'host' ? 'host' : 'explorer', attribution),
    readLandingCampaign(isMarketingAdsOn()),
  )
  const copy = SHEET_COPY[sheet]
  const opened = useRef({ sheet, icp, sourceKind })
  useEffect(() => {
    const { sheet: kind, icp: pageIcp, sourceKind: source } = opened.current
    captureMarketing('handoff_sheet_opened', { sheet: kind, icp: pageIcp ?? null, source_kind: source ?? null })
    return () => captureMarketing('handoff_sheet_closed', { sheet: kind, icp: pageIcp ?? null })
  }, [])
  const onStore = (store: 'app_store' | 'google_play') => captureMarketing('handoff_store_clicked', { store, sheet, icp: icp ?? null })
  return (
    <SheetFrame kind={sheet} labelledBy={copy.titleId} onClose={onClose}>
      <div className="gs-ph">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={copy.photo} alt="" decoding="async" />
      </div>
      <h3 id={copy.titleId}>{copy.title}</h3>
      <p>{copy.lead}</p>
      <div className="gs-row">
        <div className="qr">
          <QRCode value={hrefs.phoneHref} size={112} title={copy.qrTitle} />
        </div>
        <StoreButtons stores={hrefs.stores} onStore={onStore} />
      </div>
      {sheet === 'host' ? (
        <div className="gs-web">
          <span>Or keep going on this computer</span>
          <a
            href={hrefs.computerHref}
            target="_blank"
            rel="noopener"
            onClick={() => {
              captureMarketing('handoff_host_web_clicked', { sheet, icp: icp ?? null })
              onClose()
            }}
          >
            Continue on {hostWebLabel(hrefs.computerHref)}
          </a>
        </div>
      ) : null}
    </SheetFrame>
  )
}
