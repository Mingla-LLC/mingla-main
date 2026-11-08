// #4339 round B — the campaign a visitor landed with (utm_* and the ad click
// id), kept for this tab so the app hand-off can carry it into the AppsFlyer
// OneLink (af_sub1–3) and the host web URL (utm_*). See withLandingCampaign in
// lib/app-handoff.ts for where it is applied.
//
// Consent: this is ad attribution, so it is read and stored ONLY while ads are
// on for this visitor (I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF, ads half; GPC
// starts it off). Turning ads off clears it. sessionStorage only: it ends with
// the tab and is never a cookie.
//
// The pure half (parseLandingCampaign) is React-free and has no window access,
// so the node test loads it.

export interface LandingCampaign {
  /** utm_* values, keys as received (utm_source, utm_medium, utm_campaign, …). */
  readonly utm: Readonly<Record<string, string>>
  /** The first ad click id present, by precedence gclid, gbraid, wbraid, fbclid, ttclid. */
  readonly clickId: string | null
}

export const LANDING_CAMPAIGN_KEY = 'mingla_landing_campaign_v1'
const UTM_KEY = /^utm_[a-z0-9_]{1,24}$/
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid'] as const
const VALUE = /^[A-Za-z0-9._~\-+% ]{1,100}$/

export const EMPTY_CAMPAIGN: LandingCampaign = { utm: {}, clickId: null }

/** The campaign in a query string, keeping only safe utm_* values and one click id. */
export function parseLandingCampaign(search: string): LandingCampaign {
  const params = new URLSearchParams(search)
  const utm: Record<string, string> = {}
  for (const [key, raw] of params) {
    const value = raw.trim()
    if (UTM_KEY.test(key) && VALUE.test(value) && !(key in utm) && Object.keys(utm).length < 8) utm[key] = value
  }
  let clickId: string | null = null
  for (const key of CLICK_IDS) {
    const value = params.get(key)?.trim()
    if (value && /^[A-Za-z0-9._~\-]{1,200}$/.test(value)) {
      clickId = value
      break
    }
  }
  return { utm, clickId }
}

export function isEmptyCampaign(campaign: LandingCampaign): boolean {
  return campaign.clickId === null && Object.keys(campaign.utm).length === 0
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Record the landing campaign once per tab (a later page without parameters
 * keeps the first one; a new campaign replaces it). `adsOn` is the visitor's
 * ads choice, passed in so this module never imports the privacy owner.
 */
export function rememberLandingCampaign(search: string, adsOn: boolean): void {
  const store = storage()
  if (!store) return
  if (!adsOn) {
    store.removeItem(LANDING_CAMPAIGN_KEY)
    return
  }
  const campaign = parseLandingCampaign(search)
  if (isEmptyCampaign(campaign)) return
  try {
    store.setItem(LANDING_CAMPAIGN_KEY, JSON.stringify(campaign))
  } catch {
    // Private mode or a full store: the hand-off simply carries no campaign.
  }
}

/** The tab's landing campaign, or the empty campaign (always empty while ads are off). */
export function readLandingCampaign(adsOn: boolean): LandingCampaign {
  if (!adsOn) return EMPTY_CAMPAIGN
  const store = storage()
  if (!store) return EMPTY_CAMPAIGN
  try {
    const raw = store.getItem(LANDING_CAMPAIGN_KEY)
    if (!raw) return EMPTY_CAMPAIGN
    const parsed = JSON.parse(raw) as { utm?: unknown; clickId?: unknown }
    const search = new URLSearchParams()
    if (parsed.utm && typeof parsed.utm === 'object') {
      for (const [k, v] of Object.entries(parsed.utm as Record<string, unknown>)) if (typeof v === 'string') search.set(k, v)
    }
    if (typeof parsed.clickId === 'string') search.set('gclid', parsed.clickId)
    return parseLandingCampaign(search.toString())
  } catch {
    return EMPTY_CAMPAIGN
  }
}
