// #4452 §2.8 — the booked page of a form page (a real address, noindex).
import type { Metadata } from 'next'
import Link from 'next/link'
import { SitePage } from '@/components/site/site-page'
import '@/components/forms/forms.css'

export const metadata: Metadata = { title: "You're booked | Mingla", robots: { index: false, follow: false } }

export default function ApplyBookedPage() {
  return (
    <SitePage surface="explorer">
      <section className="ap-sec" style={{ background: '#15171c', color: '#fff' }}>
        <div className="wrap ap-done fk-success">
          <h1>You&rsquo;re <em>booked.</em></h1>
          <p>The invite with the video link is on its way to your inbox.</p>
          <div className="fk-actions">
            <Link className="fk-send" href="/">Done</Link>
            <Link className="fk-link-btn" href="/download">Get the Mingla app while you wait</Link>
          </div>
        </div>
      </section>
    </SitePage>
  )
}
