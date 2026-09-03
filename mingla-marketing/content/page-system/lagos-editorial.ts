import type { ExplorerCategorySlug } from './shared'

export interface LagosEditorialSection {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly categorySlugs: readonly ExplorerCategorySlug[]
}

export const LAGOS_EDITORIAL_SECTIONS: readonly LagosEditorialSection[] = [
  {
    id: 'party',
    eyebrow: 'Turn the volume up',
    title: 'Party after dark',
    intro: 'Start with music, energy and a place that gives the group a reason to stay.',
    categorySlugs: ['drinks', 'play', 'drinks'],
  },
  {
    id: 'date',
    eyebrow: 'Make it memorable',
    title: 'Date night with a little drama',
    intro: 'Pair dinner with art, cinema or a live performance so the night has a natural rhythm.',
    categorySlugs: ['fine_dining', 'theatre', 'movies', 'creative_arts'],
  },
  {
    id: 'hangout',
    eyebrow: 'Easy for the whole group',
    title: 'Easy group hangouts',
    intro: 'Choose relaxed food and conversation-friendly places when the people matter more than a timetable.',
    categorySlugs: ['brunch', 'casual_food', 'icebreakers'],
  },
  {
    id: 'culture',
    eyebrow: 'See another side of Lagos',
    title: 'A culture-first day',
    intro: 'Build the day around green space, local art and places that hold part of the city’s story.',
    categorySlugs: ['nature', 'theatre', 'creative_arts'],
  },
] as const

export const LAGOS_QUICK_FACTS = [
  {
    fact: 'Lekki Conservation Centre was established in 1990 and is described by Lagos State as a flagship conservation destination.',
    source: 'Lagos Resilience Strategy',
    href: 'https://lasbca.lagosstate.gov.ng/wp-content/uploads/2021/05/Lagos_Resilience_Strategy.pdf',
    checkedAt: '2 September 2026',
  },
  {
    fact: 'Freedom Park sits on Lagos Island’s former colonial prison grounds and now serves as an arts and recreation space.',
    source: 'Freedom Park Lagos',
    href: 'https://freedomparklagos.com/visit/',
    checkedAt: '2 September 2026',
  },
  {
    fact: 'Nike Davies-Okundaye’s Lagos gallery is part of a wider network of art centres she founded across Nigeria.',
    source: 'Nike Art Foundation',
    href: 'https://nikeartfoundation.com/wp-content/uploads/2024/01/Nike-Okundaye-Bio-full.pdf',
    checkedAt: '2 September 2026',
  },
] as const
