// #4238 W3-1 (D8) — the four ad pixels on usemingla.com (Meta, TikTok,
// Snapchat, Reddit), consent-gated.
//
// I-4238-MARKETING-PIXEL-CONSENT-GATED: no vendor pixel script is in the
// document while ads are off for this visitor (Global Privacy Control starts
// them off). Every entry point below re-reads the choice itself, so a caller
// can never boot a pixel for a visitor who turned ads off.
//
// Same markers (`data-mingla-pixel="meta|tiktok|snap|reddit"`), the same vendor
// loaders and the same turn-off as host web (mingla-business
// src/analytics/adPixelRuntime.web.ts + webAnalytics.web.ts stopAdPixels), so
// host.usemingla.com and usemingla.com behave the same for one visitor.
//
// Loaded lazily (dynamic import) by the root layout's analytics owner
// (components/marketing/posthog-provider.tsx, which already keeps the landing
// campaign per route) only while ads are on, and by the two lead senders (book
// a call, tools email gate) for their browser Lead. It is never part of a
// page's first load.
//
// Pixel ids are public ids from NEXT_PUBLIC_* (Seth step S-V1, the same values
// as host web). A missing id means that provider stays off.

import { isMarketingAdsOn } from '@/components/marketing/marketing-capture'
import {
  MARKETING_HOST_FUNNEL_PIXEL_EVENTS,
  MARKETING_HOST_LEAD_EVENT,
  MARKETING_LEAD_LABEL_VALUE,
  type MarketingLeadLabel,
} from '@/lib/ad-event-catalog'
import { isAnalyticsPrivatePathname } from '@/lib/analytics-private-routes'

export interface MarketingPixelIds {
  meta: string | null
  tiktok: string | null
  snap: string | null
  reddit: string | null
}

type Provider = keyof MarketingPixelIds
type QueuedPixel = ((...args: unknown[]) => void) & Record<string, unknown>

type PixelWindow = Window & {
  fbq?: QueuedPixel
  _fbq?: unknown
  ttq?: Record<string, unknown> & {
    page?: () => void
    track?: (...args: unknown[]) => void
    revokeConsent?: () => void
  }
  TiktokAnalyticsObject?: string
  snaptr?: QueuedPixel
  rdt?: QueuedPixel
  __minglaMarketingPixelPage?: string
}

export const MARKETING_PIXEL_SCRIPTS: Readonly<Record<Provider, string>> = {
  meta: 'https://connect.facebook.net/en_US/fbevents.js',
  tiktok: 'https://analytics.tiktok.com/i18n/pixel/events.js',
  snap: 'https://sc-static.net/scevent.min.js',
  reddit: 'https://www.redditstatic.com/ads/pixel.js',
}

/**
 * #4238 W7: every origin a pixel runs a script from — its loader above plus
 * any script the loader fetches next. Snap's scevent.min.js loads its pixel
 * config from tr.snapchat.com/config/...; Meta (signals/config), TikTok
 * (pixel/static) and Reddit (ads/v2) stay on their loader's origin. The CSP
 * test fails if script-src misses any of these.
 */
export const MARKETING_PIXEL_SCRIPT_ORIGINS: Readonly<Record<Provider, readonly string[]>> = {
  meta: ['https://connect.facebook.net'],
  tiktok: ['https://analytics.tiktok.com'],
  snap: ['https://sc-static.net', 'https://tr.snapchat.com'],
  reddit: ['https://www.redditstatic.com'],
}

/** First-party cookies the four pixels write (expired on a turn-off). */
export const MARKETING_PIXEL_COOKIES = ['_fbp', '_fbc', '_ttp', '_scid', '_rdt_uuid'] as const

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/** The configured ids. Each process.env read is literal so Next inlines it at build. */
export function marketingPixelIds(): MarketingPixelIds {
  return {
    meta: clean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
    tiktok: clean(process.env.NEXT_PUBLIC_TIKTOK_PIXEL_CODE),
    snap: clean(process.env.NEXT_PUBLIC_SNAP_PIXEL_ID),
    reddit: clean(process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID),
  }
}

function pixelWindow(): PixelWindow {
  return window as PixelWindow
}

function safe(fn: () => void): void {
  try {
    fn()
  } catch (error) {
    console.warn('[marketing pixels] pixel call failed (non-fatal):', error)
  }
}

