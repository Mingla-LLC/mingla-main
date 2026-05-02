import Link from 'next/link'
import { ORGANISER_PATH, type Surface } from '@/lib/subdomain'

interface FooterProps {
  surface: Surface
}

interface FooterColumn {
  title: string
  links: Array<{ href: string; label: string }>
}

const explorerColumns: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/download', label: 'Download' },
    ],
  },
  {
    title: 'Cities',
    links: [{ href: '/cities', label: 'All cities' }],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
]

const organiserColumns: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/organisers/features', label: 'Features' },
      { href: '/organisers/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/organisers/case-studies', label: 'Case studies' },
      { href: '/organisers/help', label: 'Help' },
    ],
  },
  {
    title: 'Get started',
    links: [{ href: '/organisers/get-started', label: 'List your venue' }],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
]

export function Footer({ surface }: FooterProps) {
  const cols = surface === 'organiser' ? organiserColumns : explorerColumns
  const crossLink =
    surface === 'organiser'
      ? { href: '/', label: 'Looking for the consumer app? → Back to Mingla' }
      : { href: ORGANISER_PATH, label: 'Are you a venue or organiser? → Mingla Business' }

  return (
    <footer className="border-t border-divider bg-vellum px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="flex flex-col gap-3">
            <span className="font-display text-2xl font-semibold tracking-[-0.02em] text-text-primary">
              Mingla{surface === 'organiser' ? ' Business' : ''}
            </span>
            <p className="max-w-xs text-sm text-text-secondary">
              Find a vibe, not a venue. Mingla is the experience-discovery app for hangouts, dates, group outings, and slow Sundays.
            </p>
          </div>

          {cols.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                {col.title}
              </span>
              <ul className="flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="rounded-sm text-sm text-text-secondary transition-colors hover:text-text-primary focus-ring"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
