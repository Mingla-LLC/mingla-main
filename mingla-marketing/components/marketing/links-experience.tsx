'use client'
// #4339 — usemingla.com/links: Mingla's bio page. Top to bottom: the Mingla
// bar, the "Explore your city" and "Host something in your city" banners, the
// Admin Links strips ("pins") in Admin order, "See N more from Mingla" only
// when some do not fit, the socials, and the #2331 privacy bar below.
//
// ONE SCREEN, NEVER SCROLLS: the page is exactly one viewport tall less the
// privacy bar (I-PRIVACY-BAR-NEVER-OCCLUDES), and the strips fit by MEASURING
// (lib/links-fit.ts): only whole rows show (one column on a phone, two equal
// aligned columns on tablet and desktop), whatever does not fit folds into the
// "more" link, which opens the full list as a sheet inside the page.
//
// There is no city section: no city name or picker, no filter chips, no plan
// or place listing, no full-week sheet (#4339 subtracted them).
//
// EVERY TAP goes through the #4137 device seam (lib/links-handoff.ts →
// lib/cta-destination.ts): each banner and strip is a real <a> whose server
// href is the computer destination and whose `data-cta-phone-href` is the
// phone destination (the boot script fixes a tap made before hydration). On a
// computer the tap opens a sheet with a QR code instead. No store or host URL
// lives in this file.
//
// Light theme only. ANALYTICS: consent-gated captureMarketing.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import QRCode from 'react-qr-code'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { cn } from '@/lib/cn'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import { resolveStoreListingHrefs } from '@/lib/cta-destination'
import { LINKS_SOCIALS, type LinksSocialId } from '@/lib/links-config'
import { pinsMoreLabel, pinsThatFit } from '@/lib/links-fit'
import {
  isPhone,
  linksTargetHrefs,
  resolveLinksHandoff,
  targetApp,
  type LinksTarget,
} from '@/lib/links-handoff'
import { localDateKey, pinDaysLabel, pinWebHref, pinWhen, type LinksPin } from '@/lib/links-week'
import styles from './links-experience.module.css'

// ---------------------------------------------------------------- icons

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

type IconName = 'arrow' | 'right' | 'x' | 'pin' | 'cal' | 'globe' | 'phone'

function Icon({ name }: { name: IconName }): ReactNode {
  switch (name) {
    case 'arrow':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M7 17L17 7M9 7h8v8" /></svg>
    case 'right':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'x':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>
    case 'pin':
      return (
        <svg {...svgProps} strokeWidth={2.2}>
          <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10.5" r="2.2" />
        </svg>
      )
    case 'cal':
      return (
        <svg {...svgProps} strokeWidth={2}>
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...svgProps} strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z" />
        </svg>
      )
    case 'phone':
      return (
        <svg {...svgProps} strokeWidth={2}>
          <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
          <path d="M11 18.5h2" />
        </svg>
      )
    default: {
      const never: never = name
      return never
    }
  }
}

function SocialIcon({ id }: { id: LinksSocialId }): ReactNode {
  const p = { ...svgProps, strokeWidth: 1.8 }
  switch (id) {
    case 'instagram':
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r=".9" fill="currentColor" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...p}>
          <path d="M14 3.5v11a3.6 3.6 0 1 1-3.6-3.6" />
          <path d="M14 3.5c.5 2.8 2.4 4.5 5 4.7" />
        </svg>
      )
    case 'threads':
      return (
        <svg {...p}>
          <path d="M19.5 12a7.5 7.5 0 1 0-2.9 5.9" />
          <circle cx="12" cy="12" r="3.4" />
          <path d="M15.4 12c0 2.4 1 3.5 2.3 3.5s2-1.4 1.8-3.5" />
        </svg>
      )
    case 'snapchat':
      return (
        <svg {...p}>
          <path d="M12 3.5c-3 0-5 2.2-5 5v2.2l-1.9.7 1.7 1.2c-.6 1.6-1.8 2.8-3.3 3.4 1 .7 2.2.8 2.8 1 .2.6.3 1.2 1 1.2.9 0 1.7-.4 2.7.2s1.6 1.3 2 1.3 1-.7 2-1.3 1.8-.2 2.7-.2c.7 0 .8-.6 1-1.2.6-.2 1.8-.3 2.8-1-1.5-.6-2.7-1.8-3.3-3.4l1.7-1.2-1.9-.7V8.5c0-2.8-2-5-5-5z" />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...p}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="M10.5 9.5v5l4.3-2.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...p}>
          <path d="M14 8.5h2.5v-4H14a3.5 3.5 0 0 0-3.5 3.5v2.5H8V14h2.5v6.5H14V14h2.5l.5-3.5h-3V9a.5.5 0 0 1 .5-.5z" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
          <path d="M8 10.5V16M8 7.9v.1M11.5 16v-5.5M11.5 13a2.3 2.3 0 0 1 4.5-.6V16" />
        </svg>
      )
    default: {
      const never: never = id
      return never
    }
  }
}

