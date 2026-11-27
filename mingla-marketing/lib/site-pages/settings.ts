// #4636 — the site-wide nav and footer as published content (page key
// 'site-settings', the same draft / publish / history flow as a page).
//
//   nav:    { top: [{label, to}] 1-6, menu: [{ title, links: [{label, to}] 1-12 }] 1-4 }
//   footer: { columns: [{ title, links: [{label, to}] 1-6 }] 1-4, tagline? }
//
// Either part may be absent: that part stays exactly as coded
// (components/site/site-nav.tsx, components/marketing/footer.tsx). The
// database applies the same rules (site_settings_errors in the #4636
// migration); this mirror lets the site refuse a bad payload it is handed
// directly (a preview draft) and fall back to the coded chrome.
//
// No imports: plain node tests load this file by stripping its types.

export interface SettingsLink {
  label: string
  to: string
}

export interface SettingsGroup {
  title: string
  links: SettingsLink[]
}

export interface NavSettings {
  top: SettingsLink[]
  menu: SettingsGroup[]
}

export interface FooterSettings {
  columns: SettingsGroup[]
  tagline?: string
}

export interface SiteSettings {
  nav?: NavSettings | null
  footer?: FooterSettings | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function plain(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[<>*]/.test(v)
}

/** An internal path, an https link or an email (no app hand-offs in the chrome). */
export function isChromeTarget(to: unknown): boolean {
  if (typeof to !== 'string' || to.length > 300) return false
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(to)) return !to.includes('..')
  if (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s<>"']*)?$/.test(to)) return true
  return /^mailto:[^\s<>"'@]+@[^\s<>"'@]+$/.test(to)
}

function linkErrors(v: unknown, at: string, max: number): string[] {
  if (!isRecord(v)) return [`${at}: must be { label, to }`]
  const e: string[] = []
  for (const k of Object.keys(v)) if (k !== 'label' && k !== 'to') e.push(`${at}.${k}: unknown`)
  if (!plain(v.label, max)) e.push(`${at}.label: plain words, at most ${max} characters`)
  if (!isChromeTarget(v.to)) e.push(`${at}.to: not an internal path, https link or email`)
  return e
}

function groupErrors(v: unknown, at: string, maxLinks: number): string[] {
  if (!isRecord(v) || !Array.isArray(v.links) || v.links.length < 1 || v.links.length > maxLinks) return [`${at}: needs a title and 1-${maxLinks} links`]
  const e: string[] = []
  for (const k of Object.keys(v)) if (k !== 'title' && k !== 'links') e.push(`${at}.${k}: unknown`)
  if (!plain(v.title, 24)) e.push(`${at}.title: plain words, at most 24 characters`)
  v.links.forEach((l, i) => e.push(...linkErrors(l, `${at}.links[${i}]`, 40)))
  return e
}

/** The problems with a settings payload ([] = valid). Never throws. */
export function settingsErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ['settings: must be an object']
  const e: string[] = []
  for (const k of Object.keys(raw)) if (k !== 'nav' && k !== 'footer') e.push(`settings.${k}: unknown`)
  const nav = raw.nav
  if (nav !== undefined && nav !== null) {
    if (!isRecord(nav) || !Array.isArray(nav.top) || nav.top.length < 1 || nav.top.length > 6 || !Array.isArray(nav.menu) || nav.menu.length < 1 || nav.menu.length > 4
      || Object.keys(nav).some((k) => k !== 'top' && k !== 'menu')) {
      e.push('nav: needs 1-6 top links and 1-4 menu groups')
    } else {
      nav.top.forEach((l, i) => e.push(...linkErrors(l, `nav.top[${i}]`, 24)))
      nav.menu.forEach((g, i) => e.push(...groupErrors(g, `nav.menu[${i}]`, 12)))
    }
  }
  const footer = raw.footer
  if (footer !== undefined && footer !== null) {
    if (!isRecord(footer) || !Array.isArray(footer.columns) || footer.columns.length < 1 || footer.columns.length > 4
      || Object.keys(footer).some((k) => k !== 'columns' && k !== 'tagline')) {
      e.push('footer: needs 1-4 columns')
    } else {
      footer.columns.forEach((g, i) => e.push(...groupErrors(g, `footer.columns[${i}]`, 6)))
      if (footer.tagline !== undefined && !plain(footer.tagline, 80)) e.push('footer.tagline: plain words, at most 80 characters')
    }
  }
  return e
}

/** The settings to draw, or nulls (coded nav / footer) for anything invalid or absent. */
export function usableSettings(raw: unknown, report: (message: string) => void = () => undefined): { nav: NavSettings | null; footer: FooterSettings | null } {
  if (raw === null || raw === undefined) return { nav: null, footer: null }
  if (!isRecord(raw)) {
    report('site-settings: not an object; the coded nav and footer stay')
    return { nav: null, footer: null }
  }
  const navOk = raw.nav !== undefined && raw.nav !== null && settingsErrors({ nav: raw.nav }).length === 0
  const footerOk = raw.footer !== undefined && raw.footer !== null && settingsErrors({ footer: raw.footer }).length === 0
  if (raw.nav && !navOk) report(`site-settings: nav refused (${settingsErrors({ nav: raw.nav }).join('; ')}); the coded nav stays`)
  if (raw.footer && !footerOk) report(`site-settings: footer refused (${settingsErrors({ footer: raw.footer }).join('; ')}); the coded footer stays`)
  return { nav: navOk ? (raw.nav as NavSettings) : null, footer: footerOk ? (raw.footer as FooterSettings) : null }
}

/** Whether a link leaves the site (rendered as a plain anchor, as the coded careers link is). */
export function isExternal(to: string): boolean {
  return !to.startsWith('/')
}

/** The nav key a link stands for, so the current page stays marked. */
export function navKeyForHref(to: string): string | null {
  const map: Record<string, string> = { '/going-out': 'going-out', '/cities': 'cities', '/host': 'host', '/tools': 'tools', '/help': 'help', '/': 'home' }
  return map[to] ?? null
}
