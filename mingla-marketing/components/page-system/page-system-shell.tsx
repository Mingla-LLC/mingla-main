import Link from 'next/link'
import { type ReactNode } from 'react'
import { CutoutShell } from '@/components/cutout'
import { PAGE_SYSTEM_PATHS, type PageSystemPath } from '@/content/page-system/shared'
import { PageSystemNav } from './page-system-nav'

const REVIEW_LABELS: Record<PageSystemPath, string> = {
  '/internal/page-system/city-lagos': 'Lagos city hub',
  '/internal/page-system/explorer-event-guide': 'Explorer event guide',
  '/internal/page-system/host-event-promoter-guide': 'Host promoter guide',
}

export function PageSystemShell({
  children,
  currentPath,
  futurePath,
  audience,
}: {
  readonly children: ReactNode
  readonly currentPath: PageSystemPath
  readonly futurePath: string
  readonly audience: 'city' | 'explorer' | 'host'
}) {
  return (
    <CutoutShell>
      <div className="page-system-root" data-page-system data-audience={audience}>
        <PageSystemNav />
        <main id="main" className="page-system-printable">
          {children}
        </main>
        <footer className="ps-footer" data-print-hide>
          <div>
            <img src="/brand/mingla-wordmark.svg" alt="Mingla" width="116" height="41" />
            <p>Find the plan. Publish what people can join.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/">Explorer</Link>
            <Link href="/host">Mingla Host</Link>
            <Link href="/support">Support</Link>
            <Link href="/privacy-policy">Privacy</Link>
            <Link href="/terms-of-service">Terms</Link>
          </nav>
        </footer>
        <aside className="ps-review-dock" aria-label="Private page-system review" data-private-review-dock data-print-hide>
          <div className="ps-review-state">
            <strong>#2990 private review · noindex</strong>
            <span>Future route: {futurePath}</span>
          </div>
          <nav aria-label="Review fixtures">
            {PAGE_SYSTEM_PATHS.map((path) => (
              <Link key={path} href={path} aria-current={path === currentPath ? 'page' : undefined}>
                {REVIEW_LABELS[path]}
              </Link>
            ))}
          </nav>
        </aside>
      </div>
    </CutoutShell>
  )
}
