import { GlassNav } from '@/components/marketing/glass-nav'
import { Footer } from '@/components/marketing/footer'

export default function OrganiserLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="light"
      className="min-h-screen bg-parchment text-text-primary"
    >
      <GlassNav />
      <main id="main">{children}</main>
      <Footer surface="organiser" />
    </div>
  )
}
