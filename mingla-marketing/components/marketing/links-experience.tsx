'use client'
// #4318 — usemingla.com/links: the city week calendar (replaces the ORCH-1317
// two-tab Explorer / For Hosts page).
//
// ONE SCREEN, NEVER SCROLLS: the page is exactly one viewport tall less the
// #2331 privacy bar (I-PRIVACY-BAR-NEVER-OCCLUDES), and the strips fit by
// MEASURING (lib/links-fit.ts): admin strips come first, listings keep a floor
// of 3 (1 on short screens), whatever does not fit whole is hidden and counted
// in the "more" links. Anything extra opens as a sheet inside the page.
//
// EVERY TAP goes through the #4137 device seam (lib/links-handoff.ts →
// lib/cta-destination.ts): each banner and strip is a real <a> whose server
// href is the computer destination and whose `data-cta-phone-href` is the
// phone destination (the boot script fixes a tap made before hydration). On a
// computer the tap opens a sheet with a QR code instead. No store or host URL
// lives in this file.
//
// Layout, tokens and behaviour follow the approved design contract (#4318,
// version 11) through links-experience.module.css. Light theme only.
//
// ANALYTICS: consent-gated captureMarketing, spec §11.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import QRCode from 'react-qr-code'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { cn } from '@/lib/cn'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import { resolveStoreListingHrefs } from '@/lib/cta-destination'
import {
  LINKS_CITY_COOKIE,
  LINKS_CITY_COOKIE_MAX_AGE_SECONDS,
  LINKS_SOCIALS,
  type LinksSocialId,
} from '@/lib/links-config'
import {
  chipFitLevel,
  computeLinksFit,
  moreLabel,
  pinsMoreLabel,
  SHORT_SCREEN_PX,
  stripsThatFit,
  type ChipFitLevel,
  type LinksFit,
} from '@/lib/links-fit'
import {
  isPhone,
  linksTargetHrefs,
  resolveLinksHandoff,
  targetApp,
  type LinksTarget,
} from '@/lib/links-handoff'
import {
  cityWeek,
  distanceLabel,
  listingDayKey,
  listingWhen,
  liveCities,
  longDayLabel,
  pickerOrder,
  pinWebHref,
  pinWhen,
  timeLabel,
  type LinksCity,
  type LinksListing,
  type LinksListingKind,
  type LinksPin,
  type LinksPoint,
  type LinksWeek,
} from '@/lib/links-week'
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

type IconName = 'arrow' | 'right' | 'chev' | 'x' | 'pin' | 'check' | 'cal' | 'clock' | 'globe' | 'phone'

