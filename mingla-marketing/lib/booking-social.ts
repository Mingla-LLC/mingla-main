// #4339 §6 — the /schedule page's booking fields, checked in the browser.
//
// The server is the authority (supabase/functions/growth-tools-book/
// bookingContext.ts). This is the same rule set, so a person sees the problem
// before they press Confirm, and both sides are pinned by one fixture table
// (lib/booking-social.fixtures.json), asserted by the marketing test and by the
// function's Deno suite.
//
//   - What do you run? one of the eight values (the seven Host landing pages'
//     ICPs plus "Something else"). `?icp=<slug>` from a landing page preselects it.
//   - Main social: platform + handle. A leading @ is stripped, no spaces, only
//     the characters that platform allows; a pasted full profile URL is kept,
//     but only from that platform's own domain.
//   - Website: optional; a public http(s) address when given.
//
// React-free and pure, so node's type stripping can run it in the tests.

export const BOOKING_ICPS = [
  { value: 'events', label: 'Events' },
  { value: 'trips', label: 'Trips' },
  { value: 'experiences', label: 'Experiences or classes' },
  { value: 'restaurants', label: 'A restaurant, café or diner' },
  { value: 'hotels', label: 'A hotel or resort' },
  { value: 'art', label: 'A gallery, museum or art space' },
  { value: 'play', label: 'A play space, bowling or arcade' },
  { value: 'other', label: 'Something else' },
] as const
export type BookingIcp = (typeof BOOKING_ICPS)[number]['value']

export const SOCIAL_PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'linkedin', label: 'LinkedIn' },
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]['value']

interface PlatformRule {
  handle: RegExp
  domains: readonly string[]
  profile: (handle: string) => string
}

const RULES: Readonly<Record<SocialPlatform, PlatformRule>> = {
  instagram: { handle: /^[A-Za-z0-9._]{1,30}$/, domains: ['instagram.com'], profile: (h) => `https://instagram.com/${h}` },
  tiktok: { handle: /^[A-Za-z0-9._]{2,24}$/, domains: ['tiktok.com'], profile: (h) => `https://tiktok.com/@${h}` },
  facebook: { handle: /^[A-Za-z0-9.]{1,50}$/, domains: ['facebook.com', 'fb.com'], profile: (h) => `https://facebook.com/${h}` },
  x: { handle: /^[A-Za-z0-9_]{1,15}$/, domains: ['x.com', 'twitter.com'], profile: (h) => `https://x.com/${h}` },
  youtube: { handle: /^[A-Za-z0-9._-]{3,30}$/, domains: ['youtube.com'], profile: (h) => `https://youtube.com/@${h}` },
  linkedin: { handle: /^[A-Za-z0-9-]{3,100}$/, domains: ['linkedin.com'], profile: (h) => `https://linkedin.com/in/${h}` },
}

const MAX_SOCIAL_INPUT = 300
const MAX_WEBSITE_INPUT = 300

/** The ICP a landing page preselected (`?icp=`), or '' when it is not one of the eight. */
export function icpFromParam(raw: string | null): BookingIcp | '' {
  const value = (raw ?? '').trim().toLowerCase()
  return BOOKING_ICPS.some((icp) => icp.value === value) ? (value as BookingIcp) : ''
}

export function isSocialPlatform(raw: string): raw is SocialPlatform {
  return SOCIAL_PLATFORMS.some((p) => p.value === raw)
}

function pastedProfileUrl(platform: SocialPlatform, value: string): string | null {
  const looksLikeUrl = /^https?:\/\//i.test(value) || /^(?:www\.|m\.|mobile\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(value)
  if (!looksLikeUrl) return null
  const typed = /^https?:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(typed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '')
  if (!RULES[platform].domains.includes(host)) return null
  if (url.pathname.replace(/\/+$/, '') === '') return null
  return typed
}

/** The working profile link for platform + what was typed, or null when it is not valid for that platform. */
export function socialProfileUrl(platform: string, raw: string): string | null {
  if (!isSocialPlatform(platform)) return null
  const value = raw.trim()
  if (value === '' || value.length > MAX_SOCIAL_INPUT || /\s/.test(value)) return null
  const pasted = pastedProfileUrl(platform, value)
  if (pasted !== null) return pasted
  if (/[/:]/.test(value)) return null
  const handle = value.replace(/^@/, '')
  return RULES[platform].handle.test(handle) ? RULES[platform].profile(handle) : null
}

/** True when the optional website is empty or a public http(s) address. */
export function websiteIsValid(raw: string): boolean {
  const value = raw.trim()
  if (value === '') return true
  if (value.length > MAX_WEBSITE_INPUT || /\s/.test(value)) return false
  const typed = /^https?:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(typed)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username !== '' || url.password !== '') return false
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return false
  return /[a-z]/i.test(url.hostname.split('.').pop() ?? '')
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface BookingDetails {
  name: string
  email: string
  icp: string
  socialPlatform: string
  socialHandle: string
  venue: string
  website: string
}

export type BookingField = 'name' | 'email' | 'icp' | 'social' | 'website'

