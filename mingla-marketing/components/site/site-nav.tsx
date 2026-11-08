'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { ICP_LANDINGS, ICP_SLUGS, icpLandingPath } from '@/content/host-landing/icps'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { Wordmark } from './wordmark'

// #4339 — the site nav on every redesigned page: a floating white pill.
//
//   wordmark · Going out · Cities · For hosts · Free tools · Help · CTA · menu
//
// The CTA is the Explorer hand-off ("Use Mingla") on Explorer pages and the
// Host hand-off ("Use Mingla Web") on Host pages (#4339 §3). The ink menu
// button animates its two bars into an X (300ms, cubic-bezier(.77,0,.175,1))
// and opens the grouped menu: Explore, Host (Mingla Host, all seven landing
// pages, Free tools) and Company. The pill is opaque white with an ink ring and
// shadow, so it reads the same over paper, ink and video sections.
//
// The menu closes on Escape (focus returns to the menu button), on a click
// outside, and when a link in it is followed.

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
}

export function SiteNav({ surface, current }: SiteNavProps) {
  const [open, setOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) burgerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    const onPointer = (event: PointerEvent) => {
      const nav = navRef.current
      if (nav && event.target instanceof Node && !nav.contains(event.target)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close])

  return (
    <header ref={navRef} className={open ? 'site-nav open' : 'site-nav'} data-site-nav="" data-surface={surface}>
      <div className="nav-in">
        <Link className="brand" href="/" aria-label="Mingla home">
          <Wordmark height={24} title={null} />
        </Link>
        <nav className="nav-links" aria-label="Main">
          {TOP_LINKS.map((l) => (
            <Link key={l.key} href={l.href} className={current === l.key ? 'on' : undefined} aria-current={current === l.key ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        {surface === 'host' ? (
          <HostHandoffButton location="nav" className="btn cta nav-cta" />
        ) : (
          <ExplorerHandoffButton location="nav" className="btn cta nav-cta" />
        )}
        <button
          ref={burgerRef}
          type="button"
          className="burger"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
        <div
          id={menuId}
          className="drop"
          inert={!open}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setOpen(false)
          }}
        >
          {MENU_GROUPS.map((group) => (
            <div key={group.title}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map((l) => (
                  <li key={l.href}>
                    {l.external ? <a href={l.href}>{l.label}</a> : <Link href={l.href}>{l.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Link className="feat-card" href="/host">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marketing/site/p/lagos-quests-gallery.jpg" alt="" decoding="async" />
            <span>
              Run a place <em>with soul?</em>
            </span>
          </Link>
        </div>
      </div>
    </header>
  )
}
