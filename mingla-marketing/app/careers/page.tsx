// META-ORCH-1222 [Careers site] — index. Server component: fetches the OPEN
// roles via listOpenRoles() for instant SSR + SEO. Empty (zero open roles) and
// error states are rendered here.
//
// #4339 phase 2b — redesigned ("Mingla, Edited"): the site nav and the
// canonical footer with every link absolute on usemingla.com (this page is
// served on career.usemingla.com, where a relative link would stay inside the
// careers segment), the headline, three values, then the live roles. With no
// open roles it says "No open roles right now." and offers "Follow
// @usemingla". There is NO email sign-up form: nothing would receive it (§7).
// Role cards open /roles/<slug> on the careers host, unchanged.

import { PageHeroBlock } from '@/components/site-blocks/sections/page-hero-block'
import { OpenRolesBlock } from '@/components/site-blocks/sections/open-roles-block'
import { StepsBlock } from '@/components/site-blocks/sections/steps-block'
import { SitePage } from '@/components/site/site-page'
import { CAREERS_HERO, CAREERS_VALUES } from '@/content/site-blocks/core'
import { SITE_ORIGIN } from '@/lib/site'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4636: the headline, the values and the roles are registry blocks (pageHero,
// steps (values), openRoles); the values and roles share the programme frame.

export const dynamic = 'force-dynamic'

export default function CareersIndexPage() {
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer" origin={SITE_ORIGIN}>
        <PageHeroBlock content={CAREERS_HERO} blockId="careers-hero" />
        <section className="pb-100" aria-label="Open roles">
          <div className="wrap">
            <StepsBlock content={CAREERS_VALUES} blockId="careers-values" />
            <OpenRolesBlock />
          </div>
        </section>
      </SitePage>
    </div>
  )
}