/** Each field's problem, in form order; empty when the details can be booked. */
export function bookingErrors(details: BookingDetails): Partial<Record<BookingField, string>> {
  const errors: Partial<Record<BookingField, string>> = {}
  if (details.name.trim().length < 2) errors.name = 'Add your name.'
  if (!EMAIL_REGEX.test(details.email.trim()) || details.email.trim().length > 254) errors.email = 'Add an email we can send the invite to.'
  if (icpFromParam(details.icp) === '') errors.icp = 'Choose what you run.'
  if (socialProfileUrl(details.socialPlatform, details.socialHandle) === null) {
    const label = SOCIAL_PLATFORMS.find((p) => p.value === details.socialPlatform)?.label ?? 'social'
    errors.social = details.socialHandle.trim() === ''
      ? `Add your ${label} handle.`
      : `That doesn’t look like a handle for ${label}. Use the handle, like @yourplace, or paste your profile link.`
  }
  if (!websiteIsValid(details.website)) errors.website = 'Use a web address, like yourplace.com.'
  return errors
}

// ---------------------------------------------------------------------------
// #4339 Creators and Locals calls (Seth approved, 9 Nov): /schedule/creators
// and /schedule/locals book through the same function with `audience`
// creator | local (host, the default, is the /schedule form above and is
// unchanged). The server checks the same rules per audience
// (supabase/functions/growth-tools-book/bookingContext.ts
// parseBookingContext), and the fixture table's `audiences` rows pin both.
//
//   creator: name, email, city, main social and "What do you make?" (video,
//            photo or both) required; "Link to your best work" optional, a
//            public http(s) address when given.
//   local:   name, email, city and main social required; "A place you'd
//            review first" optional.
//
// The city list is every live Mingla city, read at request time from
// `links_page_cities()` (lib/links-data.ts, #4318) and never written here,
// sorted by name, with "Somewhere else" last (cityOptions).
// ---------------------------------------------------------------------------

export const BOOKING_AUDIENCES = ['host', 'creator', 'local'] as const
export type BookingAudience = (typeof BOOKING_AUDIENCES)[number]
export type ProgramAudience = Exclude<BookingAudience, 'host'>

export const CREATOR_MAKES = [
  { value: 'video', label: 'Video' },
  { value: 'photo', label: 'Photos' },
  { value: 'both', label: 'Both' },
] as const
export type CreatorMakes = (typeof CREATOR_MAKES)[number]['value']

/** The last city option, always offered, so nobody is blocked. */
export const SOMEWHERE_ELSE = 'Somewhere else'

export const MAX_CITY_INPUT = 80
export const MAX_FIRST_PLACE_INPUT = 120

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/

/**
 * The "Your city" options: every live city's name from `links_page_cities()`
 * rows, de-duplicated, sorted by name, then "Somewhere else". With no rows
 * (the read failed, or no database) it is "Somewhere else" alone, and the page
 * adds a free-text city field.
 */
export function cityOptions(rows: ReadonlyArray<{ name?: unknown }>): string[] {
  const names = new Set<string>()
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (name !== '' && name.length <= MAX_CITY_INPUT && !CONTROL_CHARS.test(name) && name !== SOMEWHERE_ELSE) names.add(name)
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  return [...sorted, SOMEWHERE_ELSE]
}

/** True when the city is a real single-line value (2 to 80 characters). */
export function cityIsValid(raw: string): boolean {
  const value = raw.trim()
  return value.length >= 2 && value.length <= MAX_CITY_INPUT && !CONTROL_CHARS.test(value)
}

export function isCreatorMakes(raw: string): raw is CreatorMakes {
  return CREATOR_MAKES.some((m) => m.value === raw)
}

export interface ProgramBookingDetails {
  audience: ProgramAudience
  name: string
  email: string
  city: string
  socialPlatform: string
  socialHandle: string
  /** Creator only. */
  makes: string
  /** Creator only, optional. */
  workUrl: string
  /** Local only, optional. */
  firstPlace: string
}

export type ProgramBookingField = 'name' | 'email' | 'city' | 'social' | 'makes' | 'work_url' | 'first_place'

/** Each field's problem for a Creators or Locals call, in form order; empty when it can be booked. */
export function programBookingErrors(details: ProgramBookingDetails): Partial<Record<ProgramBookingField, string>> {
  const errors: Partial<Record<ProgramBookingField, string>> = {}
  if (details.name.trim().length < 2) errors.name = 'Add your name.'
  if (!EMAIL_REGEX.test(details.email.trim()) || details.email.trim().length > 254) errors.email = 'Add an email we can send the invite to.'
  if (!cityIsValid(details.city)) errors.city = 'Choose your city.'
  if (socialProfileUrl(details.socialPlatform, details.socialHandle) === null) {
    const label = SOCIAL_PLATFORMS.find((p) => p.value === details.socialPlatform)?.label ?? 'social'
    errors.social = details.socialHandle.trim() === ''
      ? `Add your ${label} handle.`
      : `That doesn’t look like a handle for ${label}. Use the handle, like @yourname, or paste your profile link.`
  }
  if (details.audience === 'creator') {
    if (!isCreatorMakes(details.makes)) errors.makes = 'Choose what you make.'
    if (!websiteIsValid(details.workUrl)) errors.work_url = 'Use a web address, like a link to a post or your portfolio.'
  } else if (details.firstPlace.trim().length > MAX_FIRST_PLACE_INPUT || CONTROL_CHARS.test(details.firstPlace)) {
    errors.first_place = 'Keep it to one place name.'
  }
  return errors
}
