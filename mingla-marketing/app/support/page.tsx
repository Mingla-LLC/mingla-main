import Link from 'next/link'
import { ArrowRight, Mail } from 'lucide-react'
import { PageHero, SitePage } from '@/components/site/site-page'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Support, in the approved design, with the live copy: the
// email, "aims to respond within 1–2 business days", the quick links (Privacy
// Policy, Terms of Service, Organiser Terms, Delete your account) and the
// in-app deletion note. The SEO contract is unchanged (search_ready "/support").

export const metadata = searchRouteMetadata('/support')

const QUICK_LINKS = [
  { href: '/privacy-policy', label: 'Privacy Policy' },
  { href: '/terms-of-service', label: 'Terms of Service' },
  { href: '/organiser-terms', label: 'Organiser Terms' },
  { href: '/delete-account', label: 'Delete your account' },
] as const

export default function SupportPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <PageHero
          title={
            <>
              How can we <em>help?</em>
            </>
          }
          lead="The Mingla team reads every support message and aims to respond within 1–2 business days."
        >
          <p className="support-note">For help with your account, app access, or a problem you spotted, email:</p>
          <div className="row">
            <a className="btn ink" href="mailto:support@usemingla.com">
              <Mail aria-hidden="true" /> support@usemingla.com
            </a>
            <Link className="btn soft" href="/help">
              Help centre
            </Link>
          </div>
        </PageHero>
        <section className="pb-100" aria-labelledby="support-links">
          <div className="wrap">
            <h2 className="sr-only" id="support-links">
              Quick links
            </h2>
            <ul className="grid4">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link className="card pad quick reveal" href={link.href}>
                    <span>{link.label}</span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="filter-note">Account deletion is also available in the app from Settings → Delete Account.</p>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
