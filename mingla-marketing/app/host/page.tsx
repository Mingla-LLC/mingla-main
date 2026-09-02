import { OrganiserHero } from '@/components/sections/organiser-home/hero'
import { OrganiserWhatIsMingla } from '@/components/sections/organiser-home/what-is-mingla'
import { OrganiserImpactStats } from '@/components/sections/organiser-home/impact-stats'
import { OrganiserAudienceTabs } from '@/components/sections/organiser-home/audience-tabs'
import { OrganiserAudiences } from '@/components/sections/organiser-home/audiences'
import { OrganiserFeatures } from '@/components/sections/organiser-home/features'
import { searchRouteMetadata } from '@/lib/search/metadata'

export const metadata = searchRouteMetadata('/host')

export default function OrganiserHomePage() {
  return (
    <>
      <OrganiserHero />
      <OrganiserWhatIsMingla />
      <OrganiserImpactStats />
      <OrganiserAudiences />
      <OrganiserAudienceTabs />
      <OrganiserFeatures />
    </>
  )
}
