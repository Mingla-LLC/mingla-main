// #4273 — pages whose URL carries a private token are never measured.
//
// The SMS opt-out page lives at /unsubscribe/sms/<signed token>. The token
// names a campaign, brand and message (no contact), but it is still a
// per-recipient key, so no analytics sink (PostHog or GA) may record a page
// view, an event or a page_location for these paths. Anything that reports a
// location for them reports the token-free family path instead.
export const ANALYTICS_PRIVATE_PREFIXES = ['/unsubscribe/sms/'] as const

export function isAnalyticsPrivatePathname(pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string') return false
  return ANALYTICS_PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/** The pathname with any private token removed ('/unsubscribe/sms/<t>' → '/unsubscribe/sms'). */
export function analyticsSafePathname(pathname: string): string {
  for (const prefix of ANALYTICS_PRIVATE_PREFIXES) {
    if (pathname.startsWith(prefix)) return prefix.replace(/\/$/, '')
  }
  return pathname
}

/** True when a captured absolute URL points at a private path. */
export function isAnalyticsPrivateUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  try {
    return isAnalyticsPrivatePathname(new URL(url).pathname)
  } catch {
    return false
  }
}
