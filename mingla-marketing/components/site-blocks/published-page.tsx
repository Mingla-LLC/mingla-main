// #4636 — a converted page: its PUBLISHED block list when one exists, else
// exactly the coded page (`children`).
//
// Invariant I-4452-NO-BLOCKS-NO-CHANGE (extended by #4636, declared in lib/__tests__/issue-4636-published-pages.implementor.test.mjs): with no published block list a converted page renders its coded children unchanged.
//
//   - nothing published, the read failed, or blocks are off → the coded page;
//   - a published list that is not a list, or none of whose blocks can render
//     (all invalid, unknown, or naming missing library media) → the coded page,
//     and the problem is reported ([site-blocks] console.error);
//   - otherwise → BlockRenderer with the page's own wrapper settings
//     (lib/site-pages/converted.ts): surface, current nav item, the layout's
//     <main>, and a host-type page's ICP slug. Invalid blocks inside a usable
//     list are skipped and reported; the rest render.
import type { ReactNode } from 'react'
import { convertedPage } from '@/lib/site-pages/converted'
import { editorMode } from '@/lib/site-pages/content'
import { publishedPage } from '@/lib/site-pages/published'
import type { BlockReporter } from '@/lib/site-blocks/render-plan'
import { BlockRenderer, renderableCount } from './block-renderer'

const report: BlockReporter = (message) => console.error(`[site-blocks] ${message}`)

interface PublishedOrProps {
  pageKey: string
  /** Overrides the registry surface (the /download page follows its ?app=). */
  surface?: 'explorer' | 'host'
  blockProps?: Readonly<Record<string, Record<string, unknown>>>
  /** Rendered before the blocks only (structured data, analytics the coded page carries inside its tree). */
  extra?: ReactNode
  /** The coded page. */
  children: ReactNode
}

export async function PublishedOr({ pageKey, surface, blockProps, extra, children }: PublishedOrProps) {
  const page = convertedPage(pageKey)
  if (!page) return children
  const published = await publishedPage(pageKey)
  if (!published || published.sections === null) return children
  if (renderableCount(published.sections, published.media) === 0) {
    report(`${pageKey}: the published block list has nothing that can render; the coded page stays`)
    return children
  }
  return (
    <>
      {extra}
      <BlockRenderer
        blocks={published.sections}
        media={published.media}
        surface={surface ?? page.surface}
        current={page.current}
        layoutMain={page.layoutMain}
        slug={page.icp}
        blockProps={blockProps}
        editor={editorMode()?.pageKey === pageKey}
        idPrefix={pageKey}
        report={report}
      />
    </>
  )
}
