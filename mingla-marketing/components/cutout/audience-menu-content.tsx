'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Footprints, MapPinned, Newspaper, Store, Wrench } from 'lucide-react'
import { BLOG_MENU_ENTRY } from '@/lib/blog/menu-entry'
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

// #3371 — `/` is the Explorer home, so the Explorer item is the one lit there.
// `/going-out` is still an Explorer-surface page, but it has its own
// supporting item; a current supporting item always wins the highlight (see
// `activeSurface` below), so Explorer is never lit there.
function surfaceForPath(pathname: string): CutoutSurface | null {
  if (pathname === '/' || pathname === '/going-out' || EXPLORER_PAGE_SYSTEM_PATHS.has(pathname)) return 'explorer'
  if (HOST_PATHS.has(pathname) || pathname.startsWith('/host/')) return 'host'
  return null
}

function destinationIsCurrent(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
}

// #4137 wave 2 — the menu is grouped EXPLORE / HOST / COMPANY. The Blog row and
// the Latest story card hang off ONE seam (lib/blog/menu-entry.ts) whose shipped
// value is hidden: they appear only once the blog has a published post, so the
// menu never links to an empty page (rule 9). Wave 3 owns that value.
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
  const { blogVisible, showNewBadge, latest } = BLOG_MENU_ENTRY
  const exploreDestinations = [
    { href: '/', label: 'Explorer', surface: 'explorer' as const, Icon: Compass },
    { href: '/cities', label: 'Cities', Icon: MapPinned },
    { href: '/going-out', label: 'Going out', Icon: Footprints },
  ]
  const hostDestinations = [
    { href: '/host', label: 'Host', surface: 'host' as const, Icon: Store },
    { href: '/tools', label: 'Free tools', Icon: Wrench },
  ]
  const companyDestinations = [
    { href: '/about', label: 'About' },
    { href: '/help', label: 'Help' },
    { href: '/support', label: 'Support' },
    { href: 'https://career.usemingla.com', label: 'Careers', external: true as const },
  ]
  const linked = [
    ...exploreDestinations.slice(1),
    ...hostDestinations.slice(1),
    ...companyDestinations.filter((destination) => !('external' in destination)),
    ...(blogVisible ? [{ href: '/blog' }] : []),
  ]
  const supportingDestinationIsCurrent = linked.some(({ href }) => destinationIsCurrent(pathname, href))
  const activeSurface = supportingDestinationIsCurrent ? null : surfaceForPath(pathname) ?? surface
  // `cut-menu-item` is what actually left-aligns these rows: `.cut-btn` in
  // cutout.css centres its content and, being unlayered CSS, beats the
  // `justify-start` utility. See the #3371 rule beside `.cut-btn`.
  const menuButtonClass = 'cut-btn flex min-h-12 w-full justify-start cut-menu-item gap-3.5 rounded-2xl px-5 font-display text-base focus-ring'
  const rowClass = (active: boolean) => active
    ? `${menuButtonClass} cut-btn-brand text-white`
    : `${menuButtonClass} cut-btn-light text-[var(--cut-ink)]`
  const chipClass = (active: boolean) => active
    ? 'cut-btn cut-btn-brand text-white cut-menu-chip focus-ring'
    : 'cut-btn cut-btn-light text-[var(--cut-ink)] cut-menu-chip focus-ring'
  const rowIsActive = (destination: { readonly href: string; readonly surface?: CutoutSurface }) => destination.surface
    ? activeSurface === destination.surface
    : destinationIsCurrent(pathname, destination.href)

  return (
    <>
      <nav aria-label="Primary" className="flex flex-col">
        <div role="group" aria-labelledby="menu-group-explore" className="flex flex-col gap-1.5">
          <p className="cut-menu-group" id="menu-group-explore">Explore</p>
          {exploreDestinations.map((destination) => {
            const { href, label, Icon } = destination
            const active = rowIsActive(destination)
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={onDismiss} className={rowClass(active)}>
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
          {blogVisible ? (() => {
            const active = destinationIsCurrent(pathname, '/blog')
            return (
              <Link href="/blog" aria-current={active ? 'page' : undefined} onClick={onDismiss} className={rowClass(active)}>
                <Newspaper className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                Blog
                {showNewBadge ? <span className="cut-menu-new">New</span> : null}
              </Link>
            )
          })() : null}
        </div>

        <div role="group" aria-labelledby="menu-group-host" className="flex flex-col gap-1.5">
          <p className="cut-menu-group" id="menu-group-host">Host</p>
          {hostDestinations.map((destination) => {
            const { href, label, Icon } = destination
            const active = rowIsActive(destination)
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={onDismiss} className={rowClass(active)}>
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </div>

        <div role="group" aria-labelledby="menu-group-company" className="flex flex-col gap-1.5">
          <p className="cut-menu-group" id="menu-group-company">Company</p>
          <ul className="cut-menu-chips">
            {companyDestinations.map((destination) => {
              const { href, label } = destination
              if ('external' in destination) {
                return (
                  <li key={href}>
                    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onDismiss} className={chipClass(false)}>
                      {label}<span className="sr-only">, opens in a new tab</span>
                    </a>
                  </li>
                )
              }
              const active = destinationIsCurrent(pathname, href)
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? 'page' : undefined} onClick={onDismiss} className={chipClass(active)}>{label}</Link>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {blogVisible && latest ? (
        <Link href={latest.href} className="cut-card cut-menu-story focus-ring" onClick={onDismiss}>
          <img src={latest.coverSrc} alt="" width={latest.coverWidth} height={latest.coverHeight} loading="lazy" decoding="async" />
          <span><small>Latest story</small><strong>{latest.title}</strong></span>
        </Link>
      ) : null}

      <div className="cut-menu-ctas mt-auto flex flex-col gap-2.5 pt-6">
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
