import { HostPage } from '@/components/site/host-page'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2a — Mingla Host, redesigned in place ("Mingla, Edited"). It
// replaces the #2902/#4137 Cutout page: dark Reelmark hero, the seven host
// types (each opens its /host/<icp> landing page), the website prompt demo,
// the Ari cards, the toolkit and the closing band, over the canonical footer
// (components/site/host-page.tsx). The SEO contract is unchanged: the
// search_ready metadata for "/host". Brand faces: app/site-fonts.ts (#3548).

export const metadata = searchRouteMetadata('/host')

export default function MinglaHostPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <HostPage />
    </div>
  )
}
