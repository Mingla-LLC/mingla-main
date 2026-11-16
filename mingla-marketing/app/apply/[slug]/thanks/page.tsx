// #4452 §2.8 — the success page of a form page (a real address, noindex).
import type { Metadata } from 'next'
import { SitePage } from '@/components/site/site-page'
import { ThanksClient } from './thanks-client'
import '@/components/forms/forms.css'

export const metadata: Metadata = { title: "You're in | Mingla", robots: { index: false, follow: false } }

export default function ApplyThanksPage() {
  return (
    <SitePage surface="explorer">
      <section className="ap-sec" style={{ background: '#15171c', color: '#fff' }}>
        <div className="wrap ap-done">
          <ThanksClient />
        </div>
      </section>
    </SitePage>
  )
}
