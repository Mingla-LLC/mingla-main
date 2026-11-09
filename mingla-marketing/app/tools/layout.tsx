import '@/components/cutout/cutout.css'
import { ToolsBreadcrumb } from '@/components/marketing/tools-breadcrumb'
import { RouteFrame } from '@/components/site/route-frame'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #1003 [Venue Website Grader — growth tools, test cut] — the /tools shell.
//
// #4339 phase 2b — the /tools hub itself is redesigned (app/tools/page.tsx
// brings the site nav, its <main> and the canonical footer), so the hub
// renders without a frame from here.
//
// #4339 phase 2c — the four tools (/tools/venues, /tools/events, /tools/trips,
// /tools/pricing) and their report pages move onto the same frame: the site
// nav (Host surface, Free tools current) replaces the old top bar and
// audience menu, the canonical footer replaces the old one, and the brand
// faces (route-scoped here, #3548) replace the old type on the tools' dark
// stage. The tools' own logic and content are untouched; the breadcrumb back
// up the funnel stays at the top of the stage.
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <RouteFrame bare={['/tools']} variant="site-tools" header={<ToolsBreadcrumb />} footer={null}>
        {children}
      </RouteFrame>
    </div>
  )
}
