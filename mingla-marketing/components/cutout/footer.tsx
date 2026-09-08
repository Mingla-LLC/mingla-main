import Link from 'next/link'
import { CutoutSection } from './primitives'
import { DeviceCta, type CutoutSurface } from './device-cta'

// #2902 — Cutout footer. Dark band closing the page shell.
//
// It is also a real internal-linking surface: SPEC §5 needs every core entity
// page reachable from every page, or the 31-page pilot has no crawl graph.

// Only routes that exist. The first draft linked a future sitemap -- cities,
// blog, about, editorial standards and six ICP pages -- and nine of those
// fourteen links 404ed. Those pages are owned by the search/page-system work;
// when they land they get their entries back.
const COLUMNS = [
  {
    title: 'Explore',
    links: [{ href: '/', label: 'For Explorers' }],
  },
  {
    title: 'Host',
    links: [
      { href: '/host', label: 'For Hosts' },
      { href: '/tools', label: 'Free tools' },
    ],
  },
  {
    title: 'Company',
    links: [{ href: 'https://career.usemingla.com', label: 'Careers', external: true }],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
      { href: '/support', label: 'Support' },
    ],
  },
] as const

export function CutoutFooter({ surface }: { surface: CutoutSurface }) {
  return (
    <CutoutSection band="dark" as="div" aria-label="Footer" className="pb-10">
      <footer>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)] lg:gap-20">
          <div>
            <img
              src="/brand/mingla-wordmark.svg"
              alt="Mingla"
              width={132}
              height={34}
              className="h-8 w-auto select-none"
              draggable={false}
            />
            {/* The footer already knows which site it is on, so it should say
                the thing that site is about. The two-sided line described the
                company, not the reader: on Host it spent its first clause on
                explorers. */}
            <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
              {surface === 'host'
                ? 'One app to run your place — your site, your events, trips and stays, your orders, and the marketing that fills them.'
                : 'Mingla helps you decide what to actually do — and get you there.'}
            </p>
            <div className="mt-7">
              <DeviceCta surface={surface} location="footer" variant="primary" size="md" className="min-h-11" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-[var(--cut-muted)]">
                  {col.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {'external' in l && l.external ? (
                        <a
                          href={l.href}
                          className="inline-flex min-h-11 min-w-11 items-center text-[0.9375rem] text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="inline-flex min-h-11 min-w-11 items-center text-[0.9375rem] text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mt-14 flex flex-col gap-3 border-t pt-7 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--cut-hairline)' }}
        >
          <p className="text-[0.8125rem] text-[var(--cut-muted)]">
            © {new Date().getFullYear()} Mingla. Live in Lagos, London and US cities.
          </p>
          <Link
            href={surface === 'host' ? '/' : '/host'}
            className="inline-flex min-h-11 min-w-11 items-center text-[0.8125rem] font-semibold text-[var(--cut-accent)] underline-offset-2 hover:underline focus-ring"
          >
            {surface === 'host'
              ? 'Looking for the app? → Mingla for Explorers'
              : 'Run a venue, event or experience? → Mingla Host'}
          </Link>
        </div>
      </footer>
    </CutoutSection>
  )
}
