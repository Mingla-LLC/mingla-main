// #4452 §2.1 — the one list of public usemingla.com pages (data in registry.json).
//
// Admin's Website pages list is built from public/site-manifest.json, which
// scripts/issue-4452-site-manifest.mjs writes from this registry at prebuild.
// scripts/issue-4452-site-manifest.check.mjs fails the build when a public
// route under app/** is neither here nor in EXCLUDED (with a reason).
// Invariant I-4452-SITE-PAGE-REGISTRY (declared in its test): every public route is in the registry or EXCLUDED (scripts/issue-4452-site-manifest.check.mjs).
import data from './registry.json'

export type SiteGroup = 'Explore' | 'Company' | 'Host' | 'Host landing pages' | 'Form pages'

export interface SiteSpot {
  key: string
  label: string
  kind: 'inline' | 'details'
}

export interface SitePage {
  key: string
  path: string
  group: SiteGroup
  title: string
  since: string
  spots?: SiteSpot[]
  hero?: { h1: number; em: number; lead: number; buttons: number }
  template?: 'host'
  pattern?: boolean
}

export const SITE_PAGES = data.pages as SitePage[]
export const EXCLUDED = data.excluded as Array<{ route: string; reason: string }>

/** The page key for a pathname (patterns like /cities/[city] match one segment). */
export function pageKeyFor(pathname: string): string | null {
  const path = (pathname.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  for (const p of SITE_PAGES) {
    if (!p.pattern && p.path === path) return p.key
  }
  for (const p of SITE_PAGES) {
    if (!p.pattern) continue
    const re = new RegExp(`^${p.path.replace(/\[[^\]]+\]/g, '[^/]+')}$`)
    if (re.test(path)) return p.key
  }
  return null
}

/** The seven host ICP pages share the 'host-template' content key for "all host pages". */
export const HOST_TEMPLATE_KEY = 'host-template'
export const HOST_ICP_KEYS = SITE_PAGES.filter((p) => p.template === 'host').map((p) => p.key)