// ---------------------------------------------------------------- helpers

type PinTarget = Extract<LinksTarget, { type: 'pin' }>
type SheetState = { kind: 'pins' } | { kind: 'explore' } | { kind: 'host' } | { kind: 'item'; target: PinTarget }

function hostLabel(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href
  }
}

// ---------------------------------------------------------------- page

export interface LinksExperienceProps {
  /** The sanitised `?src=` bio source (sanitizeLinksSrc on the server). */
  src: string
  /** The server's clock, so server and client agree on "today". */
  nowIso: string
  /** Every live Admin Links strip, in Admin order. */
  pins: LinksPin[]
}

export function LinksExperience({ src, nowIso, pins }: LinksExperienceProps) {
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [pinsShown, setPinsShown] = useState(pins.length)
  // Strips stay invisible until the first measured fit, so none paints cut off.
  const [fitted, setFitted] = useState(false)
  const today = localDateKey(nowIso, 'UTC')

  const rootRef = useRef<HTMLElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pinsRef = useRef<HTMLUListElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const detected = detectClientPlatform()
    setPlatform(detected)
    const html = document.documentElement
    if (!html.hasAttribute('data-platform')) html.setAttribute('data-platform', detected)
  }, [])

  // ---- the one-screen fit, measured on the real layout. Strip visibility is
  // set here, imperatively and only here, so React never fights the
  // measurement; the count lands in state for the "more" label.
  const runFit = useCallback(() => {
    const wrap = wrapRef.current
    const list = pinsRef.current
    if (!wrap || !list) return
    const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-pin]'))
    const moreItem = list.querySelector<HTMLElement>(':scope > li[data-pins-more]')
    items.forEach((li) => {
      li.hidden = false
    })
    if (moreItem) moreItem.hidden = false
    const style = getComputedStyle(list)
    const columns = Math.max(1, style.gridTemplateColumns.split(' ').filter(Boolean).length)
    const gap = Number.parseFloat(style.rowGap) || 0
    const shown = pinsThatFit({
      bottoms: items.map((li) => li.offsetTop + li.offsetHeight),
      room: wrap.clientHeight,
      moreHeight: moreItem?.offsetHeight ?? 0,
      gap,
      columns,
    })
    items.forEach((li, i) => {
      li.hidden = i >= shown
    })
    if (moreItem) moreItem.hidden = items.length - shown <= 0
    setPinsShown(shown)
    setFitted(true)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let cancelled = false
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => runFit())
    observer?.observe(root)
    // Fonts change strip heights: measure again once the brand faces load.
    void document.fonts?.ready.then(() => {
      if (!cancelled) runFit()
    })
    runFit()
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [runFit])

  // ---- sheets: focus moves into the sheet and back to its opener; Escape,
  // the X and a tap outside all close it; the page behind is inert.
  useEffect(() => {
    if (sheet !== null) closeRef.current?.focus({ preventScroll: true })
  }, [sheet])

  const openSheet = useCallback((next: SheetState, opener: HTMLElement | null) => {
    openerRef.current = opener
    setSheet(next)
  }, [])

  const closeSheet = useCallback(() => {
    if (sheet !== null) captureMarketing('links_sheet_closed', { sheet: sheet.kind })
    setSheet(null)
    const opener = openerRef.current
    openerRef.current = null
    window.requestAnimationFrame(() => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    })
  }, [sheet])

  // While a sheet is open the DOCUMENT listens, so Escape works wherever focus
  // is (the sheet title, blank sheet space, the consent bar), and Tab /
  // Shift+Tab stay inside the dialog.
  useEffect(() => {
    if (sheet === null) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      const dialog = rootRef.current?.querySelector<HTMLElement>('[role="dialog"]')
      if (!dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSheet()
        return
      }
      if (event.key === 'Tab') trapTab(dialog, event)
    }
    const trapTab = (dialog: HTMLElement, event: globalThis.KeyboardEvent) => {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active) && active !== dialog
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
    return () => document.removeEventListener('keydown', onKey, true)
  }, [sheet, closeSheet])

  // ---- taps
  const onTap = (target: LinksTarget, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const device = detectClientPlatform()
    const handoff = resolveLinksHandoff(target, device, src)
    if (target.type === 'banner') {
      captureMarketing('links_banner_tapped', { banner: target.app === 'explorer' ? 'explore' : 'host', device })
    } else if (target.type === 'pin') {
      captureMarketing('links_strip_opened', { kind: target.pin.opens, source: 'custom', device })
    }
    if (handoff.action === 'sheet') {
      event.preventDefault()
      const opener = event.currentTarget
      if (target.type === 'banner') openSheet({ kind: target.app === 'explorer' ? 'explore' : 'host' }, opener)
      else if (target.type === 'pin') openSheet({ kind: 'item', target }, opener)
      return
    }
    // A phone: the anchor navigates; make sure it carries the device href now.
    event.currentTarget.setAttribute('href', handoff.href)
  }

  // ---- pieces
  const hrefFor = (target: LinksTarget) => {
    const d = linksTargetHrefs(target, src)
    return { href: platform !== null && isPhone(platform) ? d.phoneHref : d.computerHref, phoneHref: d.phoneHref }
  }

  const strip = (target: PinTarget, key: string, role?: 'pin') => {
    const { href, phoneHref } = hrefFor(target)
    const newTab = target.pin.opens === 'web'
    return (
      <li key={key} data-pin={role === 'pin' ? '' : undefined}>
        <a
          href={href}
          data-cta-phone-href={phoneHref}
          target={newTab ? '_blank' : undefined}
          rel={newTab ? 'noopener' : undefined}
          className={cn(styles.st, styles['st--pin'])}
          onClick={(event) => onTap(target, event)}
        >
          <span className={cn(styles['st-th'], styles['st-th--pin'])}>
            <Icon name="pin" />
          </span>
          <span className={styles['st-txt']}>
            <b>{target.pin.title}</b>
            <span className={styles['st-meta']}>
              <span className={styles.k}>{pinWhen(target.pin, today)}</span>
            </span>
          </span>
          <span className={styles['st-go']}>
            <Icon name="arrow" />
          </span>
        </a>
      </li>
    )
  }

  const banner = (app: 'explorer' | 'host') => {
    const target: LinksTarget = { type: 'banner', app }
    const { href, phoneHref } = hrefFor(target)
    return (
      <a
        href={href}
        data-cta-phone-href={phoneHref}
        className={cn(styles.bn, app === 'explorer' ? styles['bn--explore'] : styles['bn--host'])}
        aria-label={app === 'explorer' ? 'Explore your city: get the Mingla app' : 'Host something in your city: get Mingla Host'}
        onClick={(event) => onTap(target, event)}
      >
        <span className={styles['bn-top']}>
          <span className={styles['bn-go']}>
            <Icon name="arrow" />
          </span>
        </span>
        <span className={styles['bn-txt']}>
          {app === 'explorer' ? (
            <b>
              Explore <em>your city</em>
            </b>
          ) : (
            <b>
              Host something in <em>your city</em>
            </b>
          )}
        </span>
      </a>
    )
  }

  const pinsMore = pinsMoreLabel(pins.length, pinsShown)

  return (
    <main
      id="main"
      ref={rootRef}
      data-fitted={fitted ? '1' : '0'}
      className={cn(styles.lk, 'h-[calc(100svh-var(--mingla-privacy-inset,0px))] overflow-hidden')}
      style={{ height: 'calc(100dvh - var(--mingla-privacy-inset, 0px))' }}
    >
      {/* Without scripts the fit never runs: show everything rather than nothing. */}
      <noscript>
        <style>{`#main[data-fitted='0'] [data-fit-gate]{visibility:visible!important}`}</style>
      </noscript>
      <div className={styles['lk-bar']} inert={sheet !== null}>
        {/* Every Mingla wordmark goes Home. A plain anchor (a full page load), not next/link:
            /links bans soft navigation (orch-1328), and Home is a different page shell. */}
        <a href="/" aria-label="Mingla home" className={styles['lk-home']}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a 7 KB brand SVG; the image optimiser does not serve SVG */}
          <img src="/brand/links/mingla-wordmark-white.svg" alt="" width={68} height={24} />
        </a>
      </div>
      <div className={cn(styles['lk-grid'], 'min-h-0 flex-1')} data-pins={pins.length > 0 ? '1' : '0'} inert={sheet !== null}>
        <div className={styles['lk-ban']}>
          {banner('explorer')}
          {banner('host')}
        </div>
        <div className={styles['lk-pinwrap']} ref={wrapRef}>
          {pins.length > 0 ? (
            <ul className={styles['lk-pins']} aria-label="From Mingla" ref={pinsRef} data-fit-gate="">
              {pins.map((pin) => strip({ type: 'pin', pin }, pin.id, 'pin'))}
              <li className={styles['pins-more']} data-pins-more="" hidden>
                <button
                  type="button"
                  className={styles['lk-more']}
                  onClick={(event) => openSheet({ kind: 'pins' }, event.currentTarget)}
                >
                  <u>{pinsMore ?? 'See more from Mingla'}</u>
                  <Icon name="right" />
                </button>
              </li>
            </ul>
          ) : null}
        </div>
        <footer className={styles['lk-foot']}>
          <nav className={styles.soc} aria-label="Mingla on social">
            {LINKS_SOCIALS.map((social) => (
              <a
                key={social.id}
                href={social.href}
                target="_blank"
                rel="noopener"
                aria-label={social.label}
                onClick={() => captureMarketing('links_page_social_clicked', { network: social.id })}
              >
                <SocialIcon id={social.id} />
              </a>
            ))}
          </nav>
        </footer>
      </div>
      {sheet !== null ? (
        <Sheet sheet={sheet} closeRef={closeRef} onClose={closeSheet} src={src} pins={pins} renderStrip={strip} />
      ) : null}
    </main>
  )
}

