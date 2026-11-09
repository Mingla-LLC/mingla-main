import { SiteFooter } from '@/components/marketing/footer'
import type { CutoutSurface } from './device-cta'

// #4339 §9 — the Cutout pages (blog, help, cities, locals, creators, core
// pages) close with the ONE canonical footer, owned by
// components/marketing/footer.tsx. This wrapper only keeps the existing
// `<CutoutFooter surface=… />` call sites working; it adds nothing of its own.
//
// The #2902 Cutout footer's own CTA and blurb are gone: the canonical footer
// is columns, tagline and cross-link only, and every page already carries its
// own call to action above it.
export function CutoutFooter({ surface }: { surface: CutoutSurface }) {
  return <SiteFooter surface={surface} />
}
