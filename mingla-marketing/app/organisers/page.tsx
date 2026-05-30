import { OrganiserHero } from '@/components/sections/organiser-home/hero'
import { OrganiserWhatIsMingla } from '@/components/sections/organiser-home/what-is-mingla'
import { OrganiserImpactStats } from '@/components/sections/organiser-home/impact-stats'
import { OrganiserAudienceTabs } from '@/components/sections/organiser-home/audience-tabs'
import { OrganiserWhatMinglaDoes } from '@/components/sections/organiser-home/what-mingla-does'
import { OrganiserHowItWorks } from '@/components/sections/organiser-home/how-it-works'
import { OrganiserAudiences } from '@/components/sections/organiser-home/audiences'
import { OrganiserWhyMingla } from '@/components/sections/organiser-home/why-mingla'
import { OrganiserComparison } from '@/components/sections/organiser-home/comparison'
import { OrganiserFeatures } from '@/components/sections/organiser-home/features'
import { OrganiserFaq } from '@/components/sections/organiser-home/faq'
import { OrganiserCta } from '@/components/sections/organiser-home/cta'

export const metadata = {
  title: 'Mingla Business — we give people a reason to show up for you.',
  description:
    'The businesses with the most soul are the hardest to find. Mingla Business changes that — we take what makes your place, event, or experience special and put it in front of the people already looking for exactly that. Your business has a vibe. Your community is looking for it. Mingla helps them find you.',
}

export default function OrganiserHomePage() {
  return (
    <>
      <OrganiserHero />
      <OrganiserWhatIsMingla />
      <OrganiserImpactStats />
      <OrganiserAudiences />
      <OrganiserAudienceTabs />
      <OrganiserWhatMinglaDoes />
      <OrganiserHowItWorks />
      <OrganiserWhyMingla />
      <OrganiserComparison />
      <OrganiserFeatures />
      <OrganiserFaq />
      <OrganiserCta />
    </>
  )
}
