// #4452 §2.9 — the staff draft preview of a page by a one-hour token. Never
// indexed or cached. It renders the REAL page component with the preview
// content injected for this request; forms in it send nothing. An expired or
// unknown token shows the expired message (404) and never draft content.
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { previewSlot, sitePreview } from '@/lib/site-pages/content'
import { editorOrigin } from '@/lib/site-pages/editor'
import { popupFor } from '@/lib/site-pages/model'
import { HOST_ICP_KEYS } from '@/lib/site-pages/registry'
import { EditorBridge } from '@/components/site-blocks/editor-bridge'
import { EditorChrome } from '@/components/site-blocks/editor-chrome'
import { PreviewPopup } from '@/components/forms/preview-popup'
import type { RendererForm } from '@/components/forms/form-renderer'
import '@/components/site-blocks/site-blocks.css'
import { SITE_PAGES } from '@/lib/site-pages/registry'
import CreatorsPage from '@/app/creators/page'
import LocalsPage from '@/app/locals/page'
import SchedulePage from '@/app/schedule/page'
import { IcpLandingPage } from '@/components/landing/icp-landing'
import { isIcpSlug } from '@/content/host-landing/icps'
import '@/components/forms/forms.css'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: { absolute: 'Preview · Mingla' }, robots: { index: false, follow: false } }

export default async function SitePreviewPage({ params, searchParams }: { readonly params: Promise<{ token: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await headers()
  const preview = await sitePreview((await params).token)
  const q = await searchParams
  // #4452 §7.6: ?editor=1&ao=<Admin origin> turns on the editor's markers; any other origin is ignored.
  const origin = q.editor === '1' ? editorOrigin(q.ao) : null
  if (!preview) notFound()  // ./not-found.tsx: "This preview has expired." with status 404
  // Forms in a preview never call forms-submit.
  for (const f of Object.values(preview.forms)) f.preview = true
  previewSlot().value = { ...preview, editor: origin ? { origin } : null }
  const page = SITE_PAGES.find((p) => p.key === preview.pageKey)
  const body = preview.pageKey === 'creators' ? <CreatorsPage />
    : preview.pageKey === 'locals' ? <LocalsPage />
    : preview.pageKey === 'schedule' ? <SchedulePage />
    : isIcpSlug(preview.pageKey) ? <IcpLandingPage slug={preview.pageKey} />
    : <p className="sp-note">This page has no inline spots. Its pop-up shows as a visitor would see it.</p>
  const popup = popupFor(preview, preview.pageKey, HOST_ICP_KEYS.includes(preview.pageKey))
  const popupForm = popup?.form_id ? preview.forms[popup.form_id] : null
  const details = preview.pageKey !== 'schedule' ? 'none' : preview.pages.schedule?.blocks?.some((b) => b.spot === 'details-step') ? 'filled' : 'empty'
  // The previewed pages are drawn in the brand faces (#4339 font contract).
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      {origin ? <EditorBridge origin={origin} page={preview.pageKey} /> : null}
      <div className="sp-bar" role="status">
        Preview · Draft of {page?.path ?? preview.pageKey} · {preview.changes} unpublished change{preview.changes === 1 ? '' : 's'} · only people with this link see this · expires in 1 hour
      </div>
      {origin ? <EditorChrome page={preview.pageKey} hasPopup={Boolean(popupForm)} details={details} /> : null}
      {!origin && popup && popupForm ? <PreviewPopup form={popupForm as unknown as RendererForm & { name: string }} block={popup} /> : null}
      {body}
    </div>
  )
}
