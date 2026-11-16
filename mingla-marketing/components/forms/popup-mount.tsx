// #4452 §2.4 — mounts the pop-up host only when a published page has a pop-up,
// so a site with no pop-ups renders exactly as before.
import { siteContent } from '@/lib/site-pages/content'
import { popupFor } from '@/lib/site-pages/model'
import { HOST_ICP_KEYS, SITE_PAGES } from '@/lib/site-pages/registry'
import { PopupHost, type PopupEntry } from './popup-host'

export async function PopupMount() {
  const content = await siteContent()
  const byPage: Record<string, PopupEntry> = {}
  const keyForPath: Record<string, string> = {}
  for (const page of SITE_PAGES) {
    if (page.pattern) continue
    const block = popupFor(content, page.key, HOST_ICP_KEYS.includes(page.key))
    if (block?.form_id && block.popup) {
      byPage[page.key] = { block, form: content.forms[block.form_id] }
      keyForPath[page.path] = page.key
    }
  }
  if (Object.keys(byPage).length === 0) return null
  return <PopupHost byPage={byPage} keyForPath={keyForPath} />
}
