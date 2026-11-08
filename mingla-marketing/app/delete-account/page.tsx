import { Mail } from 'lucide-react'
import { PageHero, SitePage } from '@/components/site/site-page'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — restyled in the approved design ("Your account, your
// call."). The flow is unchanged: deletion happens in the app (Settings →
// Delete Account) and exceptional requests go to privacy@usemingla.com. The
// words of the instructions are the live page's.

export const metadata = publicNoindexMetadata('/delete-account', {
  title: 'Delete your account',
  description:
    'Instructions for deleting your Mingla account and contacting support for exceptional requests.',
})

export default function DeleteAccountPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <PageHero
          title={
            <>
              Your account, <em>your call.</em>
            </>
          }
        />
        <section className="pb-100" aria-labelledby="delete-title">
          <div className="wrap">
            <article className="card pad account-card account-narrow">
              <h2 className="h3" id="delete-title">
                Instructions to delete your account
              </h2>
              <p>To delete your Mingla account: Open the app → Settings → Delete Account.</p>
              <p className="muted">
                This permanently removes your profile, preferences, saved experiences, and all personal data. Messages
                you sent are anonymized. Phone hashes are retained to prevent trial abuse.
              </p>
              <div className="account-box">
                <p>For questions and concerns, and exceptional requests, email:</p>
                <a className="btn ink" href="mailto:privacy@usemingla.com">
                  <Mail aria-hidden="true" /> privacy@usemingla.com
                </a>
              </div>
            </article>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
