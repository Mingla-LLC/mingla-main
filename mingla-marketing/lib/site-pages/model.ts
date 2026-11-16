// #4452 §2.2–2.4 — the pure rules behind spots, blocks and pop-ups (unit tested,
// lib/__tests__/issue-4452-site-blocks.implementor.test.mjs).
//
// Pure: no React, no I/O.

export type DestKind = 'app' | 'form_page' | 'popup' | 'schedule' | 'schedule_creators' | 'schedule_locals' | 'url'
export interface Dest {
  kind: DestKind
  form_id?: string
  href?: string
}

export interface PopupSettings {
  trigger: 'scroll_half' | 'after_20s' | 'exit_intent' | 'button_only'
  freq: 'weekly' | 'visit' | 'every_view'
  devices: 'all' | 'phone' | 'desktop'
  style: 'centre' | 'side'
}

export interface Block {
  id: string
  type: 'form' | 'buttons' | 'banner' | 'popup'
  spot: string
  all_host_pages?: boolean
  form_id?: string
  head?: string
  em?: string
  sub?: string
  buttons?: Array<{ text: string; to: Dest }>
  text?: string
  btn?: string
  to?: Dest
  show_until?: string | null
  popup?: PopupSettings
}

export interface HeroEdit {
  h1: string
  em?: string
  lead?: string
  buttons: Array<{ text: string; to: Dest }>
}

export interface PageContent {
  blocks: Block[]
  hero?: HeroEdit | null
}

export interface PublicForm {
  id: string
  key: string
  name: string
  version: number
  audience: 'host' | 'creator' | 'local'
  template?: string | null
  slug?: string | null
  fields: unknown[]
  design?: Record<string, unknown>
  own_page?: Record<string, unknown>
  ads?: { lead_on: boolean; goal: string }
  preview?: boolean
}

export interface SiteContent {
  pages: Record<string, PageContent>
  forms: Record<string, PublicForm>
  form_pages: Record<string, { form_id: string; current_slug: string | null }>
}

export const EMPTY_CONTENT: SiteContent = { pages: {}, forms: {}, form_pages: {} }
export const HOST_TEMPLATE_KEY = 'host-template'

/**
 * The block for one spot: the page's own block wins over an "all host pages"
 * block in the same spot. A form block whose form is not live (archived or
 * missing) renders nothing (D-6).
 */
export function blockForSpot(content: SiteContent, pageKey: string, spot: string, isHostTemplatePage: boolean): Block | null {
  const own = content.pages[pageKey]?.blocks?.find((b) => b.spot === spot) ?? null
  const shared = isHostTemplatePage
    ? content.pages[HOST_TEMPLATE_KEY]?.blocks?.find((b) => b.spot === spot && b.all_host_pages === true) ?? null
    : null
  const block = own ?? shared
  if (!block) return null
  if ((block.type === 'form' || block.type === 'popup') && (!block.form_id || !content.forms[block.form_id])) return null
  return block
}

/** The page's pop-up block (own first, then the host template's), or null. */
export function popupFor(content: SiteContent, pageKey: string | null, isHostTemplatePage: boolean): Block | null {
  if (!pageKey) return null
  return blockForSpot(content, pageKey, 'popup', isHostTemplatePage)
}

/** Where a button goes. A form page follows the form's CURRENT slug (SC-94). */
export function destHref(dest: Dest | undefined, content: SiteContent, hostPage = false): string | null {
  if (!dest) return null
  switch (dest.kind) {
    case 'app':
      return hostPage ? '/host/download' : '/download'
    case 'form_page': {
      const slug = dest.form_id ? content.forms[dest.form_id]?.slug : null
      return slug ? `/apply/${slug}` : null
    }
    case 'popup':
      return '#mingla-popup'
    case 'schedule':
      return '/schedule'
    case 'schedule_creators':
      return '/schedule/creators'
    case 'schedule_locals':
      return '/schedule/locals'
    case 'url':
      return dest.href && /^https:\/\//.test(dest.href) ? dest.href : null
  }
}

/**
 * Show a banner until 23:59 of its date in the visitor's zone. On the server
 * (no zone), keep it until the date has passed even in UTC−12, so a cached page
 * never shows a stale banner.
 */
export function bannerVisible(showUntil: string | null | undefined, nowMs: number, onServer: boolean): boolean {
  if (!showUntil || !/^\d{4}-\d{2}-\d{2}$/.test(showUntil)) return true
  const [y, m, d] = showUntil.split('-').map(Number)
  if (onServer) return nowMs < Date.UTC(y, m - 1, d, 23, 59, 59) + 12 * 3_600_000
  const local = new Date(nowMs)
  const end = new Date(y, m - 1, d, 23, 59, 59)
  return local.getTime() <= end.getTime()
}

/** Pages where the pop-up never shows. */
export function popupBlockedPath(pathname: string): boolean {
  return /^\/(apply|schedule|unsubscribe)(\/|$)/.test(pathname) || /^\/tools\/[^/]+\/report/.test(pathname)
}

export interface PopupMemory {
  /** ms of the last close for this pop-up, from localStorage. */
  closedAt: number | null
  /** set for 180 days after a successful submit of this form. */
  doneAt: number | null
  /** already shown in this browser session. */
  shownThisVisit: boolean
  /** already shown on this page view. */
  shownThisView: boolean
  /** storage threw (Safari private mode): at most once per page load. */
  storageBroken: boolean
}

export const WEEK_MS = 7 * 24 * 3_600_000
export const DONE_MS = 180 * 24 * 3_600_000

/** §2.4 frequency and the fixed rules (never after a submit; never twice on one view). */
export function popupAllowed(freq: PopupSettings['freq'], m: PopupMemory, nowMs: number): boolean {
  if (m.shownThisView) return false
  if (m.doneAt !== null && nowMs - m.doneAt < DONE_MS) return false
  if (m.storageBroken) return true
  if (freq === 'weekly') return m.closedAt === null || nowMs - m.closedAt >= WEEK_MS
  if (freq === 'visit') return !m.shownThisVisit
  return true
}

/** §2.4 devices: phones are under 860 px. exit_intent falls back to scroll_half on phones. */
export function effectiveTrigger(s: PopupSettings, isPhone: boolean): PopupSettings['trigger'] | null {
  if (s.devices === 'phone' && !isPhone) return null
  if (s.devices === 'desktop' && isPhone) return null
  if (s.trigger === 'exit_intent' && isPhone) return 'scroll_half'
  return s.trigger
}

/** scroll_half: scrollY + innerHeight ≥ half the document. */
export function reachedHalf(scrollY: number, innerHeight: number, docHeight: number): boolean {
  return scrollY + innerHeight >= 0.5 * docHeight
}
