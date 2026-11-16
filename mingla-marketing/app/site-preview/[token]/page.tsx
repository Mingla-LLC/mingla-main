// #4452 §2.9 — the staff draft preview of a page by a one-hour token. Never
// indexed or cached. It renders the REAL page component with the preview
// content injected for this request; forms in it send nothing. An expired or
// unknown token shows the expired message (404) and never draft content.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { previewSlot, sitePreview } from '@/lib/site-pages/content'
import { SITE_PAGES } from '@/lib/site-pages/registry'
import CreatorsPage from '@/app/creators/page'
import LocalsPage from '@/app/locals/page'
import SchedulePage from '@/app/schedule/page'
import { IcpLandingPage } from '@/components/landing/icp-landing'
import { isIcpSlug } from '@/content/host-landing/icps'
import '@/components/forms/forms.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: { absolute: 'Preview · Mingla' }, robots: { index: false, follow: false } }

export default async function SitePreviewPage({ params }: { readonly params: Promise<{ token: string }> }) {
  await headers()
  const preview = await sitePreview((await params).token)
  if (!preview) notFound()  // ./not-found.tsx: "This preview has expired." with status 404
  // Forms in a preview never call forms-submit.
  for (const f of Object.values(preview.forms)) f.preview = true
  previewSlot().value = preview
  const page = SITE_PAGES.find((p) => p.key === preview.pageKey)
  const body = preview.pageKey === 'creators' ? <CreatorsPage />
    : preview.pageKey === 'locals' ? <LocalsPage />
    : preview.pageKey === 'schedule' ? <SchedulePage />
    : isIcpSlug(preview.pageKey) ? <IcpLandingPage slug={preview.pageKey} />
    : <p className="sp-note">This page has no inline spots. Its pop-up shows as a visitor would see it.</p>
  return (
    <>
      <div className="sp-bar" role="status">
        Preview · Draft of {page?.path ?? preview.pageKey} · {preview.changes} unpublished change{preview.changes === 1 ? '' : 's'} · only people with this link see this · expires in 1 hour
      </div>
      {body}
    </>
  )
}
