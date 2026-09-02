import type { FaqEntry } from './shared'

export const LAGOS_CITY_CONTENT = {
  futurePath: '/cities/lagos',
  eyebrow: 'Mingla in Lagos, Nigeria',
  title: 'Find the right plan in Lagos.',
  lede:
    'Choose the kind of outing you want, turn places and events into a plan, or use Mingla Host to publish the experience people can join.',
  answerHeading: 'What can you do with Mingla in Lagos?',
  answer:
    'Mingla helps Explorers turn Lagos places and events into a plan they can save and share. Mingla Host helps organisers, venues and experience brands publish what people can join, connect the supported booking, ticket or RSVP action, and run the guest workflow.',
  availability:
    'Availability varies by experience. This review page does not claim that a particular event, venue, price or ticket is currently available.',
  evidence:
    'Lagos launch evidence is still under review. Current availability, venue facts and event details must be verified before publication.',
  audiencePaths: [
    {
      audience: 'Explorer',
      title: 'Find → shape → share the plan.',
      description:
        'Start with the outing you want, compare what matters to your people, and make one plan easy to share.',
      href: '/',
      action: 'Explore Mingla',
    },
    {
      audience: 'Mingla Host',
      title: 'Publish → connect the action → run the guest experience.',
      description:
        'Explain the experience clearly, connect the supported way to join, and keep the guest workflow in view.',
      href: '/host',
      action: 'Explore Mingla Host',
    },
  ],
  demoChoices: [
    {
      name: 'After-work creative session',
      occasion: 'Friends reconnecting',
      mood: 'Curious and conversational',
      time: 'Early evening; exact finish needed',
      cost: 'Known entry; extras need checking',
      travel: 'Meeting point and return route needed',
      entry: 'Reservation method needs confirmation',
      comfort: 'Seating and access need evidence',
      evidence: 'Primary organiser source required',
    },
    {
      name: 'Late supper with live sound',
      occasion: 'A lively date plan',
      mood: 'Social with time to talk',
      time: 'Late evening; arrival window needed',
      cost: 'Menu and any entry cost need checking',
      travel: 'Late return is part of the decision',
      entry: 'Booking versus walk-in must be clear',
      comfort: 'Sound level and seating need evidence',
      evidence: 'Venue-owned details required',
    },
    {
      name: 'Weekend outdoor gathering',
      occasion: 'A flexible group outing',
      mood: 'Open-air and energetic',
      time: 'Daytime; weather timing needed',
      cost: 'Price state is not verified',
      travel: 'Exact location and meeting point needed',
      entry: 'Ticket, RSVP or door state must be clear',
      comfort: 'Weather cover and access need evidence',
      evidence: 'Current event source required',
    },
  ],
  flows: [
    {
      title: 'Explorer path',
      steps: ['Explorer choice', 'Shared plan', 'Supported action'],
      conclusion: 'The choice becomes useful when the people, practical details and real action stay together.',
    },
    {
      title: 'Mingla Host path',
      steps: ['Mingla Host page', 'Supported action', 'Guest workflow'],
      conclusion: 'The offer becomes easier to join when the public explanation and guest operation agree.',
    },
  ],
  faqs: [
    {
      question: 'Does this page list live Lagos events or venues?',
      answer:
        'No. This private review fixture demonstrates the page system. It does not claim that a particular event, venue, price or ticket is currently available.',
    },
    {
      question: 'How will a future Lagos page decide what to show?',
      answer:
        'Named places, events, prices, hours, availability and images must have current, Lagos-specific evidence and review before they can appear as factual recommendations.',
    },
    {
      question: 'What can an Explorer do with Mingla?',
      answer:
        'An Explorer can use Mingla to find an idea, shape it around the people coming, save it and share the plan, then use the real action available for that experience.',
    },
    {
      question: 'What can an organiser do with Mingla Host?',
      answer:
        'An organiser can create or edit an offering, present a buyer-facing page, connect a supported ticket, RSVP or booking action, and use supported guest-list or QR entry workflows where available.',
    },
    {
      question: 'Why does the page say evidence review is pending?',
      answer:
        'The visual and content system can be reviewed before local evidence is approved. The notice prevents an illustrative review page from being mistaken for a current Lagos directory.',
    },
  ] satisfies readonly FaqEntry[],
} as const
