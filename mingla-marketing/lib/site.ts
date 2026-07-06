// ORCH-1319 — canonical marketing origin + the QR target.
//
// The QR MUST encode an ABSOLUTE URL on the canonical marketing origin so a phone
// scanner can resolve it (a relative path is meaningless off-device). SITE_ORIGIN
// is env-overridable (NEXT_PUBLIC_SITE_URL) and defaults to the live apex; any
// trailing slash is stripped so DOWNLOAD_URL never doubles a `/`.

export const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usemingla.com'
).replace(/\/$/, '')

/** The §4.2 smart-download route the QR encodes (one QR serves iOS + Android). */
export const DOWNLOAD_URL = `${SITE_ORIGIN}/download`
