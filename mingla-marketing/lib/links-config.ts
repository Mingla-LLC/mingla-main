// ORCH-1317 → #4318 — the static data for usemingla.com/links.
//
// #4318 replaced the two-tab Explorer / For Hosts page with the city week
// calendar. What stays here is what is still static: the social row and the
// remembered-city cookie. React-free so plain node tests can import it.
//
// STORE-LINK CONTRACT (HARD GUARD): this file never holds a store, OneLink or
// host-web URL. Every tap on /links resolves through the #4137 device seam
// (lib/cta-destination.ts, via lib/links-handoff.ts).
//
// SOCIALS (#4318 feedback 16, the team chat's approved set, 7 Nov 2026): ONE
// account set, @usemingla, on exactly these seven networks in this order. X and
// every @minglahost account are retired, so the old per_surface / neutral /
// explorer_only model (and its per-tab handle swap) is gone: one flat list.

export type LinksSocialId =
  | 'instagram'
  | 'tiktok'
  | 'threads'
  | 'snapchat'
  | 'youtube'
  | 'facebook'
  | 'linkedin'

export interface LinksSocial {
  id: LinksSocialId
  label: string
  href: string
}

export const LINKS_SOCIAL_HANDLE = 'usemingla'

export const LINKS_SOCIALS: readonly LinksSocial[] = [
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/usemingla' },
  { id: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@usemingla' },
  { id: 'threads', label: 'Threads', href: 'https://www.threads.com/@usemingla' },
  { id: 'snapchat', label: 'Snapchat', href: 'https://www.snapchat.com/add/usemingla' },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@usemingla' },
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/usemingla' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/usemingla' },
]