// ---------------------------------------------------------------- sheets

interface SheetProps {
  sheet: SheetState
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  src: string
  pins: LinksPin[]
  renderStrip: (target: PinTarget, key: string) => ReactNode
}

function StoreButtons({ app }: { app: 'explorer' | 'host' }): ReactNode {
  const stores = resolveStoreListingHrefs(app)
  // #4339 (Seth): a store button that installs Mingla Host says "Host".
  const host = app === 'host' ? 'Mingla Host on ' : ''
  return (
    <div className={styles.stores}>
      <a className={cn(styles.btn, styles['btn--ink'])} href={stores.appStore} target="_blank" rel="noopener">
        <Icon name="phone" />
        {host}App Store
      </a>
      <a className={cn(styles.btn, styles['btn--line'])} href={stores.googlePlay} target="_blank" rel="noopener">
        <Icon name="phone" />
        {host}Google Play
      </a>
    </div>
  )
}

function QrBlock({ value, title, body, children }: { value: string; title: string; body: string; children?: ReactNode }): ReactNode {
  return (
    <div className={styles.opt}>
      <div className={styles.qrrow}>
        <div className={styles.qr}>
          <QRCode value={value} size={128} title="QR code that opens Mingla on your phone" />
        </div>
        <div className={styles.qrtxt}>
          <b>{title}</b>
          <span>{body}</span>
          {children}
        </div>
      </div>
    </div>
  )
}

