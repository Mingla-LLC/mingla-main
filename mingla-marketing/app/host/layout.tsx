import '@/components/cutout/cutout.css'
import '@/components/cities/city-hubs.css'

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-parchment text-text-primary"
    >
      {/* ORCH-1223 mounts a cleaned footer here, superseding the ORCH-1053 removal (per Seth 2026-06-22 — store launch needs visible Privacy/Terms links). ORCH-1224: the footer lives on the BUSINESS surface ONLY (explorer is a one-viewport hero). The internal `surface="organiser"` discriminator value is kept (never user-visible). */}
      <main id="main">{children}</main>
    </div>
  )
}
