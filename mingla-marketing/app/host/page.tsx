import {
  OrganiserHero,
  type HostHeroVariant,
} from '@/components/sections/organiser-home/hero'
import { OrganiserWhatIsMingla } from '@/components/sections/organiser-home/what-is-mingla'
import { OrganiserImpactStats } from '@/components/sections/organiser-home/impact-stats'
import { OrganiserAudienceTabs } from '@/components/sections/organiser-home/audience-tabs'
import { OrganiserAudiences } from '@/components/sections/organiser-home/audiences'
import { OrganiserFeatures } from '@/components/sections/organiser-home/features'

export const metadata = {
  title: 'Mingla Host — we give people a reason to show up for you.',
  description:
    'The businesses with the most soul are the hardest to find. Mingla Host changes that — we take what makes your place, event, or experience special and put it in front of the people already looking for exactly that. Your business has a vibe. Your community is looking for it. Mingla helps them find you.',
}

interface OrganiserHomePageProps {
  searchParams: Promise<{ hero?: string | string[] }>
}

export default async function OrganiserHomePage({ searchParams }: OrganiserHomePageProps) {
  const params = await searchParams
  const requested = Array.isArray(params.hero) ? params.hero[0] : params.hero
  const heroVariant: HostHeroVariant = requested === 'world' ? 'world' : 'city'

  return (
    <>
      <OrganiserHero variant={heroVariant} />
      <OrganiserWhatIsMingla />
      <OrganiserImpactStats />
      <OrganiserAudiences />
      <OrganiserAudienceTabs />
      <OrganiserFeatures />
    </>
  )
}