function Sheet({ sheet, closeRef, onClose, src, pins, renderStrip }: SheetProps) {
  let title: ReactNode = null
  let label = ''
  let sub = ''
  let body: ReactNode = null
  let tall = false

  switch (sheet.kind) {
    case 'host': {
      const hrefs = linksTargetHrefs({ type: 'banner', app: 'host' }, src)
      title = (
        <>
          Host in <em>your city</em>
        </>
      )
      label = 'Host in your city'
      sub = 'Sell tickets and keep more. Pages, RSVPs, the guest list and the door, in one place.'
      body = (
        <>
          <div className={cn(styles.hero, styles['hero--host'])} />
          <QrBlock
            value={hrefs.phoneHref}
            title="Get Mingla Host"
            body="Point your phone camera here. It opens the App Store on iPhone and Google Play on Android."
          />
          <div className={styles.or}>or</div>
          <div className={styles.opt}>
            <div className={styles.qrtxt}>
              <b>Stay on this screen</b>
              <span>Same account on the web. Build your page and run your guest list from your laptop.</span>
            </div>
            <a className={cn(styles.btn, styles['btn--orange'])} href={hrefs.computerHref} target="_blank" rel="noopener">
              <Icon name="globe" />
              Continue on {hostLabel(hrefs.computerHref)}
            </a>
          </div>
        </>
      )
      break
    }
    case 'explore': {
      const hrefs = linksTargetHrefs({ type: 'banner', app: 'explorer' }, src)
      title = (
        <>
          Mingla lives on <em>your phone</em>
        </>
      )
      label = 'Mingla lives on your phone'
      sub = 'Find places, events and plans that fit the vibe. Scan to get the app.'
      body = (
        <>
          <div className={cn(styles.hero, styles['hero--explore'])} />
          <QrBlock value={hrefs.phoneHref} title="Scan with your camera" body="Or pick your store.">
            <StoreButtons app="explorer" />
          </QrBlock>
        </>
      )
      break
    }
    case 'item': {
      const { target } = sheet
      const hrefs = linksTargetHrefs(target, src)
      const p = target.pin
      const app = targetApp(target)
      title = p.title
      label = p.title
      let action: ReactNode
      if (p.opens === 'blog') {
        action = (
          <a className={cn(styles.btn, styles['btn--orange'])} href={hrefs.computerHref}>
            <Icon name="right" />
            Read on the Mingla blog
          </a>
        )
      } else if (p.opens === 'web') {
        const href = pinWebHref(p.url) ?? hrefs.computerHref
        action = (
          <a className={cn(styles.btn, styles['btn--orange'])} href={href} target="_blank" rel="noopener">
            <Icon name="globe" />
            Open {href.replace(/^https:\/\//, '').replace(/\/$/, '')}
          </a>
        )
      } else if (app === 'host') {
        const hostWeb = linksTargetHrefs({ type: 'banner', app: 'host' }, src).computerHref
        action = (
          <>
            <QrBlock
              value={hrefs.phoneHref}
              title="Open it in Mingla Host"
              body="Scan with your phone camera. It opens the right store for your phone."
            >
              <StoreButtons app="host" />
            </QrBlock>
            <div className={styles.or}>or</div>
            <a className={cn(styles.btn, styles['btn--orange'])} href={hostWeb} target="_blank" rel="noopener">
              <Icon name="globe" />
              Continue on {hostLabel(hostWeb)}
            </a>
          </>
        )
      } else {
        action = (
          <QrBlock value={hrefs.phoneHref} title="Open it in Mingla" body="Scan to land on this page in the app.">
            <StoreButtons app="explorer" />
          </QrBlock>
        )
      }
      body = (
        <>
          <div>
            <span className={styles.pill}>{p.label}</span>
          </div>
          <ul className={styles.meta}>
            <li>
              <Icon name="cal" />
              {pinDaysLabel(p)}
            </li>
          </ul>
          {action}
        </>
      )
      break
    }
    case 'pins': {
      title = (
        <>
          From <em>Mingla</em>
        </>
      )
      label = 'From Mingla'
      sub = `${pins.length} from Mingla`
      tall = pins.length > 6
      body = <ul className={styles['lk-list']}>{pins.map((pin) => renderStrip({ type: 'pin', pin }, pin.id))}</ul>
      break
    }
    default: {
      const never: never = sheet
      return never
    }
  }

  return (
    <div className={styles['sh-wrap']}>
      <button type="button" className={styles['sh-scrim']} aria-label="Close" tabIndex={-1} onClick={onClose} />
      <section
        className={cn(styles.sh, tall && styles['is-tall'])}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <span className={styles['sh-grab']} aria-hidden="true" />
        <div className={styles['sh-head']}>
          <div>
            <h2>{title}</h2>
            {sub ? <p>{sub}</p> : null}
          </div>
          <button type="button" ref={closeRef} className={styles['sh-x']} aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className={styles['sh-body']}>{body}</div>
      </section>
    </div>
  )
}
