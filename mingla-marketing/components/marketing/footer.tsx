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
//   Host     For Hosts, Free tools, Help centre
//   Company  About, Careers (the careers subdomain, ORCH-1225)
//   Legal    Privacy, Terms, Organiser Terms, Support
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
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: 'https://career.usemingla.com', label: 'Careers', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
      { href: '/organiser-terms', label: 'Organiser Terms' },
      { href: '/support', label: 'Support' },
    ],
  },
]

export const SITE_FOOTER_TAGLINE = 'Making real life easier to find.'

const CROSS_LINK: Record<SiteFooterSurface, FooterLink> = {
  explorer: { href: '/host', label: 'Run a venue, event or experience? → Mingla Host' },
  host: { href: '/', label: 'Looking for the app? → Mingla for Explorers' },
}

export function SiteFooter({ surface }: { surface: SiteFooterSurface }) {
  const cross = CROSS_LINK[surface]
  return (
    <footer data-site-footer="" data-surface={surface} aria-label="Footer">
      <div className="sf-wrap">
        <div className="sf-top">
          <div>
            <Link className="sf-brand" href="/" aria-label="Mingla home">
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
                    {l.external ? <a href={l.href}>{l.label}</a> : <Link href={l.href}>{l.label}</Link>}
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
          <Link className="sf-cross" href={cross.href}>
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
