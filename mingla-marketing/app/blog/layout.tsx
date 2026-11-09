import '@/components/cutout/cutout.css'
import '@/components/blog/blog.css'
// #4339 round B (speed): direct module imports, not the barrel (the
// barrel pulls framer-motion into every route that touches it).
import { CutoutFooter } from '@/components/cutout/footer'
import { CutoutNav } from '@/components/cutout/cutout-nav'
import { RouteFrame } from '@/components/site/route-frame'

// #4137 — the blog's own layout: Cutout shell, the Explorer nav, one <main>
// (verify-search-foundation reads its text), and the footer.
//
// #4339 phase 2b — the blog index (/blog) and the four category pages are
// redesigned and bring the site nav, their <main> and the canonical footer
// (app/blog/page.tsx, app/blog/category/[category]/page.tsx), so they render
// without this frame. The posts and previews keep it unchanged
// (components/site/route-frame.tsx).
//
// #4339 phase 2c — the posts (/blog/<slug>) are on the new frame too
// (app/blog/[slug]/page.tsx); only the staff preview (/blog/preview/<token>,
// never public) keeps this frame.
export default function BlogLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RouteFrame
      bare={['/blog']}
      barePrefixes={['/blog/']}
      framedPrefixes={['/blog/preview/']}
      variant="cutout"
      header={<CutoutNav surface="explorer" homeHref="/" />}
      footer={<CutoutFooter surface="explorer" />}
    >
      {children}
    </RouteFrame>
  )
}
