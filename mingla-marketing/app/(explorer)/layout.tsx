import { GlassNav } from '@/components/marketing/glass-nav'

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlassNav />
      <main id="main">{children}</main>
    </>
  )
}