function injectOnce(src: string, marker: Provider): void {
  if (document.querySelector(`script[data-mingla-pixel="${marker}"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = src
  script.setAttribute('data-mingla-pixel', marker)
  document.head.appendChild(script)
}

function queued(handlerKey: string, queueKey: string): QueuedPixel {
  const pixel = function queuedPixel(...args: unknown[]): void {
    const handler = pixel[handlerKey]
    if (typeof handler === 'function') (handler as (...a: unknown[]) => void)(...args)
    else (pixel[queueKey] as unknown[][]).push(args)
  } as QueuedPixel
  pixel[queueKey] = []
  return pixel
}

function bootMeta(id: string): void {
  const w = pixelWindow()
  if (w.fbq === undefined) {
    const fbq = queued('callMethod', 'queue')
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    w.fbq = fbq
    w._fbq = fbq
  }
  injectOnce(MARKETING_PIXEL_SCRIPTS.meta, 'meta')
  // Meta's SPA guide: disablePushState stops the automatic PageView on history
  // changes. This module sends one PageView per route itself (as host web does).
  w.fbq.disablePushState = true
  w.fbq('init', id)
}

// TikTok's documented base code (the same shape host web uses): a queue with
// the deferred methods, then load(code) records the pixel and injects the SDK.
const TIKTOK_METHODS = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent']

function bootTikTok(code: string): void {
  const w = pixelWindow()
  w.TiktokAnalyticsObject = 'ttq'
  const ttq = (w.ttq = w.ttq ?? {}) as Record<string, unknown>
  const push = (entry: unknown): void => {
    ;((ttq._q = (ttq._q as unknown[] | undefined) ?? []) as unknown[]).push(entry)
  }
  ttq.push = ttq.push ?? push
  ttq.methods = TIKTOK_METHODS
  for (const method of TIKTOK_METHODS) {
    ttq[method] = (...args: unknown[]): void => {
      ;(ttq.push as (entry: unknown) => void)([method, ...args])
    }
  }
  ttq._i = { ...((ttq._i as Record<string, unknown>) ?? {}), [code]: [] }
  ttq._t = { ...((ttq._t as Record<string, number>) ?? {}), [code]: Date.now() }
  ttq._o = { ...((ttq._o as Record<string, unknown>) ?? {}), [code]: {} }
  injectOnce(`${MARKETING_PIXEL_SCRIPTS.tiktok}?sdkid=${encodeURIComponent(code)}&lib=ttq`, 'tiktok')
}

function bootSnap(id: string): void {
  const w = pixelWindow()
  if (w.snaptr === undefined) w.snaptr = queued('handleRequest', 'queue')
  injectOnce(MARKETING_PIXEL_SCRIPTS.snap, 'snap')
  w.snaptr('init', id)
}

function bootReddit(id: string): void {
  const w = pixelWindow()
  if (w.rdt === undefined) w.rdt = queued('sendEvent', 'callQueue')
  injectOnce(MARKETING_PIXEL_SCRIPTS.reddit, 'reddit')
  w.rdt('init', id)
}

const BOOT: Record<Provider, (id: string) => void> = {
  meta: bootMeta,
  tiktok: bootTikTok,
  snap: bootSnap,
  reddit: bootReddit,
}
const GLOBAL: Record<Provider, 'fbq' | 'ttq' | 'snaptr' | 'rdt'> = {
  meta: 'fbq',
  tiktok: 'ttq',
  snap: 'snaptr',
  reddit: 'rdt',
}

function booted(provider: Provider): boolean {
  return (
    pixelWindow()[GLOBAL[provider]] !== undefined &&
    document.querySelector(`script[data-mingla-pixel="${provider}"]`) !== null
  )
}

/** Boot every configured provider not booted yet. Nothing while ads are off. */
function bootMissing(ids: MarketingPixelIds): boolean {
  if (typeof window === 'undefined' || !isMarketingAdsOn()) return false
  for (const provider of Object.keys(BOOT) as Provider[]) {
    const id = ids[provider]
    if (id && !booted(provider)) safe(() => BOOT[provider](id))
  }
  return true
}

/** /host and every /host/* page is the host funnel's content. */
export function isHostContentPath(pathname: string): boolean {
  return pathname === '/host' || pathname.startsWith('/host/')
}

/**
 * A page whose URL carries a private token never loads a pixel: the vendor
 * scripts read the full page URL. That is the #4273 private paths and the free
 * tools' emailed report pages (`/tools/<tool>/report?id=…&t=<token>`).
 */
export function isPixelPrivatePage(pathname: string, search: string): boolean {
  if (isAnalyticsPrivatePathname(pathname)) return true
  if (/^\/tools\/[^/]+\/report\/?$/.test(pathname)) return true
  return new URLSearchParams(search).has('t')
}

/**
 * The route-change entry point: boots the configured pixels (ads on only, and
 * never on a private page), then sends PageView once per pathname and, on
 * /host and /host/*, ViewContent.
 */
export function bootMarketingPixels(
  pathname: string,
  search = '',
  ids: MarketingPixelIds = marketingPixelIds(),
): void {
  if (isPixelPrivatePage(pathname, search)) return
  if (!bootMissing(ids)) return
  const w = pixelWindow()
  if (w.__minglaMarketingPixelPage === pathname) return
  w.__minglaMarketingPixelPage = pathname
  safe(() => w.fbq?.('track', 'PageView'))
  safe(() => w.ttq?.page?.())
  safe(() => w.snaptr?.('track', 'PAGE_VIEW'))
  safe(() => w.rdt?.('track', 'PageVisit'))
  if (!isHostContentPath(pathname)) return
  safe(() => w.fbq?.('track', 'ViewContent', { content_category: 'host', content_name: pathname }))
  safe(() => w.ttq?.track?.('ViewContent', { content_category: 'host', content_name: pathname }))
  safe(() => w.snaptr?.('track', 'VIEW_CONTENT', { item_category: 'host' }))
  safe(() => w.rdt?.('track', 'ViewContent'))
}

/**
 * A host lead (book a call, tools email gate) on the four pixels, with the
 * server's `lead_event_id` as the shared dedup id. Names from the catalogue
 * (lib/ad-event-catalog.ts, the twin of the server's adEventCatalog.ts).
 */
export function fireMarketingHostLead(
  eventId: string,
  ids: MarketingPixelIds = marketingPixelIds(),
): void {
  if (!eventId || typeof window === 'undefined') return
  if (isPixelPrivatePage(window.location.pathname, window.location.search)) return
  if (!bootMissing(ids)) return
  const w = pixelWindow()
  const names = MARKETING_HOST_LEAD_EVENT
  safe(() => w.fbq?.('track', names.meta, {}, { eventID: eventId }))
  safe(() => w.ttq?.track?.(names.tiktok, {}, { event_id: eventId }))
  safe(() => w.snaptr?.('track', names.snap, { client_dedup_id: eventId }))
  safe(() => w.rdt?.('track', names.reddit, { conversionId: eventId }))
}

/**
 * #4452 §4.2 / §4.6: a labelled Lead or a booked call on the four pixels, with
 * the server's event id as the shared dedup id. The label rides as
 * content_category (Meta, TikTok), item_category (Snap pixel) and the one
 * product's category (Reddit). Only fires when the ads choice is on (bootMissing).
 */
export function fireMarketingLabelled(
  kind: 'lead' | 'call',
  label: MarketingLeadLabel,
  eventId: string,
  ids: MarketingPixelIds = marketingPixelIds(),
): void {
  if (!eventId || typeof window === 'undefined') return
  if (isPixelPrivatePage(window.location.pathname, window.location.search)) return
  if (!bootMissing(ids)) return
  const w = pixelWindow()
  const rowKey = kind === 'lead' ? `${label}_lead` : `${label}_call_booked`
  const names = MARKETING_HOST_FUNNEL_PIXEL_EVENTS[rowKey as keyof typeof MARKETING_HOST_FUNNEL_PIXEL_EVENTS]
  const v = MARKETING_LEAD_LABEL_VALUE[label]
  const category = kind === 'lead' ? v.lead : v.call
  safe(() => w.fbq?.('track', names.meta, { content_category: category, content_name: v.name }, { eventID: eventId }))
  safe(() => w.ttq?.track?.(names.tiktok, { content_category: category, content_name: v.name }, { event_id: eventId }))
  safe(() => w.snaptr?.('track', names.snap, { item_category: category, client_dedup_id: eventId }))
  safe(() => w.rdt?.('track', names.reddit, { conversionId: eventId, products: [{ id: category, name: v.name, category }] }))
}

export function fireMarketingLead(label: MarketingLeadLabel, eventId: string): void {
  fireMarketingLabelled('lead', label, eventId)
}

export function fireMarketingGoal(label: MarketingLeadLabel, eventId: string): void {
  fireMarketingLabelled('call', label, eventId)
}

function expireCookie(name: string): void {
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT'
  for (const domain of ['', '; domain=.usemingla.com']) {
    document.cookie = `${name}=; expires=${expires}; path=/${domain}; SameSite=Lax`
  }
}

/** Ads turned off: revoke, remove every pixel script and expire the pixel cookies. */
export function stopMarketingPixels(): void {
  if (typeof window === 'undefined') return
  const w = pixelWindow()
  safe(() => w.fbq?.('consent', 'revoke'))
  safe(() => w.ttq?.revokeConsent?.())
  for (const script of Array.from(document.querySelectorAll('script[data-mingla-pixel]'))) script.remove()
  for (const name of MARKETING_PIXEL_COOKIES) expireCookie(name)
  w.fbq = undefined
  w._fbq = undefined
  w.ttq = undefined
  w.snaptr = undefined
  w.rdt = undefined
  w.__minglaMarketingPixelPage = undefined
}
