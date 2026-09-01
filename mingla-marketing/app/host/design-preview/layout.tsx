import { PreviewBanner } from '@/components/design-preview/system/preview-banner'

// #2902 — the Host-side preview shell.
//
// It adds ONLY the preview banner. Everything else — the real GlassNav with the
// Mingla Host lockup, the Download/Use-on-web choice, the parchment surface and
// the footer — is inherited from `app/host/layout.tsx` unchanged, because this
// route lives under `/host`. That inheritance is deliberate: the nav's surface
// discriminator is `pathname.startsWith('/host')`, so the prototype is reviewed
// with genuine production Host navigation rather than a copy of it.

export default function HostDesignPreviewLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      {/* Clears the fixed preview banner so it never covers footer links. */}
      <div aria-hidden="true" className="h-14" />
      <PreviewBanner />
    </>
  )
}
