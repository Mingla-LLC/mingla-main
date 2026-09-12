'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Store } from 'lucide-react'
import { DeviceCta, type CutoutSurface } from './device-cta'
import { allCoreTrustPagesSearchReady } from '@/content/core-pages'
import { allCityHubsSearchReady } from '@/content/cities/registry'

const EXPLORER_PAGE_SYSTEM_PATHS = new Set([
  '/internal/page-system/city-lagos',
  '/internal/page-system/explorer-event-guide',
])

const HOST_PATHS = new Set([
  '/host',
  '/internal/charts',
  '/internal/page-system/host-event-promoter-guide',
])

function surfaceForPath(pathname: string): CutoutSurface | null {
  if (pathname === '/' || EXPLORER_PAGE_SYSTEM_PATHS.has(pathname)) return 'explorer'
  if (HOST_PATHS.has(pathname) || pathname.startsWith('/host/')) return 'host'
  return null
}

export function AudienceMenuContent({
  surface,
  onDismiss,
  onChildDialogOpenChange,
}: {
  readonly surface: CutoutSurface
  readonly onDismiss: () => void
  readonly onChildDialogOpenChange: (open: boolean) => void
}) {
  const pathname = usePathname()
  const activeSurface = surfaceForPath(pathname) ?? surface
  const coreReady = allCoreTrustPagesSearchReady()
  const explorerFallback = { href: '/', label: 'Explorer', surface: 'explorer' as const, Icon: Compass }
  const audienceDestinations = [
    coreReady
      ? { href: '/explorer', label: 'Explorer', surface: 'explorer' as const, Icon: Compass }
      : explorerFallback,
    { href: '/host', label: 'Host', surface: 'host' as const, Icon: Store },
  ]
  const supportingDestinations = [
    { href: '/', label: 'Home' },
    ...(allCityHubsSearchReady() && coreReady ? [{ href: '/cities', label: 'Cities' }] : []),
    ...(coreReady ? [{ href: '/about', label: 'About' }] : []),
    { href: '/tools', label: 'Free tools' },
  ]

  return (
    <>
      <nav aria-label="Primary" className="flex flex-col gap-1.5">
        {audienceDestinations.map(({ href, label, surface: destinationSurface, Icon }) => {
          const active = activeSurface === destinationSurface
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              onClick={onDismiss}
              className={
                active
                  ? 'cut-btn cut-btn-brand flex min-h-14 items-center gap-3.5 rounded-2xl px-5 font-display text-base text-white focus-ring'
                  : 'flex min-h-14 items-center gap-3.5 rounded-2xl px-5 font-display text-base text-[var(--cut-ink)] transition-colors hover:bg-[var(--cut-card-sunken)] focus-ring'
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
        <div className="my-2 border-t" style={{ borderColor: 'var(--cut-hairline)' }} />
        {supportingDestinations.map(({ href, label }) => (
          <Link key={href} href={href} onClick={onDismiss} className="flex min-h-11 items-center rounded-2xl px-5 text-sm font-bold text-[var(--cut-body)] transition-colors hover:bg-[var(--cut-card-sunken)] hover:text-[var(--cut-ink)] focus-ring">{label}</Link>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5 pt-6">
        <DeviceCta
          surface="explorer"
          location="side_menu_explorer"
          label="Explore Your City"
          variant="primary"
          size="lg"
          className="w-full justify-center !text-[var(--cut-ink)]"
          onExternalActivate={onDismiss}
          onDialogOpenChange={onChildDialogOpenChange}
        />
        <DeviceCta
          surface="host"
          location="side_menu_host"
          label="Host Your City"
          variant="ink"
          size="lg"
          className="w-full justify-center"
          onExternalActivate={onDismiss}
        />
      </div>
    </>
  )
}
