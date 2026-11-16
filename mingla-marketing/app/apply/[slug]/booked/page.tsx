// #4452 §2.8 — the booked page of a form page (a real address, noindex).
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { resolveApplySlug } from '../resolve'
import Link from 'next/link'
import { SitePage } from '@/components/site/site-page'
import '@/components/forms/forms.css'
import { BookedLine } from './booked-client'

// #4452 follow-up (B14): the root template adds " — Mingla" once.
export const metadata: Metadata = { title: "You're booked", robots: { index: false, follow: false } }

// #4452 follow-up (B13): an unknown slug is the 404 page, like /apply/<slug>;
// an old slug moves to the current one's booked page.
export default async function ApplyBookedPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug
  const r = await resolveApplySlug(slug)
  if (!r) notFound()
  if ('redirect' in r) permanentRedirect(`/apply/${r.redirect}/booked`)
  return (
    <SitePage surface="explorer">
      <section className="ap-sec" style={{ background: '#15171c', color: '#fff' }}>
        <div className="wrap ap-done fk-success">
          <h1>You&rsquo;re <em>booked.</em></h1>
          <BookedLine />
          <div className="fk-actions">
            <Link className="fk-send" href="/">Done</Link>
            <Link className="fk-link-btn" href="/download">Get the Mingla app while you wait</Link>
          </div>
        </div>
      </section>
    </SitePage>
  )
}
