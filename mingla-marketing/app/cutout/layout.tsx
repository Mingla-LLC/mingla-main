import '@/components/cutout/cutout.css'
import { AppsSchema, OrganizationSchema } from '@/components/cutout'
import { PreviewBanner } from '@/components/design-preview/system/preview-banner'

// #2902 — Cutout design-foundation preview. Review-only: these routes do not
// replace `/` or `/host`, are never indexed, and are not deployed.
//
// The entity graph is emitted HERE rather than per page, so every page in the
// system carries Organization + WebSite + the two real apps. In production this
// same emitter belongs in the root layout — SC-08 needs it on every URL.

export default function CutoutPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OrganizationSchema />
      <AppsSchema />
      {children}
      <div aria-hidden="true" className="h-14" />
      <PreviewBanner />
    </>
  )
}
