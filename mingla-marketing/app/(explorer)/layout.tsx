import { GlassNav } from '@/components/marketing/glass-nav'
import { Footer } from '@/components/marketing/footer'

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlassNav />
      <main id="main">{children}</main>
      <Footer surface="explorer" />
    </>
  )
}
