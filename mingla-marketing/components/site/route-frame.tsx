'use client'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { CutoutShell } from '@/components/cutout/primitives'

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

type FrameVariant = 'tools' | 'cutout'

interface RouteFrameProps {
  /** Exact paths that render bare. */
  bare: readonly string[]
  /** Path prefixes that render bare ("/blog/category/"). */
  barePrefixes?: readonly string[]
  variant: FrameVariant
  header: ReactNode
  footer: ReactNode
  children: ReactNode
}

export function isBarePath(pathname: string | null, bare: readonly string[], barePrefixes: readonly string[] = []): boolean {
  if (!pathname) return false
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return bare.includes(path) || barePrefixes.some((prefix) => path.startsWith(prefix))
}

export function RouteFrame({ bare, barePrefixes = [], variant, header, footer, children }: RouteFrameProps) {
  const pathname = usePathname()
  if (isBarePath(pathname, bare, barePrefixes)) return <>{children}</>
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
