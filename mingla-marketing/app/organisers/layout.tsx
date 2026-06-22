import { GlassNav } from '@/components/marketing/glass-nav'
import { Footer } from '@/components/marketing/footer'

export default function OrganiserLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-parchment text-text-primary"
    >
      <GlassNav />
      {/* ORCH-1223 re-mounts a cleaned footer here, superseding the ORCH-1053 removal (per Seth 2026-06-22 — store launch needs visible Privacy/Terms links). */}
      <main id="main">{children}</main>
      <Footer surface="organiser" />
    </div>
  )
}
