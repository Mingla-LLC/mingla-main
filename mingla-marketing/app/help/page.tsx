import Link from 'next/link'
import { Mail } from 'lucide-react'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { BreadcrumbSchema } from '@/components/cutout'
import { HelpBrowser } from '@/components/help/help-browser'
import { PageHero, SitePage } from '@/components/site/site-page'
import { HELP_VIDEOS } from '@/content/help/registry'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// The help centre. Every feature of the platform, shown rather than described.
//
// Discovery here is by intent, not by chapter number: people arrive knowing the
// job they are stuck on ("get paid", "run the door"), not which episode covers
// it. Chapters are the resting state; the chips and the search are the way in.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav, the headline,
// the search and chips, the video cards, and "Still stuck?" with
// support@usemingla.com and Book a call (→ /schedule), the same as the live
// /support page. There is no "Send to support" form (§7). The registry and the
// player pages are unchanged. app/help/layout.tsx keeps the <main id="main">
// that carries the #3431 copy opt-in, so the shell adds no second <main>.

export const metadata = searchRouteMetadata('/help')

export default function HelpCentrePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="host" current="help" layoutMain>
        <BreadcrumbSchema
          crumbs={[
            { name: 'Mingla', path: '/' },
            { name: 'Help centre', path: '/help' },
          ]}
        />
        <PageHero
          title={
            <>
              How can we <em>help?</em>
            </>
          }
          lead="Short videos for every step, from your first event to your first payout, on the web, on iPhone and on Android."
        />
        <section className="pb-100" aria-label="Help centre">
          <div className="wrap">
            <HelpBrowser videos={HELP_VIDEOS} />
          </div>
        </section>
        <section className="pb-100" aria-labelledby="help-stuck">
          <div className="wrap">
            <div className="card pad stuck reveal">
              <div>
                <h2 className="h2" id="help-stuck">
                  Still <em>stuck?</em>
                </h2>
                <p className="lead">The team reads every message and aims to respond within 1–2 business days.</p>
              </div>
              <div className="row">
                <a className="btn ink" href="mailto:support@usemingla.com">
                  <Mail aria-hidden="true" /> support@usemingla.com
                </a>
                <Link className="btn soft" href="/schedule">
                  Book a call
                </Link>
              </div>
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
