import Link from 'next/link'
import { Wordmark } from '@/components/site/wordmark'
import type { Surface } from '@/lib/subdomain'
import './site-footer.css'

// #4339 §9 — THE canonical marketing footer. Every page renders this one:
// the redesigned pages call <SiteFooter> directly, the older Cutout pages get
// it through <CutoutFooter> (components/cutout/footer.tsx), and the /tools and
// /schedule layouts through <Footer>. One set of columns, one tagline.
//
//   Explore  Home, Going out, Cities, Blog
//   Host     For Hosts, Free tools, Help centre, Support
//   Company  About, Careers (the careers subdomain, ORCH-1225), Locals, Creators
//   Legal    Privacy, Terms, Organiser Terms, Delete account
//
// Four columns of four links each (Seth, 8 Nov), so the phone 2×2 grid is
// symmetrical: equal column widths, headings on one baseline per row, one link
// rhythm. Support moved from Legal to Host (it's help).
//
// Bottom line: "© <year> Mingla. Making real life easier to find." plus the
// cross-link to the other side of Mingla. There is NO "Privacy choices" text
// or link here: the #4318 bottom strip (consent-banner.tsx, mounted by the
// root layout) is the only privacy control on the page (#4339 §10).
//
// Every internal href is a real route (I-PROPOSED-1223-FOOTER-LINKS-RESOLVE)
// and Privacy + Terms stay visible (I-PROPOSED-1223-FOOTER-MOUNTED).

export type SiteFooterSurface = 'explorer' | 'host'

interface FooterLink {
  href: string
  label: string
  external?: boolean
}

interface FooterColumn {
  title: string
  links: FooterLink[]
}

export const SITE_FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Explore',
    links: [
      { href: '/', label: 'Home' },
      { href: '/going-out', label: 'Going out' },
      { href: '/cities', label: 'Cities' },
      { href: '/blog', label: 'Blog' },
    ],
  },
  {
    title: 'Host',
    links: [
      { href: '/host', label: 'For Hosts' },
      { href: '/tools', label: 'Free tools' },
      { href: '/help', label: 'Help centre' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: 'https://career.usemingla.com', label: 'Careers', external: true },
      { href: '/locals', label: 'Locals' },
      { href: '/creators', label: 'Creators' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
      { href: '/organiser-terms', label: 'Organiser Terms' },
      { href: '/delete-account', label: 'Delete account' },
    ],
  },
]

export const SITE_FOOTER_TAGLINE = 'Making real life easier to find.'

const CROSS_LINK: Record<SiteFooterSurface, FooterLink> = {
  explorer: { href: '/host', label: 'Run a venue, event or experience? → Mingla Host' },
  host: { href: '/', label: 'Looking for the app? → Mingla for Explorers' },
}

/**
 * `origin` is set on a page served from another host (career.usemingla.com),
 * where a relative link would resolve inside the careers segment (ORCH-1225):
 * every internal link then becomes absolute on that origin.
 */
export function SiteFooter({ surface, origin }: { surface: SiteFooterSurface; origin?: string }) {
  const cross = CROSS_LINK[surface]
  const abs = (href: string) => (origin && href.startsWith('/') ? `${origin}${href}` : href)
  return (
    <footer data-site-footer="" data-surface={surface} aria-label="Footer">
      <div className="sf-wrap">
        <div className="sf-top">
          <div>
            <Link className="sf-brand" href={abs('/')} aria-label="Mingla home">
              <Wordmark height={26} title={null} />
            </Link>
          </div>
          {SITE_FOOTER_COLUMNS.map((col) => (
            <div className="sf-col" key={col.title}>
              <h2>{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    {/* ORCH-1225: the careers subdomain is a real anchor, same tab. */}
                    {l.external ? <a href={l.href}>{l.label}</a> : <Link href={abs(l.href)}>{l.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="sf-bot">
          <p>
            © {new Date().getFullYear()} Mingla. {SITE_FOOTER_TAGLINE}
          </p>
          <Link className="sf-cross" href={abs(cross.href)}>
            {cross.label}
          </Link>
        </div>
      </div>
    </footer>
  )
}

/** The /tools and /schedule layouts' footer: the canonical one, by surface. */
export function Footer({ surface }: { surface: Surface }) {
  return <SiteFooter surface={surface === 'organiser' ? 'host' : 'explorer'} />
}
