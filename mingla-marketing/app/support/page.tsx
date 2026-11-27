import { SitePage } from '@/components/site/site-page'
import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { QuickLinksBlock } from '@/components/site-blocks/sections/quick-links-block'
import { SUPPORT_HERO, SUPPORT_LINKS } from '@/content/site-blocks/core'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — Support, in the approved design, with the live copy: the
// email, "aims to respond within 1–2 business days", the quick links (Privacy
// Policy, Terms of Service, Organiser Terms, Delete your account) and the
// in-app deletion note. The SEO contract is unchanged (search_ready "/support").

export const metadata = searchRouteMetadata('/support')

// #4636: the headline and the quick links are registry blocks (pageHero,
// quickLinks) with this page's default content (content/site-blocks/core.ts).

export default function SupportPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <PageHeroBlock content={SUPPORT_HERO} blockId="support-hero" />
        <QuickLinksBlock content={SUPPORT_LINKS} blockId="support-links" />
      </SitePage>
    </div>
  )
}
