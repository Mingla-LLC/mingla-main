'use client'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { CutoutShell } from '@/components/cutout/primitives'
import { SiteFooter } from '@/components/marketing/footer'
import { LandingRoot } from '@/components/landing/landing-root'
import { SiteNav } from './site-nav'
import '@/components/landing/landing.css'
import './site.css'
import './pages.css'

// #4339 phase 2b — a layout that wraps both a redesigned index page and pages
// that keep their old look (the /tools hub and the tool pages; the /blog index
// and the blog posts). The redesigned page brings its own nav, <main> and
// footer (components/site/site-page.tsx), so on those paths the layout's old
// frame is left out and the page renders bare. Every other path keeps exactly
// the frame it had before (the same elements and classes, moved here from the
// layout).
//
// The layout hands in its header and footer already rendered, so nothing
// renders twice.

type FrameVariant = 'tools' | 'cutout' | 'site-tools'

interface RouteFrameProps {
  /** Exact paths that render bare. */
  bare: readonly string[]
  /** Path prefixes that render bare ("/blog/"). */
  barePrefixes?: readonly string[]
  /** Path prefixes that always keep the old frame, even under a bare prefix ("/blog/preview/"). */
  framedPrefixes?: readonly string[]
  variant: FrameVariant
  header: ReactNode
  footer: ReactNode
  children: ReactNode
}

export function isBarePath(
  pathname: string | null,
  bare: readonly string[],
  barePrefixes: readonly string[] = [],
  framedPrefixes: readonly string[] = [],
): boolean {
  if (!pathname) return false
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (framedPrefixes.some((prefix) => path.startsWith(prefix))) return false
  return bare.includes(path) || barePrefixes.some((prefix) => path.startsWith(prefix))
}

export function RouteFrame({ bare, barePrefixes = [], framedPrefixes = [], variant, header, footer, children }: RouteFrameProps) {
  const pathname = usePathname()
  if (isBarePath(pathname, bare, barePrefixes, framedPrefixes)) return <>{children}</>
  if (variant === 'site-tools') {
    // #4339 phase 2c — the four free tools and their report pages on the new
    // frame: the site nav (Host surface, Free tools current), the canonical
    // footer and the brand type. The tools themselves are unchanged and keep
    // their dark stage (.tools-stage, components/site/pages.css), whose type
    // tokens are pointed at the brand faces. The stage sits OUTSIDE the brand
    // root on purpose: the root's element resets (button, a, input) are
    // unlayered CSS and would override the tools' own Tailwind styles.
    return (
      <>
        <LandingRoot>
          <SiteNav surface="host" current="tools" />
        </LandingRoot>
        <main id="main" className="tools-stage bg-smoke text-text-primary" data-tools-stage="">
          {header}
          {children}
        </main>
        <LandingRoot>
          <SiteFooter surface="host" />
        </LandingRoot>
      </>
    )
  }
  if (variant === 'tools') {
    return (
      <div className="flex min-h-screen flex-col bg-smoke text-text-primary">
        {header}
        <main id="main" className="flex-1">
          {children}
        </main>
        <div data-theme="light">{footer}</div>
      </div>
    )
  }
  return (
    <CutoutShell>
      {header}
      <main id="main">{children}</main>
      {footer}
    </CutoutShell>
  )
}
