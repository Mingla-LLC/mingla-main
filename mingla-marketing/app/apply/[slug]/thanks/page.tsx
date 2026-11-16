// #4452 §2.8 — the success page of a form page (a real address, noindex).
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { resolveApplySlug } from '../resolve'
import { SitePage } from '@/components/site/site-page'
import { ThanksClient } from './thanks-client'
import '@/components/forms/forms.css'

// #4452 follow-up (B14): the root template adds " — Mingla" once.
export const metadata: Metadata = { title: "You're in", robots: { index: false, follow: false } }

// #4452 follow-up (B13): an unknown slug is the 404 page, like /apply/<slug>;
// an old slug moves to the current one's thanks page.
export default async function ApplyThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug
  const r = await resolveApplySlug(slug)
  if (!r) notFound()
  if ('redirect' in r) permanentRedirect(`/apply/${r.redirect}/thanks`)
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
