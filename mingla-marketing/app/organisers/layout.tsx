import { GlassNav } from '@/components/marketing/glass-nav'

export default function OrganiserLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-parchment text-text-primary"
    >
      <GlassNav />
      {/* ORCH-1053 — footer removed from the business (organiser) surface per operator. */}
      <main id="main">{children}</main>
    </div>
  )
}
