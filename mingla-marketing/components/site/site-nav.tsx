import Link from 'next/link'
import { ICP_LANDINGS, ICP_SLUGS, icpLandingPath } from '@/content/host-landing/icps'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { Wordmark } from './wordmark'
import { SiteNavMenu } from './site-nav-menu'

// #4339 — the site nav on every redesigned page: a floating white pill.
//
//   wordmark · Going out · Cities · For hosts · Free tools · Help · CTA · menu
//
// The CTA is the Explorer hand-off ("Use Mingla") on Explorer pages and the
// Host hand-off ("Use Mingla Host") on Host pages (#4339 §3). The ink menu
// button animates its two bars into an X (300ms, cubic-bezier(.77,0,.175,1))
// and opens the grouped menu: Explore, Host (Mingla Host, all seven landing
// pages, Free tools) and Company. The pill is opaque white with an ink ring and
// shadow, so it reads the same over paper, ink and video sections.
//
// The menu closes on Escape (focus returns to the menu button), on a click
// outside, and when a link in it is followed (site-nav-menu.tsx).
//
// #4339 speed fix: this is a server component. The links, the menu groups (all
// seven landing pages, read from content/host-landing/icps.ts) and the
// wordmark render here, so none of that ships as JavaScript; the small client
// island site-nav-menu.tsx owns only the open state.

export type SiteNavSurface = 'explorer' | 'host'

/** The five top links; `key` marks the current section. */
const TOP_LINKS = [
  { key: 'going-out', href: '/going-out', label: 'Going out' },
  { key: 'cities', href: '/cities', label: 'Cities' },
  { key: 'host', href: '/host', label: 'For hosts' },
  { key: 'tools', href: '/tools', label: 'Free tools' },
  { key: 'help', href: '/help', label: 'Help' },
] as const

export type SiteNavKey = (typeof TOP_LINKS)[number]['key'] | 'home'

interface MenuLink {
  href: string
  label: string
  external?: boolean
}

const MENU_GROUPS: { title: string; links: MenuLink[] }[] = [
  {
    title: 'Explore',
    links: [
      { href: '/', label: 'Home' },
      { href: '/going-out', label: 'Going out' },
      { href: '/cities', label: 'Cities' },
      { href: '/download', label: 'Get the app' },
    ],
  },
  {
    title: 'Host',
    links: [
      { href: '/host', label: 'Mingla Host' },
      ...ICP_SLUGS.map((slug) => ({ href: icpLandingPath(slug), label: ICP_LANDINGS[slug].name })),
      { href: '/tools', label: 'Free tools' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/locals', label: 'Locals' },
      { href: '/creators', label: 'Creators' },
      { href: 'https://career.usemingla.com', label: 'Careers', external: true },
      { href: '/blog', label: 'Blog' },
      { href: '/help', label: 'Help centre' },
      { href: '/support', label: 'Support' },
      { href: '/schedule', label: 'Book a call' },
    ],
  },
]

interface SiteNavProps {
  surface: SiteNavSurface
  current?: SiteNavKey
  /**
   * Set on a page served from another host (career.usemingla.com): every
   * internal link becomes absolute on this origin, since a relative link there
   * would resolve inside the careers segment (ORCH-1225). The hand-off CTA is
   * left out there because its no-JavaScript fallback is a relative page.
   */
  origin?: string
}

export function SiteNav({ surface, current, origin }: SiteNavProps) {
  const abs = (href: string) => (origin && href.startsWith('/') ? `${origin}${href}` : href)
  return (
    <SiteNavMenu
      surface={surface}
      lead={
        <>
          <Link className="brand" href={abs('/')} aria-label="Mingla home">
            <Wordmark height={24} title={null} />
          </Link>
          <nav className="nav-links" aria-label="Main">
            {TOP_LINKS.map((l) => (
              <Link key={l.key} href={abs(l.href)} className={current === l.key ? 'on' : undefined} aria-current={current === l.key ? 'page' : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          {origin ? null : surface === 'host' ? (
            <HostHandoffButton location="nav" className="btn cta nav-cta" />
          ) : (
            <ExplorerHandoffButton location="nav" className="btn cta nav-cta" />
          )}
        </>
      }
    >
      {MENU_GROUPS.map((group) => (
        <div key={group.title}>
          {/* #4339 round B: a menu label, not a page heading. */}
          <p className="drop-label">{group.title}</p>
          <ul>
            {group.links.map((l) => (
              <li key={l.href}>
                {l.external ? <a href={l.href}>{l.label}</a> : <Link href={abs(l.href)}>{l.label}</Link>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Link className="feat-card" href={abs('/host')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/site/p/lagos-quests-gallery.jpg" alt="" loading="lazy" decoding="async" width={900} height={599} />
        <span>
          Run a place <em>with soul?</em>
        </span>
      </Link>
    </SiteNavMenu>
  )
}
