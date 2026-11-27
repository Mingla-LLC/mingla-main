import type { ReactNode } from 'react'
import { SiteFooter, type SiteFooterSurface } from '@/components/marketing/footer'
import { LandingRoot } from '@/components/landing/landing-root'
import { SiteNav } from './site-nav'
import '@/components/landing/landing.css'
import './site.css'
import './pages.css'

// #4636 — the SitePage shell with the CODED nav and footer, for client modules
// (an error boundary cannot await the published site settings). Server pages
// use components/site/site-page.tsx, whose chrome carries the settings.
export function SiteShell({ surface, children }: { surface: SiteFooterSurface; children: ReactNode }) {
  return (
    <LandingRoot>
      <SiteNav surface={surface} />
      <main id="main">{children}</main>
      <SiteFooter surface={surface} />
    </LandingRoot>
  )
}
