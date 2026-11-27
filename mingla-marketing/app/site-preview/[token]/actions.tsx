'use server'

// #4636 — the editor's live draft: re-render the previewed page from the
// content Admin posts (editor-draft) without reloading the frame.
//
// Safe by construction: it answers only for an unexpired preview token of the
// SAME page (site_public_preview), renders only for the caller (nothing is
// stored or shown to anyone else), and the content goes through the same
// rules as the live site: blocks the registry refuses are skipped and listed,
// a nav / footer the site refuses stays coded. React escapes every word.
import type { ReactNode } from 'react'
import { sitePreview, type PreviewValue } from '@/lib/site-pages/content'
import { convertedPage, isCustomPageKey, SITE_SETTINGS_KEY } from '@/lib/site-pages/converted'
import { editorOrigin } from '@/lib/site-pages/editor'
import { settingsErrors } from '@/lib/site-pages/settings'
import { validatePage } from '@/lib/site-blocks/registry'
import { previewBody, PreviewScope } from './preview-body'

export interface DraftRender {
  ok: boolean
  errors: string[]
  node: ReactNode
  sections: unknown[]
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function renderPreviewDraft(token: string, pageKey: string, content: unknown, sample: string | null, ao: string | null): Promise<DraftRender> {
  const refuse = (message: string): DraftRender => ({ ok: false, errors: [message], node: null, sections: [] })
  if (typeof token !== 'string' || !TOKEN.test(token)) return refuse('This preview has expired.')
  const preview = await sitePreview(token)
  if (!preview || preview.pageKey !== pageKey) return refuse('This preview has expired.')
  if (!isRecord(content) || JSON.stringify(content).length > 400_000) return refuse('The draft is not a page.')
  let errors: string[]
  if (pageKey === SITE_SETTINGS_KEY) {
    errors = settingsErrors(content)
  } else if (convertedPage(pageKey) || isCustomPageKey(pageKey)) {
    if (!Array.isArray(content.sections)) return refuse('The draft has no block list.')
    const check = validatePage(content.sections)
    errors = [...check.errors, ...check.results.flatMap((r, i) => (r.ok ? [] : r.errors.map((e) => `block ${i}: ${e}`)))]
  } else {
    return refuse('This page is edited in its spots, not as blocks.')
  }
  const origin = editorOrigin(ao)
  const forms = { ...preview.forms }
  for (const k of Object.keys(forms)) forms[k] = { ...forms[k], preview: true }
  const value: PreviewValue = {
    ...preview,
    forms,
    pages: { ...preview.pages, [pageKey]: { ...(preview.pages[pageKey] ?? {}), ...content } as PreviewValue['pages'][string] },
    editor: origin ? { origin } : null,
  }
  const body = await previewBody(value, typeof sample === 'string' ? sample : null)
  return { ok: errors.length === 0, errors: errors.slice(0, 20), node: <PreviewScope value={value}>{body.node}</PreviewScope>, sections: body.sections }
}
