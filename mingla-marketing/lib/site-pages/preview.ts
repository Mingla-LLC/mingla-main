// #4452 §2.9 / §7.6 — pure: how a preview token's content joins the live content.
import type { SiteContent } from './model'

/**
 * #4452 §2.9 / §7.6 (the preview-token scope): a token shows the draft of ITS
 * page only. Every other page keeps its live content, and every form in the
 * preview is a preview form (Send never submits).
 */
export function mergePreview(
  live: SiteContent,
  raw: { page_key: string; content: unknown; forms?: unknown; changes?: unknown; expires_at?: unknown },
): SiteContent & { pageKey: string; changes: number; expiresAt: string } {
  const forms: SiteContent['forms'] = { ...live.forms, ...((raw.forms ?? {}) as SiteContent['forms']) }
  for (const k of Object.keys(forms)) forms[k] = { ...forms[k], preview: true }
  return {
    pages: { ...live.pages, [raw.page_key]: raw.content as SiteContent['pages'][string] },
    forms,
    form_pages: live.form_pages,
    pageKey: raw.page_key,
    changes: Number(raw.changes ?? 0),
    expiresAt: String(raw.expires_at ?? ''),
  }
}
