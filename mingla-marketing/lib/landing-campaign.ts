// #4339 round B — the campaign a visitor landed with (utm_* and the ad click
// id, with its network's parameter name since #4238 W3-2), kept for this tab so the app hand-off can carry it into the AppsFlyer
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

/** An ad network's click id with the URL parameter it arrived under. */
export interface LandingClickId {
  /** fbclid, ttclid, sccid, rdt_cid, gclid, gbraid or wbraid (ScCid is stored as sccid). */
  readonly key: ClickIdKey
  readonly value: string
}

export interface LandingCampaign {
  /** utm_* values, keys as received (utm_source, utm_medium, utm_campaign, …). */
  readonly utm: Readonly<Record<string, string>>
  /**
   * The first ad click id present, by host web's precedence (fbclid, ttclid,
   * sccid, rdt_cid, gclid, gbraid, wbraid), with its own parameter name.
   * #4238 W3-2 (I-4238-CLICK-ID-KEEPS-NETWORK): a click id is never stored or
   * forwarded under another network's parameter name.
   */
  readonly clickId: LandingClickId | null
  /** The first-party click id attribution-capture minted for this tab (mc_click on host web). */
  readonly firstPartyClickId: string | null
}

export const LANDING_CAMPAIGN_KEY = 'mingla_landing_campaign_v1'
/** lib/ad-click-capture.ts stores the first-party touch's click id here (sessionStorage). */
export const AD_CLICK_KEY = 'mingla_ad_click_v1'
const UTM_KEY = /^utm_[a-z0-9_]{1,24}$/
export const CLICK_ID_KEYS = ['fbclid', 'ttclid', 'sccid', 'rdt_cid', 'gclid', 'gbraid', 'wbraid'] as const
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number]
/** Parameters read, in precedence order; Snapchat's `ScCid` is the same id as `sccid`. */
const CLICK_ID_PARAMS: ReadonlyArray<readonly [string, ClickIdKey]> = [
  ['fbclid', 'fbclid'],
  ['ttclid', 'ttclid'],
  ['sccid', 'sccid'],
  ['ScCid', 'sccid'],
  ['rdt_cid', 'rdt_cid'],
  ['gclid', 'gclid'],
  ['gbraid', 'gbraid'],
  ['wbraid', 'wbraid'],
]
const CLICK_VALUE = /^[A-Za-z0-9._~\-]{1,200}$/
const FIRST_PARTY_CLICK_ID = /^[A-Za-z0-9_-]{8,200}$/
const VALUE = /^[A-Za-z0-9._~\-+% ]{1,100}$/

export const EMPTY_CAMPAIGN: LandingCampaign = { utm: {}, clickId: null, firstPartyClickId: null }

/** The campaign in a query string, keeping only safe utm_* values and one click id. */
export function parseLandingCampaign(search: string): LandingCampaign {
  const params = new URLSearchParams(search)
  const utm: Record<string, string> = {}
  for (const [key, raw] of params) {
    const value = raw.trim()
    if (UTM_KEY.test(key) && VALUE.test(value) && !(key in utm) && Object.keys(utm).length < 8) utm[key] = value
  }
  return { utm, clickId: parseClickId(params), firstPartyClickId: null }
}

/** The first click id in a query, under its own network's key. */
export function parseClickId(params: URLSearchParams): LandingClickId | null {
  for (const [param, key] of CLICK_ID_PARAMS) {
    const value = params.get(param)?.trim()
    if (value && CLICK_VALUE.test(value)) return { key, value }
  }
  return null
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
    store.setItem(LANDING_CAMPAIGN_KEY, JSON.stringify({ utm: campaign.utm, clickId: campaign.clickId }))
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
    if (!raw) return { ...EMPTY_CAMPAIGN, firstPartyClickId: readFirstPartyClickId() }
    const parsed = JSON.parse(raw) as { utm?: unknown; clickId?: unknown }
    const search = new URLSearchParams()
    if (parsed.utm && typeof parsed.utm === 'object') {
      for (const [k, v] of Object.entries(parsed.utm as Record<string, unknown>)) if (typeof v === 'string') search.set(k, v)
    }
    // #4238 W3-2: rebuilt under its own key. A record from before (a bare
    // string, whose network was never kept) carries no click id rather than
    // being relabelled as a Google click.
    const stored = parsed.clickId as { key?: unknown; value?: unknown } | null | undefined
    if (stored && typeof stored === 'object' && typeof stored.key === 'string' && typeof stored.value === 'string') {
      if ((CLICK_ID_KEYS as readonly string[]).includes(stored.key)) search.set(stored.key, stored.value)
    }
    return { ...parseLandingCampaign(search.toString()), firstPartyClickId: readFirstPartyClickId() }
  } catch {
    return EMPTY_CAMPAIGN
  }
}

/**
 * The first-party click id of this tab's recorded touch (ads on only; the
 * capture never stores one while ads are off). Null when there is none.
 */
export function readFirstPartyClickId(): string | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(AD_CLICK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { clickId?: unknown }
    return typeof parsed.clickId === 'string' && FIRST_PARTY_CLICK_ID.test(parsed.clickId) ? parsed.clickId : null
  } catch {
    return null
  }
}
