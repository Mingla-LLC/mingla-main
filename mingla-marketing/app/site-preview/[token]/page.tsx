// #4452 §2.9 — the staff draft preview of a page by a one-hour token. Never
// indexed or cached. It renders the REAL page with the preview content
// injected for this request; forms in it send nothing. An expired or unknown
// token shows the expired message (404) and never draft content.
//
// #4636: EVERY page renders, at true size (preview-body.tsx + renderers.tsx):
// coded pages through their own route and layouts, converted pages with the
// token's draft block list, staff-made pages from their draft blocks, and the
// nav / footer draft on Home. A view-only member's token carries the LIVE
// content (the database decides; investigation F-4). In the editor
// (?editor=1&ao=<Admin origin>) the block canvas (preview-canvas.tsx) reports
// block positions and clicks to Admin and re-renders from posted drafts
// without a reload (lib/site-pages/editor-protocol.ts).
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { previewSlot, sitePreview } from '@/lib/site-pages/content'
import { editorOrigin } from '@/lib/site-pages/editor'
import { popupFor } from '@/lib/site-pages/model'
import { HOST_ICP_KEYS } from '@/lib/site-pages/registry'
import { EditorBridge } from '@/components/site-blocks/editor-bridge'
import { EditorChrome } from '@/components/site-blocks/editor-chrome'
import { PreviewCanvas } from '@/components/site-blocks/preview-canvas'
import { PreviewPopup } from '@/components/forms/preview-popup'
import type { RendererForm } from '@/components/forms/form-renderer'
import '@/components/site-blocks/site-blocks.css'
import '@/components/forms/forms.css'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'
import { renderPreviewDraft } from './actions'
import { previewBody, PreviewScope } from './preview-body'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: { absolute: 'Preview · Mingla' }, robots: { index: false, follow: false } }

const SAMPLE = /^[a-z0-9][a-z0-9-]{0,80}$/

export default async function SitePreviewPage({ params, searchParams }: { readonly params: Promise<{ token: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await headers()
  const token = (await params).token
  const preview = await sitePreview(token)
  const q = await searchParams
  // #4452 §7.6: ?editor=1&ao=<Admin origin> turns on the editor's markers; any other origin is ignored.
  const origin = q.editor === '1' ? editorOrigin(q.ao) : null
  if (!preview) notFound()  // ./not-found.tsx: "This preview has expired." with status 404
  // Forms in a preview never call forms-submit.
  for (const f of Object.values(preview.forms)) f.preview = true
  const value = { ...preview, editor: origin ? { origin } : null }
  previewSlot().value = value
  const sample = typeof q.sample === 'string' && SAMPLE.test(q.sample) ? q.sample : null
  const body = await previewBody(value, sample)
  const popup = popupFor(preview, preview.pageKey, HOST_ICP_KEYS.includes(preview.pageKey))
  const popupForm = popup?.form_id ? preview.forms[popup.form_id] : null
  const details = preview.pageKey !== 'schedule' ? 'none' : preview.pages.schedule?.blocks?.some((b) => b.spot === 'details-step') ? 'filled' : 'empty'
  const what = body.mode === 'settings' ? 'the menu and footer' : body.path
  const page = <PreviewScope value={value}>{body.node}</PreviewScope>
  // The previewed pages are drawn in the brand faces (#4339 font contract).
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      {origin ? <EditorBridge origin={origin} page={preview.pageKey} /> : null}
      <div className="sp-bar" role="status">
        Preview · Draft of {what} · {preview.changes} unpublished change{preview.changes === 1 ? '' : 's'} · only people with this link see this · expires in 1 hour
      </div>
      {origin ? <EditorChrome page={preview.pageKey} hasPopup={Boolean(popupForm)} details={details} /> : null}
      {!origin && popup && popupForm ? <PreviewPopup form={popupForm as unknown as RendererForm & { name: string }} block={popup} /> : null}
      {origin ? (
        <PreviewCanvas token={token} page={preview.pageKey} origin={origin} sample={sample} mode={body.mode} sections={body.sections} renderDraft={renderPreviewDraft}>
          {page}
        </PreviewCanvas>
      ) : (
        page
      )}
    </div>
  )
}
