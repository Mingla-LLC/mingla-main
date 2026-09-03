import type { FaqEntry, SourceEntry } from './shared'

export const PLAN_FIT_STATUSES = [
  'Not checked',
  'Works for this plan',
  'Needs confirmation',
  'Does not work',
] as const

export type PlanFitStatus = (typeof PLAN_FIT_STATUSES)[number]

export interface PlanFitRow {
  readonly id: string
  readonly label: string
  readonly question: string
  readonly ready: string
  readonly caution: string
  readonly sourceReminder: string
  readonly nextAction: string
}

export const EXPLORER_EVENT_GUIDE = {
  futurePath: '/guides/how-to-choose-an-event-this-weekend',
  eyebrow: 'Mingla Explorer guide',
  title: 'Events near you this weekend: 8 checks before you commit',
  description:
    'Use Mingla’s eight-part Plan Fit Check to compare weekend events by people, mood, timing, total cost, travel, entry, comfort and source truth.',
  answer: [
    'Do not begin with the longest list of events. Begin with the plan.',
    'A good weekend event fits the people coming, the mood, the exact time, the full known cost, the journey, the entry rules and the comfort needs that matter. It also has a source you trust, a recent verification date and a backup if one uncertain detail changes.',
    'Use the eight checks below. An event does not need to be perfect. It needs to be clear enough for this group to choose.',
  ],
  checks: [
    {
      id: 'people',
      label: 'People and occasion',
      question: 'Who is coming, and what is this plan for?',
      ready: 'The event suits the group size and occasion.',
      caution: 'The plan assumes everyone wants the same kind of night.',
      sourceReminder: 'Ask the people coming; do not infer the occasion from an event label.',
      nextAction: 'Write one sentence describing who is coming and what the plan needs to do.',
    },
    {
      id: 'mood',
      label: 'Mood and energy',
      question: 'Quiet, social, celebratory, active, curious or spontaneous?',
      ready: 'The event’s format fits the energy people want.',
      caution: 'The description relies on vague hype instead of the actual experience.',
      sourceReminder: 'Use the organiser’s format and venue facts, not a stock photograph.',
      nextAction: 'Choose the energy before choosing the event category.',
    },
    {
      id: 'time',
      label: 'Date and time',
      question: 'What are the exact date, start, likely end and time zone?',
      ready: 'Everyone can arrive with enough time and understands the real schedule.',
      caution: 'Doors versus start is unclear, or the time zone is missing.',
      sourceReminder: 'Check the current organiser, venue or authorised ticket page.',
      nextAction: 'Confirm doors, start, likely finish, time zone and arrival buffer.',
    },
    {
      id: 'cost',
      label: 'Total known cost',
      question: 'Tickets, fees, transport, food, parking and add-ons—what is known and unknown?',
      ready: 'The group can accept the known total and see what remains unverified.',
      caution: '“Free” hides a required purchase, price is old, or fees appear only at the end.',
      sourceReminder: 'Separate published amounts, estimates, unknowns and optional costs.',
      nextAction: 'Add entry, required fees, travel and planned extras without guessing.',
    },
    {
      id: 'journey',
      label: 'Journey and place',
      question: 'Where exactly is it, how will people arrive and how does the area fit the plan?',
      ready: 'The location, travel time and meeting point work for the group.',
      caution: 'A wider city label hides the actual place or late return is unresolved.',
      sourceReminder: 'Keep the venue or meeting point at the source’s real granularity.',
      nextAction: 'Check arrival, meeting point, transfer time and last comfortable return.',
    },
    {
      id: 'entry',
      label: 'Action and entry',
      question: 'Booking, ticket, RSVP, guest list or door entry—which one is real?',
      ready: 'The organiser or authorised source explains how entry works.',
      caution: 'A flyer says “RSVP” but links nowhere, or a screenshot is offered as a ticket.',
      sourceReminder: 'Use the organiser, venue or authorised ticket source.',
      nextAction: 'Name the action and confirm what it actually secures.',
    },
    {
      id: 'comfort',
      label: 'Access, weather and comfort',
      question: 'Which mobility, sensory, seating, age, weather or indoor/outdoor facts matter?',
      ready: 'The facts that matter to this group are explicitly sourced.',
      caution: 'Accessibility, dress, age, safety, capacity or weather protection is being guessed.',
      sourceReminder: 'Contact the organiser or venue when a critical fact is absent.',
      nextAction: 'Mark the facts that are essential for this group and verify each one.',
    },
    {
      id: 'source',
      label: 'Source, freshness and backup',
      question: 'Who owns the fact, when was it checked and what is Plan B?',
      ready: 'The primary source is current and the group has one acceptable alternative.',
      caution: 'The only evidence is a copied list, old poster or unverified social repost.',
      sourceReminder: 'Save the primary source and the date important details were checked.',
      nextAction: 'Choose one backup that passes the same essential checks.',
    },
  ] satisfies readonly PlanFitRow[],
  resultDefinitions: [
    ['Strong fit', 'All eight checks work for this plan.'],
    ['Possible fit', 'No check fails, but at least one non-essential fact needs confirmation.'],
    ['Poor fit', 'At least one check does not work for this plan.'],
    ['Not enough evidence', 'An essential fact is unknown, or the worksheet is incomplete.'],
  ],
  editorialGroups: [
    {
      id: 'fit',
      eyebrow: 'Fit',
      title: 'Name the people, the job and the energy first.',
      paragraphs: [
        '“Something fun” is too vague to choose well. Try one sentence: “We need a two-hour plan for four friends who want to talk, do something different and finish before the last comfortable journey home.”',
        'A concert, market, class, match, festival or exhibition can each feel calm or intense. Choose the energy first: quiet, social, celebratory, active, curious or spontaneous. Use the organiser’s description, format and venue facts—not promotional adjectives alone.',
      ],
    },
    {
      id: 'practical-truth',
      eyebrow: 'Practical truth',
      title: 'Turn “this weekend” into a real clock, cost and journey.',
      paragraphs: [
        'Confirm the calendar date, doors or opening time, event start, expected finish or last entry, time zone, arrival buffer, travel time before and after, and any fixed reservation around it.',
        'Price the complete known plan: entry + required fees + transport + planned food or drink + required equipment or add-ons. Label each amount Known, Estimated, Not verified or Optional. Never infer that an event is free because no price is shown.',
        'A city name does not tell you whether the journey works. Check the exact venue or meeting point, the neighbourhood or borough where relevant, the arrival method, transfer time and the return journey.',
      ],
    },
    {
      id: 'safe-commitment',
      eyebrow: 'Safe commitment',
      title: 'Know the action, the comfort facts and the backup.',
      paragraphs: [
        'Booking, ticket, RSVP, guest list and door entry are not interchangeable. Read the organiser’s exact wording and confirm what the action secures.',
        'Verify the mobility, sensory, seating, age, weather, indoor/outdoor, bag, dress or support facts that matter to your group. If the primary source does not say, contact the organiser or venue. Do not convert silence into “yes.”',
        'Save the primary source with the plan and record when the important details were checked. Choose one acceptable backup before the group commits.',
      ],
    },
  ],
  safetyChecks: [
    'Pause if an unexpected invitation asks for an email password, account login or one-time code merely to reveal the event.',
    'Check a domain that imitates a known organiser or ticket company through a separate trusted route.',
    'Do not treat a screenshot as a ticket when the issuer uses controlled digital delivery.',
    'Do not let urgency replace basic event details, delivery timing, refund handling or payment protections.',
    'Mingla does not guarantee an external seller. Follow the primary organiser and authorised action.',
  ],
  demoChoices: [
    ['Rooftop film', '7:30 pm · fixed ticket', 'Weather plan and step-free access not verified', 'Possible fit; verify two critical facts before paying'],
    ['Small theatre show', '6:00 pm · reserved seats', 'Total food and transport budget still estimated', 'Strong fit if the complete budget works'],
    ['Outdoor music session', 'From 4 pm · no listed price', 'Finish, price, entry and weather cover unverified', 'Not enough evidence yet'],
  ],
  minglaSteps: [
    'Discover a current place or event.',
    'Inspect source and action details.',
    'Save or compare an option.',
    'Share or coordinate the plan using the supported workflow.',
    'Take the real reservation, RSVP or ticket action when available.',
  ],
  finalChecklist: [
    'The people and occasion are clear.',
    'The mood fits.',
    'The date, start, likely end and time zone are clear.',
    'The complete known cost works; unknowns are labelled.',
    'The exact place and journey work.',
    'The action and entry rules are real.',
    'Relevant access, age, weather and comfort facts are sourced.',
    'The source is current and there is one acceptable backup.',
  ],
  faqs: [
    {
      question: 'How many events should I compare?',
      answer: 'Usually three genuinely different options are enough to expose the trade-offs. More results do not automatically improve the decision.',
    },
    {
      question: 'What if an event has no price listed?',
      answer: 'Treat it as “Price not verified.” Check the organiser or authorised action before assuming it is free.',
    },
    {
      question: 'Does an RSVP guarantee entry?',
      answer: 'Not always. Read the organiser’s exact wording and conditions.',
    },
    {
      question: 'Can Mingla guarantee an event is available?',
      answer: 'No. Mingla can show reviewed information and the real action where available, but organisers, venues and third parties can change details.',
    },
    {
      question: 'What should I do if details conflict?',
      answer: 'Prefer the current primary organiser, venue or authorised action source. If the conflict changes the decision, wait for clarification or choose the backup.',
    },
  ] satisfies readonly FaqEntry[],
  sources: [
    {
      label: 'Tips, hints or advice for buying tickets',
      publisher: 'Ticketmaster Help',
      href: 'https://help.ticketmaster.com/hc/en-us/articles/9781745448977-Tips-hints-or-advice-for-buying-tickets',
    },
    {
      label: 'How to make your ticket-buying experience scam-free',
      publisher: 'U.S. Federal Trade Commission',
      href: 'https://consumer.ftc.gov/consumer-alerts/2026/03/how-make-your-world-cup-experience-scam-free',
    },
    {
      label: 'Unexpected party invitation credential warning',
      publisher: 'U.S. Federal Trade Commission',
      href: 'https://consumer.ftc.gov/consumer-alerts/2026/05/asked-enter-your-email-address-and-password-open-party-invite-thats-scam',
    },
  ] satisfies readonly SourceEntry[],
} as const
