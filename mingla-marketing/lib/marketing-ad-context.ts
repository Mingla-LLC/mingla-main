// #4238 W3-3 (D7), usemingla.com sender half — the ad context a host lead
// carries to the server (growth-tools-book on /schedule, growth-tools-gate on
// the free tools' email gate), in the exact shape the server's
// parseHostAdContext (supabase/functions/_shared/hostFunnelConversion.ts)
// reads:
//
//   { click_id?, fbp?, fbc?, ttp?, scid?, tracking_opt_out, page_url }
//
// While ads are on: the first-party click id attribution-capture minted for
// this tab, the four pixel cookies and the page URL (origin + path; the query
// and hash never leave). While ads are off (GPC starts them off): only the
// opt-out and the page URL, so the server stores the opt-out and sends nothing.
//
// The server answers `lead_event_id` (`lead:<id>`, `lead:tool:<id>`); the
// sender then fires the browser Lead with that id (lib/marketing-pixels.ts,
// loaded only now), so the pair deduplicates.

import { isMarketingAdsOn } from '@/components/marketing/marketing-capture'
import { readFirstPartyClickId } from '@/lib/landing-campaign'

export interface MarketingAdContext {
  click_id?: string
  fbp?: string
  fbc?: string
  ttp?: string
  scid?: string
  tracking_opt_out: boolean
  page_url: string
}

function cookie(name: string): string | undefined {
  try {
    for (const part of document.cookie.split(';')) {
      const [key, ...rest] = part.trim().split('=')
      if (key === name) {
        const value = decodeURIComponent(rest.join('='))
        return value.length > 0 && value.length <= 500 ? value : undefined
      }
    }
  } catch {
    // No cookie access: the server simply gets no browser id.
  }
  return undefined
}

function pageUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

/** The ad context for a host lead request body (`ad`). Null on the server. */
export function marketingAdContext(): MarketingAdContext | null {
  if (typeof window === 'undefined') return null
  if (!isMarketingAdsOn()) return { tracking_opt_out: true, page_url: pageUrl() }
  const out: MarketingAdContext = { tracking_opt_out: false, page_url: pageUrl() }
  const clickId = readFirstPartyClickId()
  if (clickId) out.click_id = clickId
  const fbp = cookie('_fbp')
  const fbc = cookie('_fbc')
  const ttp = cookie('_ttp')
  const scid = cookie('_scid')
  if (fbp) out.fbp = fbp
  if (fbc) out.fbc = fbc
  if (ttp) out.ttp = ttp
  if (scid) out.scid = scid
  return out
}

/** The server's lead event id from a lead function's JSON answer, or null. */
export function leadEventIdFrom(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const id = (body as { lead_event_id?: unknown }).lead_event_id
  return typeof id === 'string' && /^lead:[A-Za-z0-9:_-]{1,200}$/.test(id) ? id : null
}

/**
 * The browser Lead twin (ads on only). The pixel module is loaded here, after
 * the lead is saved, never on the page's first load. Never throws.
 */
export async function fireBrowserHostLead(eventId: string | null): Promise<void> {
  if (eventId === null || typeof window === 'undefined' || !isMarketingAdsOn()) return
  try {
    const { fireMarketingHostLead } = await import('@/lib/marketing-pixels')
    fireMarketingHostLead(eventId)
  } catch (error) {
    console.warn('[marketing pixels] browser Lead not sent (non-fatal):', error)
  }
}
