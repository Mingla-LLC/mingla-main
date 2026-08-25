/**
 * #2589 — the readiness decision, as a pure function with no imports.
 *
 * WHY IT IS ITS OWN MODULE. `content-share-readiness.ts` pulls in the shared-card
 * proxy, which pulls in `sharp`, which pulls in a native binary. That is correct
 * for the running route and fatal for a proof: it means the decision could only
 * ever be asserted in a CI job that installs an image toolchain, and #2589's
 * whole subject is a decision that was WRONG for months while every suite around
 * it stayed green. The rule that broke lives here, alone, and is asserted
 * directly.
 *
 * THE RULE. A share is ready when the served page advertises a version at least
 * as new as the one the caller is holding. It used to demand exact equality
 * against a page whose own fetch mints the next version, so it could not
 * converge; see the long note on `verify`.
 */

export type ReadinessState = 'ready' | 'terminal' | 'absent' | 'transient';

export type ReadinessVerdict = {
  readonly state: ReadinessState;
  readonly status: number;
  /** The version the page advertises. Non-null only for `ready`. */
  readonly version: number | null;
  /**
   * True when a second identical attempt could produce a different answer. A
   * settled comparison is never retried: re-running it doubles the wall clock of
   * a verdict already decided, and the retry's own page fetch can push the
   * version further away.
   */
  readonly retryable: boolean;
};

/**
 * The version the served page is actually advertising.
 *
 * Both `og:image` and `og:image:secure_url` must be present, must point at this
 * code's portrait route at this revision, and must agree. Anything else — a
 * missing tag, a different code, two tags disagreeing — is null, which the caller
 * treats as "not this share's page" and never as ready.
 */
export function advertisedPortraitVersion(html: string, code: string): number | null {
  if (!/^[0-9A-Za-z]{16}$/.test(code)) return null
  const pattern = new RegExp(
    `<meta property="og:image(:secure_url)?" content="https://usemingla\\.com/og/s/${code}/v([1-9][0-9]*)-r2\\.jpg" />`,
    'g',
  )
  const found = new Set<string>()
  let plainSeen = false
  let secureUrlSeen = false
  for (const match of html.matchAll(pattern)) {
    if (match[1]) secureUrlSeen = true; else plainSeen = true
    found.add(match[2])
  }
  if (!plainSeen || !secureUrlSeen || found.size !== 1) return null
  const version = Number([...found][0])
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}

export function readinessVerdict(input: {
  readonly code: string
  readonly requested: number
  readonly pageStatus: number
  readonly imageStatus: number
  readonly html: string
}): ReadinessVerdict {
  const { code, requested, pageStatus, imageStatus, html } = input
  if (pageStatus === 410 || imageStatus === 410) return { state: 'terminal', status: 410, version: null, retryable: false }
  if (pageStatus === 404 || imageStatus === 404) return { state: 'absent', status: 404, version: null, retryable: false }
  // Any other non-200 is a transport-shaped failure: a second attempt can
  // genuinely differ, so this one IS retried.
  if (pageStatus !== 200 || imageStatus !== 200) return { state: 'transient', status: 503, version: null, retryable: true }

  const canonical = `https://usemingla.com/s/${code}`
  if (!html.includes(`<link rel="canonical" href="${canonical}" />`)) {
    return { state: 'transient', status: 502, version: null, retryable: false }
  }
  const advertised = advertisedPortraitVersion(html, code)
  // A page that has moved AHEAD does not strand the requested version: the
  // versioned image route resolves the frozen version and keeps rendering it,
  // which is why the caller can pair this with a 200 on that exact URL. Only a
  // page BEHIND the caller is genuinely mid-write — and even that is settled for
  // this attempt, because re-reading the page is what moved it in the first
  // place.
  if (advertised === null || advertised < requested) {
    return { state: 'transient', status: 502, version: null, retryable: false }
  }
  return { state: 'ready', status: 200, version: advertised, retryable: false }
}
