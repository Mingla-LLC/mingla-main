import { GlassNav } from '@/components/marketing/glass-nav'
import { Footer } from '@/components/marketing/footer'

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlassNav />
      <main id="main">{children}</main>
      {/* ORCH-1223 re-mounts the cleaned footer (supersedes ORCH-1053 removal, per Seth 2026-06-22). */}
      <Footer surface="explorer" />
    </>
  )
}
