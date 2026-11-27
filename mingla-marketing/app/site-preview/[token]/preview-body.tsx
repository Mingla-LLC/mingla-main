// #4636 — what the preview draws for a token: the page itself, at true size.
//
//   a converted page or any coded page → its real route (renderers.tsx); a
//                                        converted page shows the token's
//                                        draft block list when it has one;
//   a staff-made page                   → its draft blocks in the site wrapper;
//   'site-settings'                     → Home, wearing the draft nav and footer.
//
// PreviewScope puts the preview content into the request slot WHILE the tree
// renders, so the same body renders both on the first load (the route) and
// after a draft update from the editor (actions.ts, no reload).
import type { ReactNode } from 'react'
import { BlockRenderer } from '@/components/site-blocks/block-renderer'
import { previewSlot, type PreviewValue } from '@/lib/site-pages/content'
import { convertedPage, isCustomPageKey, SITE_SETTINGS_KEY } from '@/lib/site-pages/converted'
import { surfaceForFormat, type CustomFormat } from '@/lib/site-pages/custom'
import type { EditorMode } from '@/lib/site-pages/editor-protocol'
import { PREVIEW_RENDERERS } from './renderers'

export function PreviewScope({ value, children }: { value: PreviewValue; children: ReactNode }) {
  previewSlot().value = value
  return <>{children}</>
}

export interface PreviewBodyResult {
  node: ReactNode
  /** The address the page lives at (the bar and the editor show it). */
  path: string
  mode: EditorMode
  /** The block list the editor maps clicks onto ([] for a coded page). */
  sections: unknown[]
}

const FORMATS: readonly CustomFormat[] = ['landing', 'host-type', 'programme', 'story', 'blank']

function sectionsOf(preview: PreviewValue, key: string): unknown[] | null {
  const content = preview.pages[key] as unknown as Record<string, unknown> | undefined
  return Array.isArray(content?.sections) ? (content.sections as unknown[]) : null
}

export async function previewBody(preview: PreviewValue, sample: string | null): Promise<PreviewBodyResult> {
  const key = preview.pageKey
  const ctx = { sample, formPages: Object.keys(preview.form_pages ?? {}) }
  if (key === SITE_SETTINGS_KEY) {
    const home = await PREVIEW_RENDERERS.home(ctx)
    return { node: home.node, path: home.path, mode: 'settings', sections: [] }
  }
  if (isCustomPageKey(key)) {
    const custom = preview.custom ?? {}
    const format = FORMATS.find((f) => f === custom.format) ?? 'blank'
    const sections = sectionsOf(preview, key) ?? []
    return {
      node: (
        <BlockRenderer
          blocks={sections}
          media={(preview.media ?? {}) as never}
          surface={surfaceForFormat(format)}
          editor={Boolean(preview.editor)}
          idPrefix={key}
        />
      ),
      path: typeof custom.path === 'string' ? custom.path : '/',
      mode: 'blocks',
      sections,
    }
  }
  const renderer = PREVIEW_RENDERERS[key]
  if (!renderer) {
    return {
      node: (
        <main className="sp-expired">
          <h1>This page is not on the site.</h1>
          <p>Pick another page in Admin.</p>
        </main>
      ),
      path: '/',
      mode: 'coded',
      sections: [],
    }
  }
  const page = await renderer(ctx)
  const sections = convertedPage(key) ? sectionsOf(preview, key) : null
  return { node: page.node, path: page.path, mode: convertedPage(key) ? 'blocks' : 'coded', sections: sections ?? [] }
}
