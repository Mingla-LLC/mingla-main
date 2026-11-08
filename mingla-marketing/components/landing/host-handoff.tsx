'use client'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'react-qr-code'
import { ArrowRight, X } from 'lucide-react'
import { DeviceLink } from '@/components/cutout/device-link'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { captureSearchMeasurement } from '@/components/marketing/posthog-provider'
import { siteAttribution } from '@/lib/links-src'
import { appHandoffHrefs, hostWebLabel, resolveAppHandoff } from '@/lib/app-handoff'

// #4339 §3 — "Use Mingla Web", the Host hand-off on the landing pages.
//
//   phone    → straight to the Mingla Host store through the attributed Host
//              OneLink; the label reads "Get Mingla Host".
//   computer → the "Host on Mingla" sheet: the Host app QR and both store
//              buttons, or "Continue on host.usemingla.com".
//
// One <a> (DeviceLink, #4137): the server HTML carries the computer href plus
// the phone href in `data-cta-phone-href`, and app/globals.css shows the right
// label from <html data-platform> before first paint, so a phone never sees
// the computer label or reaches the computer destination. Every URL comes from
// lib/app-handoff.ts → lib/cta-destination.ts; nothing here holds one.
//
// The sheet closes on X, a tap outside and Escape, traps Tab, and returns
// focus to the button that opened it.

const ATTRIBUTION = siteAttribution('business_hero')
const SHEET_PHOTO = '/marketing/site/m/hostess.jpg'

interface HostHandoffButtonProps {
  /** Analytics label for where the button sits (`hero`, `features`, `band`). */
  location: string
  className: string
  withArrow?: boolean
}

export function HostHandoffButton({ location, className, withArrow = false }: HostHandoffButtonProps) {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  const onActivate = (platform: Parameters<typeof resolveAppHandoff>[1], event: MouseEvent<HTMLAnchorElement>) => {
    const handoff = resolveAppHandoff('host', platform, ATTRIBUTION)
    captureSearchMeasurement('host_start_click', {
      audience: 'host',
      page_family: 'host_pillar',
      source_kind: location === 'hero' ? 'hero' : 'product',
      destination_kind: handoff.action === 'navigate' ? 'host_onelink' : 'host_web',
      action_state: 'opened',
    })
    if (handoff.action === 'navigate') {
      event.currentTarget.setAttribute('href', handoff.href)
      return
    }
    // A modified click (new tab, new window) keeps the plain link to host web.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openerRef.current = event.currentTarget
    setOpen(true)
  }

  const close = useCallback(() => {
    setOpen(false)
    const opener = openerRef.current
    window.requestAnimationFrame(() => opener?.focus({ preventScroll: true }))
  }, [])

  return (
    <>
      <DeviceLink
        surface="host"
        attribution={ATTRIBUTION}
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        onActivate={onActivate}
      >
        <span data-cta-when="phone">Get Mingla Host</span>
        <span data-cta-when="computer">Use Mingla Web</span>
        {withArrow ? <ArrowRight aria-hidden="true" /> : null}
      </DeviceLink>
      {open ? <HostHandoffSheet onClose={close} /> : null}
    </>
  )
}

function HostHandoffSheet({ onClose }: { onClose: () => void }) {
  const hrefs = appHandoffHrefs('host', ATTRIBUTION)
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

  const sheet: ReactNode = (
    <div
      data-landing-sheet=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} className="modal-in" role="dialog" aria-modal="true" aria-labelledby="lp-host-sheet-title">
        <button ref={closeRef} type="button" className="x" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <div className="gs-ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SHEET_PHOTO} alt="" decoding="async" />
        </div>
        <h3 id="lp-host-sheet-title">
          Host on <em>Mingla.</em>
        </h3>
        <p>Scan to get the Mingla Host app, or keep going on the web.</p>
        <div className="gs-row">
          <div className="qr">
            <QRCode value={hrefs.phoneHref} size={112} title="QR code that opens the Mingla Host app on your phone" />
          </div>
          <div className="gs-st">
            <a className="store" href={hrefs.stores.appStore} target="_blank" rel="noopener">
              <AppleMark />
              <span>
                <small>Download on the</small>
                <b>App Store</b>
              </span>
            </a>
            <a className="store" href={hrefs.stores.googlePlay} target="_blank" rel="noopener">
              <PlayMark />
              <span>
                <small>Get it on</small>
                <b>Google Play</b>
              </span>
            </a>
          </div>
        </div>
        <div className="gs-web">
          <span>Or keep going on this computer</span>
          <a href={hrefs.computerHref} target="_blank" rel="noopener" onClick={onClose}>
            Continue on {hostWebLabel(hrefs.computerHref)}
          </a>
        </div>
      </div>
    </div>
  )

  // Into the landing root, so the sheet keeps the route-scoped brand faces.
  return createPortal(sheet, document.querySelector('[data-landing]') ?? document.body)
}
