// #4636 — staff-made pages (Admin, Website pages, "New page"). Only addresses
// that are a live or deleted staff page answer here; everything else is the
// site's 404, exactly as before this route existed:
//
//   live page        → its published blocks, inside the same wrapper and brand
//                      faces as the coded pages (R6), with its own title,
//                      description, share image and (hidden from search) noindex;
//   deleted page     → 308 to its redirect (Home by default);
//   draft / unknown  → 404 (a draft is never served; it previews through
//                      /site-preview/<token>).
//
// Next.js always prefers a coded route, the database refuses an address whose
// first segment the coded site answers (I-4636-NO-ADDRESS-COLLISION), and the
// route re-checks the reserved list, so it can never shadow a coded page.
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { BlockRenderer, renderableCount } from '@/components/site-blocks/block-renderer'
import { libraryRoot } from '@/lib/landing-media-ref'
import { customPageMetadata, routeCustom, surfaceForFormat } from '@/lib/site-pages/custom'
import { customIndex, publishedPage } from '@/lib/site-pages/published'
import reserved from '@/lib/site-pages/reserved-paths.json'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

type Params = Promise<{ slug?: string[] }>

async function route(params: Params) {
  const { slug } = await params
  return routeCustom(slug, await customIndex(), reserved.segments)
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await route(params)
  if (r.kind !== 'page') return {}
  return customPageMetadata(r.entry, libraryRoot())
}

export default async function StaffPage({ params }: { params: Params }) {
  const r = await route(params)
  if (r.kind === 'redirect') permanentRedirect(r.to)
  if (r.kind !== 'page') notFound()
  const page = await publishedPage(r.entry.key)
  const report = (message: string) => console.error(`[site-blocks] ${r.entry.path}: ${message}`)
  if (!page?.sections || renderableCount(page.sections, page.media) === 0) {
    if (page?.sections) report('the published block list has nothing that can render')
    notFound()
  }
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <BlockRenderer blocks={page.sections} media={page.media} surface={surfaceForFormat(r.entry.format)} idPrefix={r.entry.key} report={report} />
    </div>
  )
}