function Icon({ name }: { name: IconName }): ReactNode {
  switch (name) {
    case 'arrow':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M7 17L17 7M9 7h8v8" /></svg>
    case 'right':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'chev':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M6 9l6 6 6-6" /></svg>
    case 'x':
      return <svg {...svgProps} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>
    case 'pin':
      return (
        <svg {...svgProps} strokeWidth={2.2}>
          <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
          <circle cx="12" cy="10.5" r="2.2" />
        </svg>
      )
    case 'check':
      return <svg {...svgProps} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    case 'cal':
      return (
        <svg {...svgProps} strokeWidth={2}>
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...svgProps} strokeWidth={2}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
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

type Filter = 'all' | LinksListingKind
type StripTarget = Exclude<LinksTarget, { type: 'banner' }>
type SheetState =
  | { kind: 'city' }
  | { kind: 'all' }
  | { kind: 'pins' }
  | { kind: 'explore' }
  | { kind: 'host' }
  | { kind: 'item'; target: StripTarget }

const FILTERS: ReadonlyArray<{ id: Filter; label: string; plural: string; singular: string }> = [
  { id: 'all', label: 'All', plural: 'plans', singular: 'plan' },
  { id: 'event', label: 'Events', plural: 'events', singular: 'event' },
  { id: 'trip', label: 'Trips', plural: 'trips', singular: 'trip' },
  { id: 'experience', label: 'Experiences', plural: 'experiences', singular: 'experience' },
]

const KIND_LABEL: Readonly<Record<LinksListingKind, string>> = {
  event: 'Event',
  trip: 'Trip',
  experience: 'Experience',
}

/** "New York <em>City</em>": the last word in italic. */
function CityName({ name }: { name: string }): ReactNode {
  const words = name.split(' ')
  if (words.length < 2) return <em>{name}</em>
  return (
    <>
      {words.slice(0, -1).join(' ')} <em>{words[words.length - 1]}</em>
    </>
  )
}

function cssUrl(url: string): string {
  return `url(${JSON.stringify(url)})`
}

function dayNumber(key: string): number {
  return Number(key.slice(8, 10))
}

/** "Saturday 7 to Friday 13 November" */
function weekRange(keys: readonly string[]): string {
  const first = longDayLabel(keys[0] ?? '')
  const last = longDayLabel(keys[keys.length - 1] ?? '')
  const sameMonth = first.split(' ').pop() === last.split(' ').pop()
  return `${sameMonth ? first.split(' ').slice(0, 2).join(' ') : first} to ${last}`
}

function rememberCity(slug: string): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${LINKS_CITY_COOKIE}=${encodeURIComponent(slug)}; Max-Age=${LINKS_CITY_COOKIE_MAX_AGE_SECONDS}; Path=/links; SameSite=Lax${secure}`
  } catch (error) {
    console.error('[#4318 links] could not remember the city', error)
  }
}

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
  /** The server's clock, so server and client agree on "this week". */
  nowIso: string
  /** Every registry city (used when nothing is live anywhere). */
  cities: LinksCity[]
  listings: LinksListing[]
  pins: LinksPin[]
  initialCity: string
  visitor: { point: LinksPoint | null; useMiles: boolean }
}

export function LinksExperience({ src, nowIso, cities, listings, pins, initialCity, visitor }: LinksExperienceProps) {
  const [citySlug, setCitySlug] = useState(initialCity)
  const [filter, setFilter] = useState<Filter>('all')
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [platform, setPlatform] = useState<Platform | null>(null)

  const live = useMemo(() => liveCities(cities, listings, pins, nowIso), [cities, listings, pins, nowIso])
  const city = cities.find((c) => c.slug === citySlug) ?? cities[0]
  const week = useMemo(() => cityWeek(city, listings, pins, nowIso), [city, listings, pins, nowIso])
  const shown = filter === 'all' ? week.listings : week.listings.filter((l) => l.kind === filter)
  const [fit, setFit] = useState<LinksFit>({ pinsShown: week.pins.length, listShown: shown.length })

  const rootRef = useRef<HTMLElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const pinsRef = useRef<HTMLUListElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const [chipLevel, setChipLevel] = useState<ChipFitLevel>(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const cityButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const detected = detectClientPlatform()
    setPlatform(detected)
    const html = document.documentElement
    if (!html.hasAttribute('data-platform')) html.setAttribute('data-platform', detected)
  }, [])

  // ---- the one-screen fit (design `fit()`), measured on the real layout.
  // Visibility of strips is set here, imperatively and only here, so React
  // never fights the measurement; the counts land in state for the labels.
  const runFit = useCallback(() => {
    const root = rootRef.current
    const list = listRef.current
    const wrap = wrapRef.current
    const moreButton = moreRef.current
    if (!root || !list || !wrap || !moreButton) return

    // Chips first (their row height is fixed): the first level that does not clip.
    const chips = chipsRef.current
    if (chips) {
      const level = chipFitLevel((next) => {
        chips.dataset.fit = String(next)
        return chips.scrollWidth > chips.clientWidth + 0.5
      })
      chips.dataset.fit = String(level)
      setChipLevel(level)
    }

    const strips = Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-strip]'))
    const group = pinsRef.current
    const pinItems = group ? Array.from(group.querySelectorAll<HTMLElement>(':scope > li[data-pin]')) : []
    const pinsMore = group?.querySelector<HTMLElement>(':scope > li[data-pins-more]') ?? null
    const left = leftRef.current
    const applyPins = (count: number) => {
      pinItems.forEach((li, i) => {
        li.hidden = i >= count
      })
      if (pinsMore) pinsMore.hidden = pinItems.length - count <= 0
    }
    const fitList = (count: number) => {
      applyPins(count)
      strips.forEach((li) => {
        li.hidden = false
      })
      // The listings and their "more" link share the box: a strip fits when it
      // AND the link under it fit whole (offsets are relative to the box).
      const gap = Number.parseFloat(getComputedStyle(wrap).rowGap) || 0
      return stripsThatFit(
        strips.map((li) => li.offsetTop + li.offsetHeight),
        wrap.clientHeight,
        moreButton.offsetHeight,
        gap,
      )
    }
    const result = computeLinksFit({
      pinCount: pinItems.length,
      listCount: strips.length,
      short: root.clientHeight < SHORT_SCREEN_PX,
      desk: left !== null && getComputedStyle(left).display !== 'contents',
      fitList,
      leftOverflows: (count) => {
        applyPins(count)
        return left !== null && left.scrollHeight > left.clientHeight + 1
      },
    })
    applyPins(result.pinsShown)
    strips.forEach((li, i) => {
      li.hidden = i >= result.listShown
    })
    setFit((prev) => (prev.pinsShown === result.pinsShown && prev.listShown === result.listShown ? prev : result))
  }, [])

  // Every commit can change the strips (city, filter, data), so measure after each.
  useLayoutEffect(() => {
    runFit()
  })

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
      const target = opener && opener.isConnected ? opener : cityButtonRef.current
      target?.focus({ preventScroll: true })
    })
  }, [sheet])

  const onRootKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && sheet !== null) {
      event.stopPropagation()
      closeSheet()
    }
  }

  // ---- taps
  const onTap = (target: LinksTarget, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const device = detectClientPlatform()
    const handoff = resolveLinksHandoff(target, device, src)
    if (target.type === 'banner') {
      captureMarketing('links_banner_tapped', {
        banner: target.app === 'explorer' ? 'explore' : 'host',
        device,
        city: city.slug,
      })
    } else {
      captureMarketing('links_strip_opened', {
        kind: target.type === 'listing' ? target.listing.kind : target.pin.opens,
        source: target.type === 'listing' ? 'listing' : 'custom',
        device,
        city: city.slug,
      })
    }
    if (handoff.action === 'sheet') {
      event.preventDefault()
      const opener = event.currentTarget
      if (target.type === 'banner') openSheet({ kind: target.app === 'explorer' ? 'explore' : 'host' }, opener)
      else openSheet({ kind: 'item', target }, opener)
      return
    }
    // A phone: the anchor navigates; make sure it carries the device href now.
    event.currentTarget.setAttribute('href', handoff.href)
  }

  const pickCity = (slug: string) => {
    if (slug !== city.slug) captureMarketing('links_city_changed', { city: slug, from: city.slug })
    setCitySlug(slug)
    setFilter('all')
    rememberCity(slug)
    openerRef.current = cityButtonRef.current
    closeSheet()
  }

  // ---- pieces
  const hrefFor = (target: LinksTarget) => {
    const d = linksTargetHrefs(target, src)
    return { href: platform !== null && isPhone(platform) ? d.phoneHref : d.computerHref, phoneHref: d.phoneHref }
  }

  const strip = (target: StripTarget, key: string, role?: 'strip' | 'pin') => {
    const { href, phoneHref } = hrefFor(target)
    const isPin = target.type === 'pin'
    const newTab = isPin && target.pin.opens === 'web'
    let thumb: ReactNode
    let meta: ReactNode
    if (target.type === 'pin') {
      thumb = (
        <span className={cn(styles['st-th'], styles['st-th--pin'])}>
          <Icon name="pin" />
        </span>
      )
      meta = <span className={styles.k}>{pinWhen(target.pin, week.today)}</span>
    } else {
      const l = target.listing
      const when = listingWhen(l, week.today)
      thumb = l.cover ? (
        <span className={styles['st-th']} style={{ backgroundImage: cssUrl(l.cover) }} role="img" aria-label={l.place ?? l.title} />
      ) : (
        <span className={cn(styles['st-th'], styles[`st-th--${l.kind}`])} aria-hidden="true">
          {dayNumber(listingDayKey(l))}
        </span>
      )
      const rest = [timeLabel(l.startsAt, l.tz), l.place].filter((x): x is string => Boolean(x)).join(' · ')
      meta = (
        <>
          <span className={styles.k}>
            {when.tonight ? <i /> : null}
            {when.text}
          </span>
          {rest ? <span>{rest}</span> : null}
        </>
      )
    }
    return (
      <li key={key} data-strip={role === 'strip' ? '' : undefined} data-pin={role === 'pin' ? '' : undefined}>
        <a
          href={href}
          data-cta-phone-href={phoneHref}
          target={newTab ? '_blank' : undefined}
          rel={newTab ? 'noopener' : undefined}
          className={cn(styles.st, isPin && styles['st--pin'])}
          onClick={(event) => onTap(target, event)}
        >
          {thumb}
          <span className={styles['st-txt']}>
            <b>{target.type === 'pin' ? target.pin.title : target.listing.title}</b>
            <span className={styles['st-meta']}>{meta}</span>
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

  const kindCount = (kind: LinksListingKind) => week.listings.filter((l) => l.kind === kind).length
  const more = moreLabel(shown.length, fit.listShown)
  const pinsMore = pinsMoreLabel(week.pins.length, fit.pinsShown)
  const words = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]

  const cityList = () => {
    const rows = pickerOrder(live.length > 0 ? live : cities.map((c) => ({ city: c, count: 0 })), visitor.point)
    return (
      <ul className={styles.cities}>
        {rows.map(({ city: c, count, km }) => (
          <li key={c.slug}>
            <button type="button" className={styles.cty} aria-current={c.slug === city.slug} onClick={() => pickCity(c.slug)}>
              <span>
                <b>{c.name}</b>
                <small>
                  {c.region}
                  {km !== null ? ` · ${distanceLabel(km, visitor.useMiles)}` : ''}
                </small>
              </span>
              <em>
                {count} this week
                {c.slug === city.slug ? <Icon name="check" /> : null}
              </em>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <main
      id="main"
      ref={rootRef}
      onKeyDown={onRootKeyDown}
      className={cn(styles.lk, 'h-[calc(100svh-var(--mingla-privacy-inset,0px))] overflow-hidden')}
      style={{ height: 'calc(100dvh - var(--mingla-privacy-inset, 0px))' }}
    >
      <div className={styles['lk-bar']} inert={sheet !== null}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 7 KB brand SVG; the image optimiser does not serve SVG */}
        <img src="/brand/links/mingla-wordmark-white.svg" alt="Mingla" width={68} height={24} />
      </div>
      <div className={cn(styles['lk-grid'], 'min-h-0 flex-1')} inert={sheet !== null}>
        <div className={styles['lk-left']} ref={leftRef}>
          <div className={styles['lk-ban']}>
            {banner('explorer')}
            {banner('host')}
          </div>
          {week.pins.length > 0 ? (
            <ul className={styles['lk-pins']} aria-label="From Mingla" ref={pinsRef}>
              {week.pins.map((pin) => strip({ type: 'pin', pin }, pin.id, 'pin'))}
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
        <div className={styles['lk-right']}>
          <header className={styles['lk-head']}>
            <button
              type="button"
              ref={cityButtonRef}
              className={styles['lk-city']}
              aria-haspopup="dialog"
              aria-label={`${city.name}. Change city`}
              onClick={(event) => openSheet({ kind: 'city' }, event.currentTarget)}
            >
              <span className={styles.nm}>
                <CityName name={city.name} />
              </span>
              <span className={styles.chev}>
                <Icon name="chev" />
              </span>
            </button>
            <p className={styles['lk-line']}>Find places, events and plans that fit the vibe.</p>
          </header>
          <div className={styles['lk-chips']} role="group" aria-label="Filter" ref={chipsRef} data-fit={chipLevel}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={styles.chip}
                aria-pressed={filter === f.id}
                onClick={() => {
                  setFilter(f.id)
                  captureMarketing('links_filter_changed', { filter: f.id, city: city.slug })
                }}
              >
                {f.label} <span>{f.id === 'all' ? week.listings.length : kindCount(f.id)}</span>
              </button>
            ))}
          </div>
          <div className={styles['lk-listwrap']} ref={wrapRef}>
            <ul className={styles['lk-list']} aria-label="Plans" ref={listRef}>
              {shown.length > 0 ? (
                shown.map((listing) => strip({ type: 'listing', listing }, listing.id, 'strip'))
              ) : (
                <li className={styles['lk-empty']}>
                  <b>A quiet one.</b>
                  No {words.plural} in {city.name} this week yet. Try another city.
                </li>
              )}
            </ul>
            <button
              type="button"
              ref={moreRef}
              className={styles['lk-more']}
              onClick={(event) => {
                captureMarketing('links_full_week_opened', { city: city.slug, plans: shown.length })
                openSheet({ kind: 'all' }, event.currentTarget)
              }}
            >
              <u>{more.text}</u>
              {more.count ? <span>{more.count}</span> : null}
              <Icon name="right" />
            </button>
          </div>
        </div>
      </div>
      {sheet !== null ? (
        <Sheet
          sheet={sheet}
          closeRef={closeRef}
          onClose={closeSheet}
          city={city}
          src={src}
          week={week}
          shown={shown}
          words={words}
          hasVisitor={visitor.point !== null}
          renderStrip={strip}
          renderCities={cityList}
        />
      ) : null}
    </main>
  )
}

// ---------------------------------------------------------------- sheets

interface SheetProps {
  sheet: SheetState
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  city: LinksCity
  src: string
  week: LinksWeek
  shown: LinksListing[]
  words: { plural: string; singular: string }
  hasVisitor: boolean
  renderStrip: (target: StripTarget, key: string) => ReactNode
  renderCities: () => ReactNode
}

function StoreButtons({ app }: { app: 'explorer' | 'host' }): ReactNode {
  const stores = resolveStoreListingHrefs(app)
  return (
    <div className={styles.stores}>
      <a className={cn(styles.btn, styles['btn--ink'])} href={stores.appStore} target="_blank" rel="noopener">
        <Icon name="phone" />
        App Store
      </a>
      <a className={cn(styles.btn, styles['btn--line'])} href={stores.googlePlay} target="_blank" rel="noopener">
        <Icon name="phone" />
        Google Play
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

function Sheet({ sheet, closeRef, onClose, city, src, week, shown, words, hasVisitor, renderStrip, renderCities }: SheetProps) {
  let title: ReactNode = null
  let label = ''
  let sub = ''
  let body: ReactNode = null
  let tall = false

  switch (sheet.kind) {
    case 'city': {
      title = (
        <>
          Pick a <em>city</em>
        </>
      )
      label = 'Pick a city'
      sub = hasVisitor ? 'Closest to you first.' : ''
      body = renderCities()
      break
    }
    case 'host': {
      const hrefs = linksTargetHrefs({ type: 'banner', app: 'host' }, src)
      title = (
        <>
          Host in <em>{city.name}</em>
        </>
      )
      label = `Host in ${city.name}`
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
      sub = `Find places, events and plans that fit the vibe. Scan to get the app; it opens on ${city.name}.`
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
      if (target.type === 'listing') {
        const l = target.listing
        title = l.title
        label = l.title
        body = (
          <>
            {l.cover ? (
              <div className={styles.hero} style={{ backgroundImage: cssUrl(l.cover) }} role="img" aria-label={l.place ?? l.title} />
            ) : null}
            <div>
              <span className={styles.pill}>
                {KIND_LABEL[l.kind]} · {city.name}
              </span>
            </div>
            <ul className={styles.meta}>
              <li>
                <Icon name="cal" />
                {longDayLabel(listingDayKey(l))}
              </li>
              <li>
                <Icon name="clock" />
                {timeLabel(l.startsAt, l.tz)}
              </li>
              {l.place ? (
                <li>
                  <Icon name="pin" />
                  {l.place}
                </li>
              ) : null}
            </ul>
            <QrBlock
              value={hrefs.phoneHref}
              title="Open it in Mingla"
              body={`Scan to land on this ${KIND_LABEL[l.kind].toLowerCase()} in the app.`}
            >
              <StoreButtons app="explorer" />
            </QrBlock>
          </>
        )
      } else {
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
              <span className={styles.pill}>
                {p.label} · {city.name}
              </span>
            </div>
            <ul className={styles.meta}>
              <li>
                <Icon name="cal" />
                {longDayLabel(p.showsOn)}
              </li>
            </ul>
            {action}
          </>
        )
      }
      break
    }
    case 'pins': {
      title = (
        <>
          From <em>Mingla</em>
        </>
      )
      label = 'From Mingla'
      sub = `${week.pins.length} pinned in ${city.name}`
      tall = week.pins.length > 6
      body = <ul className={styles['lk-list']}>{week.pins.map((pin) => renderStrip({ type: 'pin', pin }, pin.id))}</ul>
      break
    }
    case 'all': {
      tall = shown.length + week.pins.length > 6
      title = (
        <>
          <CityName name={city.name} />, the full week
        </>
      )
      label = `${city.name}, the full week`
      sub = `${shown.length} ${shown.length === 1 ? words.singular : words.plural} from ${weekRange(week.keys)}`
      const groups = week.keys
        .map((key) => ({ key, items: shown.filter((l) => listingDayKey(l) === key) }))
        .filter((g) => g.items.length > 0)
      body = (
        <>
          {week.pins.length > 0 ? (
            <section className={styles.wk}>
              <h3>
                From Mingla<span>{week.pins.length} pinned</span>
              </h3>
              <ul className={styles['lk-list']}>{week.pins.map((pin) => renderStrip({ type: 'pin', pin }, pin.id))}</ul>
            </section>
          ) : null}
          {groups.length > 0 ? (
            groups.map((g) => (
              <section key={g.key} className={styles.wk}>
                <h3>
                  {g.key === week.today ? 'Today, ' : ''}
                  {longDayLabel(g.key)}
                  <span>
                    {g.items.length} {g.items.length === 1 ? 'plan' : 'plans'}
                  </span>
                </h3>
                <ul className={styles['lk-list']}>
                  {g.items.map((listing) => renderStrip({ type: 'listing', listing }, listing.id))}
                </ul>
              </section>
            ))
          ) : (
            <p className={styles['lk-empty']}>
              <b>A quiet one.</b>
              Nothing to show yet.
            </p>
          )}
        </>
      )
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
      <section className={cn(styles.sh, tall && styles['is-tall'])} role="dialog" aria-modal="true" aria-label={label}>
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
