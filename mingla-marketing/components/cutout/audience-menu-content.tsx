'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, House, Info, MapPinned, Store, Wrench } from 'lucide-react'
import { DeviceCta, type CutoutSurface } from './device-cta'

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
  if (pathname === '/' || pathname === '/explorer' || pathname.startsWith('/explorer/') || EXPLORER_PAGE_SYSTEM_PATHS.has(pathname)) return 'explorer'
  if (HOST_PATHS.has(pathname) || pathname.startsWith('/host/')) return 'host'
  return null
}

function destinationIsCurrent(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
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
  const audienceDestinations = [
    { href: '/explorer', label: 'Explorer', surface: 'explorer' as const, Icon: Compass },
    { href: '/host', label: 'Host', surface: 'host' as const, Icon: Store },
  ]
  const supportingDestinations = [
    { href: '/', label: 'Home', Icon: House },
    { href: '/cities', label: 'Cities', Icon: MapPinned },
    { href: '/about', label: 'About', Icon: Info },
    { href: '/tools', label: 'Free tools', Icon: Wrench },
  ]
  const supportingDestinationIsCurrent = supportingDestinations.some(({ href }) => destinationIsCurrent(pathname, href))
  const activeSurface = supportingDestinationIsCurrent ? null : surfaceForPath(pathname) ?? surface
  const menuButtonClass = 'cut-btn flex min-h-14 w-full justify-start gap-3.5 rounded-2xl px-5 font-display text-base focus-ring'

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
                  ? `${menuButtonClass} cut-btn-brand text-white`
                  : `${menuButtonClass} cut-btn-light text-[var(--cut-ink)]`
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
        <div className="my-2 border-t" style={{ borderColor: 'var(--cut-hairline)' }} />
        {supportingDestinations.map(({ href, label, Icon }) => {
          const active = destinationIsCurrent(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              onClick={onDismiss}
              className={active
                ? `${menuButtonClass} cut-btn-brand text-white`
                : `${menuButtonClass} cut-btn-light text-[var(--cut-ink)]`
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
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
