import Link from 'next/link'
import { BUSINESS_PATH, type Surface } from '@/lib/subdomain'

interface FooterProps {
  surface: Surface
}

interface FooterColumn {
  title: string
  links: Array<{ href: string; label: string; external?: boolean }>
}

const explorerColumns: FooterColumn[] = [
  {
    title: 'Company',
    links: [
      { href: '/support', label: 'Support' },
      // #1003 — the free growth tools hub (Venue Website Grader et al.).
      { href: '/tools', label: 'Free tools' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
    ],
  },
]

const organiserColumns: FooterColumn[] = [
  {
    title: 'Company',
    // ORCH-1225 — Careers points at the careers subdomain. ABSOLUTE external
    // URL: a relative `/careers` 404s on the apex (the marketing middleware
    // host-rewrites `career.usemingla.com` only). Business footer ONLY.
    links: [
      { href: 'https://career.usemingla.com', label: 'Careers', external: true },
      // #1003 — the free growth tools hub (Venue Website Grader et al.).
      { href: '/tools', label: 'Free tools' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
    ],
  },
]

export function Footer({ surface }: FooterProps) {
  const cols = surface === 'organiser' ? organiserColumns : explorerColumns
  const crossLink =
    surface === 'organiser'
      ? { href: '/', label: 'Looking for the consumer app? → Back to Mingla' }
      : { href: BUSINESS_PATH, label: 'Are you a venue or organiser? → Mingla Host' }

  return (
    <footer className="border-t border-divider bg-vellum px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between md:gap-16">
          <div className="flex max-w-md flex-col gap-3">
            <span className="font-display text-2xl font-semibold tracking-[-0.02em] text-text-primary">
              Mingla{surface === 'organiser' ? ' Business' : ''}
            </span>
            <p className="max-w-xs text-sm text-text-secondary">
              Find a vibe, not a venue. Mingla is the experience-discovery app for hangouts, dates, group outings, and slow Sundays.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-10 md:justify-end">
            {cols.map((col) => (
              <div key={col.title} className="flex min-w-[7rem] flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  {col.title}
                </span>
                <ul className="flex flex-col gap-2">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {/* ORCH-1225 — external absolute URLs (careers subdomain)
                          render as a real anchor, same tab; internal routes
                          stay Next.js <Link>. */}
                      {l.external ? (
                        <a
                          href={l.href}
                          className="rounded-sm text-sm text-text-secondary transition-colors hover:text-text-primary focus-ring"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="rounded-sm text-sm text-text-secondary transition-colors hover:text-text-primary focus-ring"
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

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-divider-strong pt-8 md:flex-row md:items-center">
          <Link
            href={crossLink.href}
            className="rounded-sm text-sm font-medium text-warm transition-colors hover:brightness-110 focus-ring"
          >
            {crossLink.label}
          </Link>
          <span className="text-xs text-text-muted">
            © {new Date().getFullYear()} Mingla. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  )
}
