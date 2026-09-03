'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Store } from 'lucide-react'
import { DeviceCta, type CutoutSurface } from './device-cta'

const AUDIENCE_DESTINATIONS = [
  { href: '/', label: 'Explorer', surface: 'explorer', Icon: Compass },
  { href: '/host', label: 'Host', surface: 'host', Icon: Store },
] as const

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

  return (
    <>
      <nav aria-label="Primary" className="flex flex-col gap-1.5">
        {AUDIENCE_DESTINATIONS.map(({ href, label, surface: destinationSurface, Icon }) => {
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
      </nav>

      <div className="mt-auto flex flex-col gap-2.5 pt-6">
        <DeviceCta
          surface="explorer"
          location="side_menu_explorer"
          label="Explore Your City"
          variant="primary"
          size="lg"
          className="w-full justify-center !text-[#14120f]"
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
