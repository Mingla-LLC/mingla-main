import type { ReactNode } from 'react'
import { SiteFooter, type SiteFooterSurface } from '@/components/marketing/footer'
import { LandingRoot } from '@/components/landing/landing-root'
import { SiteNav, type SiteNavKey } from './site-nav'
import '@/components/landing/landing.css'
import './site.css'
import './pages.css'

// #4339 phase 2b — the shell every redesigned inner page shares: the brand
// root (reveal-on-scroll, route-scoped faces applied by the page), the
// floating pill nav, ONE <main id="main"> (the skip-link target and what
// scripts/verify-search-foundation.mjs measures) and the canonical footer.
//
// The page applies the three brand-face variables from app/site-fonts.ts on
// its own wrapper (the #3548 per-route font gate reads the page module).

interface SitePageProps {
  surface: SiteFooterSurface
  current?: SiteNavKey
  /** For a page served from another host (careers): absolute internal links. */
  origin?: string
  /**
   * The route's layout already renders <main id="main"> (Help: its layout
   * carries the #3431 copy opt-in on that element), so the shell adds none.
   */
  layoutMain?: boolean
  children: ReactNode
}

export function SitePage({ surface, current, origin, layoutMain = false, children }: SitePageProps) {
  return (
    <LandingRoot>
      <SiteNav surface={surface} current={current} origin={origin} />
      {layoutMain ? children : <main id="main">{children}</main>}
      <SiteFooter surface={surface} origin={origin} />
    </LandingRoot>
  )
}

interface PageHeroProps {
  /** The h1, with its italic half as <em>. */
  title: ReactNode
  lead?: ReactNode
  /** Buttons, a search box or a filter row under the lead. */
  children?: ReactNode
}

/** The design's `head()`: a large serif headline and a lead, no eyebrow pill. */
export function PageHero({ title, lead, children }: PageHeroProps) {
  return (
    <section className="page-hero">
      <div className="wrap">
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  )
}
