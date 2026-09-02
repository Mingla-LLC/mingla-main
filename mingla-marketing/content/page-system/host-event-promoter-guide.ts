import type { FaqEntry, SourceEntry } from './shared'

export const LAUNCH_TASK_STATUSES = [
  'Not started',
  'Ready',
  'Needs attention',
  'Not applicable',
] as const

export type LaunchTaskStatus = (typeof LAUNCH_TASK_STATUSES)[number]

export interface LaunchPhase {
  readonly id: string
  readonly label: string
  readonly title: string
  readonly tasks: readonly string[]
  readonly guard?: string
}

export const HOST_EVENT_PROMOTER_GUIDE = {
  futurePath: '/guides/event-promotion-checklist',
  eyebrow: 'Mingla Host guide',
  title: 'Event promotion checklist: 30 days from launch to the door',
  description:
    'Use a practical 30-day event-promotion timeline to build a decision-ready page, launch the right channels, prepare entry and measure what actually happened.',
  answer: [
    'Event promotion is not “post more.”',
    'A useful campaign gives the right people one clear event truth, one real action and enough reminders to decide—then prepares the organiser to honour that promise at the door.',
  ],
  answerSteps: [
    'Define the event outcome and the audience.',
    'Publish a decision-ready event page.',
    'Choose channels by job, not habit.',
    'Keep every campaign tied to the same source and action.',
    'Rehearse ticket, RSVP, guest-list and entry exceptions.',
    'Measure real buyer and attendee outcomes.',
    'Follow up only with appropriate permission.',
  ],
  outcomeGuidance: [
    'Name the event owner, operational capacity and its source.',
    'Define the ticket, RSVP or booking owner and one primary action.',
    'Describe the intended audience without sensitive profiling.',
    'Name the campaign, support, door and incident-escalation owners.',
    'Record only the real metrics the team can currently verify.',
  ],
  pageTruth: [
    'Exact event name and organiser.',
    'Date, doors or arrival, start, likely end and time zone where known.',
    'Venue or online state and exact location detail.',
    'What happens, who it is for and what remains unknown.',
    'Verified price and all-in buyer wording where applicable.',
    'The real ticket, RSVP, reservation, guest-list or door state.',
    'Age, access, weather, dress, bag, refund or cancellation facts only when sourced.',
    'Current image rights, contact or correction route, review and expiry dates.',
  ],
  factSource: [
    'Canonical event URL.',
    'Approved short and long descriptions.',
    'Approved name, organiser, date, time zone and location wording.',
    'Approved price and action wording.',
    'Rights-cleared creative and permitted sponsor or partner wording.',
    'Sourced access and age wording.',
    'Cancellation or change owner and customer-support route.',
    'One privacy-safe campaign naming convention.',
  ],
  channels: [
    ['Organiser or venue page', 'Canonical details and action', 'Vague teaser with no complete destination', 'Current event fact owner'],
    ['Email', 'Reach people who appropriately expect messages', 'Bought or scraped list, or hidden sender', 'Permission, sender identity, useful subject and action'],
    ['Organic social', 'Show format, energy, people and updates', 'Posting identical flyers repeatedly', 'Rights, approved claims and a destination'],
    ['Creator or partner', 'Reach a relevant community through a disclosed relationship', 'Scripted “independent” praise', 'Relationship, approval, permitted claims and tracking'],
    ['Paid social or search', 'Reach a defined audience within platform rules', 'Paying to amplify an unclear page', 'Landing-page parity, spend owner and stop rule'],
    ['Local calendar or community', 'Qualified discovery in the correct city and category', 'Directory blasting', 'Eligibility, boundary and current source'],
    ['Host or attendee sharing', 'Give interested people a trustworthy share path', 'Phishing-like invite or credential request', 'Real sender, event identity and safe action'],
    ['On-site, print or QR', 'Move physical attention to the canonical page', 'QR to an expired or generic homepage', 'Tested destination and fallback text'],
  ],
  utmGuidance: [
    ['utm_source', 'Platform or referrer, lower case'],
    ['utm_medium', 'Channel type, lower case'],
    ['utm_campaign', 'Stable event or campaign identifier'],
    ['utm_content', 'Creative or placement identifier'],
    ['utm_id', 'Stable campaign ID when the reporting stack uses one'],
  ],
  utmExample:
    '?utm_source=instagram&utm_medium=organic_social&utm_campaign=event_slug_2026&utm_content=artist_clip_01',
  phases: [
    {
      id: 'day-30',
      label: 'Day 30',
      title: 'Make the event publishable',
      tasks: [
        'Name the event outcome and audience.',
        'Confirm capacity, action and operational owner.',
        'Build the complete event page.',
        'Verify date, time zone, venue and price wording.',
        'Test the buyer action from a new browser or device context.',
        'Approve rights-cleared hero and social crops.',
        'Establish campaign naming and the correction or change owner.',
        'Record a backup route if the primary action fails.',
      ],
      guard: 'Do not launch promotion when the buyer cannot understand the event or complete the advertised action.',
    },
    {
      id: 'day-21',
      label: 'Day 21',
      title: 'Launch the story, not only the link',
      tasks: [
        'Publish the first full explanation: why this event, for whom, when and what to do.',
        'Give each selected channel one job.',
        'Check that every link reaches the same current event truth.',
        'Prepare common buyer questions from actual page gaps.',
        'Confirm partner or creator wording and disclosure.',
        'Capture a clean baseline of actions the current system can measure.',
        'Log unknowns instead of inventing answers.',
      ],
      guard: 'If attention arrives but the primary action does not, inspect the page and action before increasing volume.',
    },
    {
      id: 'day-14',
      label: 'Day 14',
      title: 'Answer the reasons people hesitate',
      tasks: [
        'Publish useful format, schedule, venue, arrival or experience detail.',
        'Show what a guest can expect using authorised media.',
        'Update FAQs from real questions.',
        'Recheck ticket or RSVP state, price and capacity wording.',
        'Review access and age information with the appropriate owner.',
        'Compare channel traffic with qualified action, not impressions alone.',
        'Pause or change a creative that creates the wrong expectation.',
      ],
      guard: 'Do not invent urgency, turnout, testimonials, scarcity or an “almost sold out” state.',
    },
    {
      id: 'day-7',
      label: 'Day 7',
      title: 'Move from marketing to operations',
      tasks: [
        'Reverify every material event fact.',
        'Send an appropriate reminder only to people eligible to receive it.',
        'Confirm door roles, devices, connectivity, power and backup.',
        'Use only the minimum guest information the door team needs.',
        'Rehearse supported ticket, RSVP, guest-list and QR flows.',
        'Define duplicate, missing, transfer, refund, late and access exception paths.',
        'Confirm the support and escalation owner.',
        'Prepare a visible update process for material changes.',
      ],
      guard: 'Campaign growth cannot compensate for a door workflow the team has not tested.',
    },
    {
      id: 'day-3',
      label: 'Day 3',
      title: 'Publish only useful urgency',
      tasks: [
        'Recheck real availability or capacity state.',
        'State a deadline only if it exists and has a source.',
        'Tell attendees what they need for arrival and entry.',
        'Confirm venue, time zone, weather and transport changes.',
        'Stop outdated creatives and scheduled posts.',
        'Verify the canonical page on mobile and without fragile animation.',
        'Run the entry rehearsal again.',
      ],
      guard: 'Do not use a generic countdown to imply scarcity.',
    },
    {
      id: 'day-1',
      label: 'Day 1',
      title: 'Freeze the event truth',
      tasks: [
        'Verify date, doors or start, place, action and support route.',
        'Make the final attendee message concise and operational.',
        'Confirm the guest-list or ticket source of truth and backup.',
        'Charge and update door devices.',
        'Confirm staff roles and privacy boundaries.',
        'Remove personal data from screenshots, demos and shared documents.',
        'Decide who can approve a material public change.',
      ],
    },
    {
      id: 'event-day',
      label: 'Event day',
      title: 'Keep promise and reality aligned',
      tasks: [
        'Check the public page and action before doors.',
        'Confirm venue readiness, staff handoff, entry and backup connectivity.',
        'Keep exception decisions with the authorised team member.',
        'Do not expose one guest’s information to another.',
        'Record material changes at the source.',
        'Capture media only with appropriate rights or permission.',
        'Do not manufacture crowd or satisfaction claims from a selective image.',
      ],
    },
    {
      id: 'day-plus-1',
      label: '+1',
      title: 'Close the loop',
      tasks: [
        'Update the event state so it is not presented as upcoming.',
        'Reconcile only the real outcomes the system can verify.',
        'Separate attendance, check-in, sales, RSVP and page engagement.',
        'Log broken links, stale facts, support issues and entry exceptions.',
        'Follow up only through an appropriate, expected channel.',
        'Preserve source and rights records.',
      ],
    },
    {
      id: 'day-plus-7',
      label: '+7',
      title: 'Decide what to repeat',
      tasks: [
        'Identify which source, medium and creative produced qualified actions.',
        'Record which page question remained unanswered.',
        'Find where people left the real action.',
        'Separate a useful reminder from added noise.',
        'Record repeated operational exceptions.',
        'Decide what to repeat, stop or change before the next event.',
        'Contact people again only with appropriate permission.',
      ],
      guard: 'Do not turn one event into a universal benchmark. Record the context.',
    },
  ] satisfies readonly LaunchPhase[],
  doorRehearsal: [
    ['Valid ticket or RSVP', 'What is the normal check-in path?'],
    ['Duplicate or previously used', 'Who decides, and where is the source checked?'],
    ['Name mismatch or transfer', 'What does the issuer or organiser permit?'],
    ['Missing from guest list', 'Which current source can the team verify?'],
    ['Screenshot only', 'Is it accepted by the real issuer?'],
    ['Connectivity loss', 'What is the privacy-safe offline or backup method?'],
    ['Accessibility or support need', 'Who can respond without blocking or exposing the guest?'],
    ['Refund or cancellation dispute', 'Who owns the decision and communication?'],
    ['Material event change', 'How is the buyer page updated immediately?'],
  ],
  measurement: {
    explorer: [
      'Event page viewed.',
      'Useful detail or source opened.',
      'Share or plan action.',
      'Ticket, RSVP or booking action started.',
      'Verified completion only where the system owns or receives that fact.',
    ],
    host: [
      'Event created or published.',
      'Campaign link used.',
      'Qualified action.',
      'Guest workflow reached.',
      'Supported check-in or outcome record.',
      'Repeat event or appropriate follow-up.',
    ],
    failures: [
      'Stale or conflicting event fact.',
      'Broken destination or wrong city.',
      'Unsupported claim or unverified price or action.',
      'Source or rights failure.',
      'Entry exception that reveals a product or content gap.',
    ],
  },
  minglaFlow: ['Event page', 'Channels', 'One supported action', 'Door workflow', 'Learning'],
  demo: {
    eventPage: ['Clear event facts', 'One supported action', 'Unknowns labelled'],
    campaign: ['Channel has one job', 'Facts point to one source', 'No invented urgency'],
    guestFlow: ['Guest-list source', 'Supported QR entry', 'Exception owner'],
  },
  beforeAfter: [
    ['Before', 'Fragmented flyer', 'Facts drift between posts, links and messages.', 'Several competing actions'],
    ['After', 'One decision-ready truth', 'Channels return to the same current facts.', 'One supported action and rehearsed entry'],
  ],
  masterChecklist: [
    ['Truth', 'One canonical event page; owner, date, venue, action, price, status, unknowns and rights recorded.'],
    ['Campaign', 'Outcome and audience defined; channels chosen by purpose; naming, disclosures and stop rules clear.'],
    ['Buyer', 'The page answers the decision questions; mobile action and material-change path tested.'],
    ['Door', 'Roles, exceptions, devices, connectivity, backup, data minimum and support path rehearsed.'],
    ['Learning', 'Real outcomes separated; stale facts logged; event state and permission-safe follow-up updated.'],
  ],
  faqs: [
    {
      question: 'Does every event need a 30-day campaign?',
      answer: 'No. The sequence matters more than the number. A shorter launch compresses the timeline but still needs a complete event truth, tested action and door plan.',
    },
    {
      question: 'Which channel should I use first?',
      answer: 'Use the channel that can reach the intended audience and lead to the canonical action. Do not add channels the team cannot keep accurate or measure.',
    },
    {
      question: 'Should I post every day?',
      answer: 'Not by default. Publish when the message answers a decision question, shows what to expect, reports a real update or appropriately reminds an interested person.',
    },
    {
      question: 'Can AI write the campaign?',
      answer: 'AI can assist with drafts and variants, but the organiser must verify dates, place, prices, capacity, access, relationships, policies and results.',
    },
    {
      question: 'Does Mingla guarantee ticket sales or attendance?',
      answer: 'No. Mingla Host can support a clearer event page and connected workflow; the event, audience, operations and external conditions still matter.',
    },
  ] satisfies readonly FaqEntry[],
  sources: [
    {
      label: 'Campaign URL Builder parameters',
      publisher: 'Google Analytics Help',
      href: 'https://support.google.com/analytics/answer/10917952',
    },
  ] satisfies readonly SourceEntry[],
} as const
