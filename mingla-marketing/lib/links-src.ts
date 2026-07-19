// ORCH-1399 [links-src-tracking-getapp-stack] — the `?src=` → AppsFlyer `pid`
// contract for usemingla.com/links.
//
// WHAT THIS SOLVES. /links is the single link in Seth's social bios. Today every
// install that starts there is ANONYMOUS: the OneLink attributes it to the template
// default, indistinguishable from organic, so "which platform is actually working?"
// has no answer. `usemingla.com/links?src=youtube` now carries that source into the
// OneLink as `pid=bio_youtube` + `c=explorer_bio|business_bio`, which rides through
// to the Play install referrer (proven by execution — SPEC §0.5).
//
// ── SECURITY BOUNDARY ────────────────────────────────────────────────────────────
// `src` is UNTRUSTED INPUT that ends up inside an OUTBOUND URL. Anyone can put
// anything in it. It is sanitised HERE, once, before any caller sees it. Never
// interpolate a raw `src` into an href.
//
// WHY A CHARSET FILTER AND NOT AN ALLOWLIST (deliberate, SPEC §4.3). An allowlist
// (['youtube','linkedin','seth']) would need a CODE DEPLOY for every new channel —
// which destroys the whole point of a source-aware bio link. Seth must be able to
// drop ?src=podcast in a new bio today and have it work. ACCEPTED RESIDUAL RISK: a
// third party can mint ?src=whatever and add junk rows to AppsFlyer reporting. The
// blast radius is bounded to junk custom media sources INSIDE the `bio_` namespace —
// they can never collide with a reserved SRN, never reach paid reporting, and never
// affect a destination.
//
// ── H-1: `pid` IS ALWAYS `bio_`-PREFIXED ─────────────────────────────────────────
// `pid=facebook` must be UNREACHABLE BY CONSTRUCTION, not merely unlikely. A bare
// platform name mints a NEW custom media source called `facebook` sitting one row
// away from the real `Facebook Ads` SRN in every dashboard — indistinguishable to a
// human reading a report, so organic bio traffic gets read as paid social. `bio_*` is
// also collision-free against every FUTURE reserved name AppsFlyer adds, and it is
// self-documenting. `toBioPid` is the ONLY writer of the prefix, so H-1 is structural
// rather than a rule someone has to remember.
//
// React-free and pure, so the repo's plain tsc+node test pattern can exercise it (the
// marketing package has no jest runner).

/**
 * The sanitisation charset. ANCHORED (`^…$`) — this is load-bearing, not style.
 * Unanchored, `/[a-z0-9_]{1,32}/` would find a PARTIAL match inside
 * `<script>alert(1)</script>` and happily emit it. The anchors are what make a
 * malformed `src` fail whole rather than leak a fragment. Guarded by
 * orch-1399-links-src-onelink-attribution.mjs (R4).
 */
export const LINKS_SRC_PATTERN = /^[a-z0-9_]{1,32}$/

/**
 * FAIL-SAFE value. Invalid and absent BOTH land here — one path, one fallback,
 * nothing to get wrong.
 *
 * WHY A REAL VALUE AND NOT OMISSION: dropping `pid` entirely would let the install
 * fall back to the OneLink template default, making it indistinguishable from
 * organic — which re-creates the exact anonymity this module exists to kill.
 * `bio_direct` is a real, queryable answer: "someone opened /links with no src".
 */
export const LINKS_SRC_FALLBACK = 'direct'

/** The H-1 namespace prefix. The ONLY place this string is written is `toBioPid`. */
export const LINKS_PID_PREFIX = 'bio_'

/**
 * The `pid` for owned non-bio site surfaces (nav / hero / /business/download).
 * Deliberately NOT `bio_*`: these are not bio traffic. Not a reserved SRN either, so
 * it cannot corrupt paid reporting (SPEC OQ-4).
 */
export const SITE_PID = 'mingla_web'

/** Campaigns for the two /links bio surfaces — set by the TAB TAPPED, not by `src`. */
export type LinksCampaign = 'explorer_bio' | 'business_bio'

/** Campaigns for the owned non-bio site surfaces (SPEC OQ-4). */
export type SiteCampaign =
  | 'explorer_nav'
  | 'business_nav'
  | 'business_hero'
  | 'business_download'

export type OneLinkCampaign = LinksCampaign | SiteCampaign

/** Everything a OneLink needs to attribute an install. */
export interface OneLinkAttribution {
  /** ALWAYS `bio_`-prefixed for bio traffic (H-1), or SITE_PID for site surfaces. */
  pid: string
  campaign: OneLinkCampaign
}

/**
 * Sanitise an untrusted `?src=` into a safe token. NEVER throws — a malformed `src`
 * must never break the page.
 *
 * Handles Next's repeated-param shape: `?src=a&src=b` arrives as `string[]`, which is
 * AMBIGUOUS, so it fails safe. (An implementor treating `searchParams.src` as a plain
 * `string` here would ship the literal `"a,b"` into the pid.)
 *
 * @param raw `searchParams.src` — string, string[], undefined or null.
 * @returns a token matching `LINKS_SRC_PATTERN`, or `LINKS_SRC_FALLBACK`.
 */
export function sanitizeLinksSrc(raw: string | string[] | undefined | null): string {
  // Ambiguous (?src=a&src=b), absent, or not a string → fail safe.
  if (typeof raw !== 'string') return LINKS_SRC_FALLBACK
  // Bios are typed by humans: tolerate case and surrounding whitespace.
  const normalised = raw.trim().toLowerCase()
  if (!LINKS_SRC_PATTERN.test(normalised)) return LINKS_SRC_FALLBACK
  return normalised
}

/**
 * The ONE writer of the `bio_` prefix (H-1). Rooted at `LINKS_PID_PREFIX` by
 * construction, so a `pid` can never be a bare interpolation of `src`.
 *
 * NOTE ON DOUBLE-PREFIXING: `?src=bio_youtube` yields `bio_bio_youtube`. That is ugly
 * but SAFE and deliberate — stripping an existing `bio_` would hand an attacker a way
 * to control the whole pid namespace. Ugly-and-safe beats clever-and-bypassable.
 */
export function toBioPid(src: string): string {
  return `${LINKS_PID_PREFIX}${src}`
}

/**
 * Build a OneLink href carrying attribution.
 *
 * Uses URLSearchParams as DEFENCE IN DEPTH: the values are already sanitised, so this
 * is the second lock, not the first. Manual string concat here would be a silent hole
 * the moment anyone widens the charset.
 *
 * @param base EXPLORER_ONELINK_URL or BUSINESS_ONELINK_URL — never crossed (H-2).
 */
export function buildOneLinkHref(base: string, attribution: OneLinkAttribution): string {
  const params = new URLSearchParams({
    pid: attribution.pid,
    c: attribution.campaign,
  })
  return `${base}?${params.toString()}`
}

/**
 * The /links bio attribution for a tab: sanitised `src` → `bio_` pid + the tab's own
 * campaign. `src` is resolved ONCE on the server and passed down as a prop, so it is a
 * PAGE-level value that tab switching cannot lose (SPEC §4.4).
 */
export function linksAttribution(src: string, campaign: LinksCampaign): OneLinkAttribution {
  return { pid: toBioPid(src), campaign }
}

/** The attribution for an owned non-bio site surface (SPEC OQ-4). */
export function siteAttribution(campaign: SiteCampaign): OneLinkAttribution {
  return { pid: SITE_PID, campaign }
}
