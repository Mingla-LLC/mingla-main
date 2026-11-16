// #4452 §2.6 — what /apply/<slug> (and its thanks and booked pages) stands for:
// the current slug's form, a redirect from an old slug, or nothing (the 404).
import { siteContent } from '@/lib/site-pages/content'
import type { PublicForm } from '@/lib/site-pages/model'

export async function resolveApplySlug(slug: string): Promise<{ redirect: string } | { form: PublicForm } | null> {
  const content = await siteContent()
  const hit = content.form_pages[slug]
  if (!hit) return null
  if (hit.current_slug && hit.current_slug !== slug) return { redirect: hit.current_slug }
  const form = content.forms[hit.form_id]
  return form ? { form } : null
}
