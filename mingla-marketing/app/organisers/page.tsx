import { OrganiserHero } from '@/components/sections/organiser-home/hero'
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
    "Mingla turns what makes your place, event, menu, or pop-up special into something people want to book, buy, visit, and share. Using AI, we label the vibe, shape the story, highlight what matters, and match you with the people most likely to care.",
}

export default function OrganiserHomePage() {
  return (
    <>
      <OrganiserHero />
      <OrganiserWhatMinglaDoes />
      <OrganiserHowItWorks />
      <OrganiserAudiences />
      <OrganiserWhyMingla />
      <OrganiserComparison />
      <OrganiserFeatures />
      <OrganiserFaq />
      <OrganiserCta />
    </>
  )
}
