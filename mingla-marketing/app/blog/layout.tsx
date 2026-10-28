import '@/components/cutout/cutout.css'
import '@/components/blog/blog.css'
import { CutoutFooter, CutoutNav, CutoutShell } from '@/components/cutout'

// #4137 — the blog's own layout: Cutout shell, the Explorer nav, one <main>
// (verify-search-foundation reads its text), and the footer.
export default function BlogLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <CutoutShell>
      <CutoutNav surface="explorer" homeHref="/" />
      <main id="main">{children}</main>
      <CutoutFooter surface="explorer" />
    </CutoutShell>
  )
}
