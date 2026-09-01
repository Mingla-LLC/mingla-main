import { GlassNav } from '@/components/marketing/glass-nav'
import { Footer } from '@/components/marketing/footer'
import { PreviewBanner } from '@/components/design-preview/system/preview-banner'

// #2902 — the Explorer-side preview shell.
//
// It mounts the REAL GlassNav, unmodified. Because this path does not start
// with `/host`, the nav resolves the explorer surface on its own: the Mingla
// wordmark, the Explorer/Host toggle, and the device-aware "Get the app"
// action. That is the point — the prototype is reviewed with production
// navigation behaviour, not a redrawn header.
//
// The live `/` deliberately has no footer (it is a single non-scrolling hero).
// A long editorial landing page does need one, so it is mounted here.

export default function DesignPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GlassNav />
      <main id="main">{children}</main>
      <Footer surface="explorer" />
      {/* Clears the fixed preview banner so it never covers footer links. */}
      <div aria-hidden="true" className="h-14" />
      <PreviewBanner />
    </>
  )
}
