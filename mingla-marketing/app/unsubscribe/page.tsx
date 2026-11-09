import Link from 'next/link'
import { Suspense } from 'react'
import { UnsubscribeForm } from './UnsubscribeForm'
import { PageHero, SitePage } from '@/components/site/site-page'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — restyled in the approved design. The opt-out flow is
// unchanged: the same UnsubscribeForm (email or phone, marketing-only or all,
// submitted through lib/unsubscribe-submit.ts, no login), now drawn in the
// brand's light form style, plus the SMS Terms, Privacy and Terms links.

export const metadata = publicNoindexMetadata('/unsubscribe', {
  title: 'Unsubscribe',
  description:
    'Opt out of Mingla marketing messages by email or text. No login required — your request is honored immediately.',
})

export default function UnsubscribePage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <PageHero
          title={
            <>
              Your messages, <em>your call.</em>
            </>
          }
        />
        <section className="pb-100" aria-labelledby="unsubscribe-title">
          <div className="wrap">
            <article className="card pad account-card account-narrow">
              <h2 className="h3" id="unsubscribe-title">
                Unsubscribe
              </h2>
              <Suspense fallback={<p className="muted">Loading the opt-out form…</p>}>
                <UnsubscribeForm />
              </Suspense>
              <div className="legal-links">
                <Link className="btn soft sm" href="/sms-terms">
                  SMS Terms
                </Link>
                <Link className="btn soft sm" href="/privacy-policy">
                  Privacy Policy
                </Link>
                <Link className="btn soft sm" href="/terms-of-service">
                  Terms of Service
                </Link>
              </div>
            </article>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
