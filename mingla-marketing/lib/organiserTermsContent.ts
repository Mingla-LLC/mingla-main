// #3645 — Mingla Organiser Terms, the published website copy.
//
// Source: the product-approved draft v1 (Seth, 1 October 2026). This module
// renders ONLY the clauses that are true today. Every clause the draft holds
// back until its feature ships is left out, and the draft's editor notes never
// render (scripts/issue-3645-organiser-terms.*.test.mjs enforces both).
//
// Section numbers are fixed. Sections 10 (ads) and 12 (the hosts' forum) are
// wholly held, so the published list jumps 9 → 11 and 11 → 13.
// That is deliberate: when a held section ships it slots back in under its own
// number and no other section is renumbered, so a citation like "section 17"
// means the same thing in every version.
//
// Inline `**bold**` is the only markup; the page renders it as <strong>.

export const ORGANISER_TERMS_LAST_UPDATED = '1 October 2026'
export const ORGANISER_TERMS_VERSION = '1.0'

export type OrganiserTermsBlock =
  | Readonly<{ type: 'paragraph'; lead?: string; text: string }>
  | Readonly<{ type: 'list'; items: readonly string[] }>

export interface OrganiserTermsSection {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly blocks: readonly OrganiserTermsBlock[]
}

export interface OrganiserTermsCompany {
  readonly name: string
  readonly who: string
  readonly registration: string | null
  readonly address: string
  readonly law: string
}

export const ORGANISER_TERMS_COMPANIES: readonly OrganiserTermsCompany[] = [
  {
    name: 'UseMingla Limited',
    who: 'Nigeria, paid through Paystack',
    registration:
      'Private company limited by shares, registered in Nigeria under the Companies and Allied Matters Act 2020, RC 9591121',
    address:
      'No 1, Fortune Avenue, Off Omumah Pipeline Road, Igwuruta, Port Harcourt, Rivers State, Nigeria',
    law: 'Nigerian law · Nigerian courts',
  },
  {
    name: 'Mingla LLC',
    who: 'Everyone else, paid through Stripe',
    registration: null,
    address: '700 Corporate Center Dr, Raleigh, NC 27607, USA',
    law: 'North Carolina law · AAA arbitration',
  },
]

export const ORGANISER_TERMS_SECTIONS: readonly OrganiserTermsSection[] = [
  {
    id: 'words-we-use',
    number: null,
    title: 'Words we use',
    blocks: [
      {
        type: 'list',
        items: [
          '**"Mingla", "we", "us"** means the Mingla company you contract with under section 1.',
          '**"You"** means the person who accepts these terms, and the Brand they act for.',
          '**"Brand"** means the organiser profile you run in Mingla Host, including its team members.',
          '**"Buyer"** means anyone who buys, books, reserves or RSVPs with your Brand through Mingla.',
          '**"Payment provider"** means Stripe or Paystack, whichever processes your Brand\'s payments.',
        ],
      },
      {
        type: 'paragraph',
        text: 'These Organiser Terms apply when you use Mingla Host to list, sell, message or advertise. They add to Mingla\'s general Terms of Service and Privacy Policy. Where they conflict, these Organiser Terms apply to your use of Mingla Host.',
      },
      {
        type: 'paragraph',
        lead: 'How you accept these terms.',
        text: 'You accept these terms by ticking "I agree" in Mingla Host before you connect a payout account. Each team member who accepts does so for themselves and on behalf of the Brand. We record the version you accepted and when.',
      },
    ],
  },
  {
    id: 'section-1',
    number: 1,
    title: "Who you're agreeing with",
    blocks: [
      {
        type: 'paragraph',
        text: 'Your agreement is with one of two Mingla companies, depending on where you are and how you are paid.',
      },
      {
        type: 'list',
        items: [
          '**Nigeria.** If your Brand is based in Nigeria and is paid through Paystack, or you pay Mingla through Paystack, your agreement is with **UseMingla Limited**, a private company limited by shares registered in Nigeria under the Companies and Allied Matters Act 2020 (RC 9591121), whose registered office is at No 1, Fortune Avenue, Off Omumah Pipeline Road, Igwuruta, Port Harcourt, Rivers State, Nigeria. Nigerian law applies (section 17).',
          '**Everyone else.** In every other case, your agreement is with **Mingla LLC**, 700 Corporate Center Dr, Raleigh, NC 27607, USA. North Carolina law applies (section 17).',
        ],
      },
      {
        type: 'paragraph',
        text: 'If you use both, each company is responsible only for the services it provides to you.',
      },
    ],
  },
  {
    id: 'section-2',
    number: 2,
    title: 'Your account and your Brand',
    blocks: [
      {
        type: 'paragraph',
        text: 'You must be **18 or older** and able to enter into a binding contract. You do not need to be a registered business. Individuals who organise events, experiences or trips are welcome.',
      },
      {
        type: 'paragraph',
        text: 'Each Brand has one Account Owner. The Owner can invite team members, give them roles, and hand the Brand to a new Owner. When ownership moves, the previous Owner loses access to the Brand.',
      },
      {
        type: 'paragraph',
        text: 'You are responsible for everything your team does in Mingla Host. Keep your Brand, tax and bank details accurate and up to date. If you think someone has got into your account without permission, tell us straight away at support@usemingla.com.',
      },
    ],
  },
  {
    id: 'section-3',
    number: 3,
    title: 'What you can sell',
    blocks: [
      {
        type: 'paragraph',
        text: 'You may list real events, experiences, trips, stays, reservations and venue orders that you have the right to offer.',
      },
      {
        type: 'paragraph',
        text: "You must hold every licence, permit, insurance and venue permission your listing needs. Describe it honestly: the date, place, price, age limits, what's included and your refund policy.",
      },
      {
        type: 'paragraph',
        text: 'We may refuse, hide or remove any listing, and pause its sales, if we reasonably believe it breaks these terms or the law.',
      },
    ],
  },
  {
    id: 'section-4',
    number: 4,
    title: 'Pricing and fees',
    blocks: [
      {
        type: 'paragraph',
        lead: 'You set your prices.',
        text: 'You choose whether Buyers see one all-in price or a price plus fees. Either way, Buyers see the full amount before they pay.',
      },
      {
        type: 'paragraph',
        lead: "Mingla's fee.",
        text: 'Mingla charges a service fee on each paid sale. The current rate is shown in Mingla Host before you publish and on every payout breakdown.',
      },
      {
        type: 'paragraph',
        lead: 'Other costs.',
        text: 'Payment provider processing costs are taken from your payouts as shown in your breakdown. In Nigeria, bank transfer fees and stamp duty are also deducted (section 8).',
      },
      {
        type: 'paragraph',
        lead: 'Fee changes.',
        text: "We will give you at least 30 days' notice before raising our fee (section 16). A higher fee never applies to sales already made.",
      },
      {
        type: 'paragraph',
        lead: 'Taxes.',
        text: 'You are responsible for the taxes on your sales and income, and for any tax settings in your payout account.',
      },
    ],
  },
  {
    id: 'section-5',
    number: 5,
    title: 'You are the seller',
    blocks: [
      {
        type: 'paragraph',
        text: 'When a Buyer buys from you on Mingla, **you are the seller**. The contract for the event, experience, trip or order is between you and the Buyer.',
      },
      {
        type: 'paragraph',
        text: 'On Stripe, each sale is made directly on your own Stripe account. In Nigeria, UseMingla Limited collects the payment and transfers it to you (section 8), but you are still the seller.',
      },
      {
        type: 'paragraph',
        text: 'Mingla provides the platform and arranges payment. Mingla is not the organiser, venue or seller of your listing.',
      },
      { type: 'paragraph', text: 'You must:' },
      {
        type: 'list',
        items: [
          'deliver what you sold, as described;',
          "follow the refund policy shown on the listing when the Buyer bought. Once a listing has paid sales, you can change its refund policy only in the Buyer's favour, and Mingla Host enforces this;",
          "respect Buyers' consumer rights under the law where you sell, including refunds when you cancel, move or materially change a listing; and",
          'run your listing safely and lawfully.',
        ],
      },
    ],
  },
  {
    id: 'section-6',
    number: 6,
    title: 'Payments and payouts',
    blocks: [
      {
        type: 'paragraph',
        lead: 'Stripe.',
        text: 'Buyer payments go into your own Stripe account. About a day after each payment, once Stripe has made the money available, it is released and Stripe pays it to your bank. It usually arrives within 1 to 2 business days, and can take longer for a first payout or if your bank is slow.',
      },
      {
        type: 'paragraph',
        lead: 'Paystack (Nigeria).',
        text: 'Buyer payments are collected by UseMingla Limited for you. About a day after each payment, once Paystack has settled the money, we transfer it to your verified bank account, minus the transfer fee and stamp duty.',
      },
      {
        type: 'paragraph',
        lead: 'Timing.',
        text: "Payout timing depends on the Payment provider and on banks. We can't guarantee an exact arrival date.",
      },
      {
        type: 'paragraph',
        lead: 'Payment provider terms.',
        text: "If you are paid through Stripe, you also agree to the Stripe Connected Account Agreement. If you are paid through Paystack, you also agree to Paystack's terms that apply to you. We share the details needed to verify you and pay you with your Payment provider.",
      },
    ],
  },
  {
    id: 'section-7',
    number: 7,
    title: 'Refunds, cancellations and chargebacks',
    blocks: [
      {
        type: 'paragraph',
        text: '**You are responsible for refunds and chargebacks** on your sales, including after you have been paid.',
      },
      {
        type: 'paragraph',
        lead: "Mingla's fee on refunds.",
        text: 'If a refund happens because of you (for example, you cancel, change or fail to deliver a listing, you choose to refund a Buyer, or a Buyer wins a chargeback against you), Mingla keeps its service fee. If a refund happens because Mingla made an error, we return our fee to you.',
      },
      {
        type: 'paragraph',
        lead: 'Chargebacks.',
        text: 'We may respond to a dispute for you using the information you give us. If you lose a dispute, the disputed amount is yours. Where Mingla is charged a dispute fee by the Payment provider, we pass that fee on to you **only if the dispute is lost**, at the provider\'s cost, with no Mingla mark-up. If the dispute is won, you pay nothing to Mingla. On Stripe, disputes are handled in your own Stripe account and any fees Stripe charges you there are set by your Stripe agreement, not by Mingla.',
      },
    ],
  },
  {
    id: 'section-8',
    number: 8,
    title: 'Nigeria',
    blocks: [
      {
        type: 'paragraph',
        text: 'This section applies to Brands paid through Paystack, whose agreement is with UseMingla Limited.',
      },
      {
        type: 'paragraph',
        lead: 'Collect and transfer.',
        text: 'UseMingla Limited receives Buyer payments on your behalf and holds them only until they are transferred to you under section 6.',
      },
      {
        type: 'paragraph',
        lead: 'Bank name match.',
        text: "When you add a bank account, we check with Paystack that the account holder's name matches your name or your business's registered name. We pay out only to a matching account.",
      },
      {
        type: 'paragraph',
        lead: 'Identity checks.',
        text: 'We may ask for more identity or business documents at any time, including your BVN or CAC registration, where the law or our payment partners require it. We may hold payouts until we receive them.',
      },
      {
        type: 'paragraph',
        lead: 'Transfer costs.',
        text: 'Transfer fees, and the ₦50 stamp duty on transfers of ₦10,000 or more, are deducted from each payout. Each transfer is between ₦50 and ₦10,000,000; larger amounts are split into several transfers.',
      },
    ],
  },
  {
    id: 'section-9',
    number: 9,
    title: 'Buyer data, messaging and followers',
    blocks: [
      {
        type: 'paragraph',
        lead: 'Who is responsible for Buyer data.',
        text: 'When Buyers buy, book or RSVP with you, you receive their name and contact details in your contact book. For the Buyer data you receive, **you are the controller**: you decide how you use it, and you must have your own privacy notice. Mingla is a separate controller for its own platform.',
      },
      {
        type: 'paragraph',
        lead: 'How you may use it.',
        text: "Use Buyer data only to run your listings and to send messages through Mingla Host, and only as the law and each Buyer's choices allow. Never export Buyer data to message people outside Mingla without their separate consent.",
      },
      {
        type: 'paragraph',
        lead: 'Your messages.',
        text: 'You are responsible for what you send: its content, its timing, and following marketing and privacy law where your recipients live.',
      },
    ],
  },
  {
    id: 'section-11',
    number: 11,
    title: 'Ari and AI help',
    blocks: [
      {
        type: 'paragraph',
        text: "Ari is Mingla's AI assistant. It can draft listings, prices, messages and plans and, with your confirmation, make changes in Mingla Host for you.",
      },
      {
        type: 'paragraph',
        text: 'Ari can make mistakes. Check what it proposes before you confirm. Anything you confirm counts as your own action, and you are responsible for it. Ari never makes changes without asking you first.',
      },
      {
        type: 'paragraph',
        text: 'What you share with Ari is processed by Mingla and its AI providers to run the service.',
      },
    ],
  },
  {
    id: 'section-13',
    number: 13,
    title: 'Your content and the licence you give Mingla',
    blocks: [
      {
        type: 'paragraph',
        text: 'You keep ownership of your Brand name, logo, photos, videos, descriptions and other content.',
      },
      {
        type: 'paragraph',
        lead: 'To run Mingla.',
        text: 'You give Mingla a worldwide, non-exclusive, royalty-free licence to host, copy, adapt (for example resize, crop, translate or caption), display and share your content so we can run Mingla, including your public pages, the Mingla app, search and sharing cards.',
      },
      {
        type: 'paragraph',
        lead: "Mingla's own marketing.",
        text: "You also allow Mingla to use your content in **Mingla's own marketing and ads**, and only there. This lasts while the content is live on Mingla, plus 90 days. You can ask us to stop using any specific item in Mingla's marketing at any time by writing to support@usemingla.com, and we will stop.",
      },
      {
        type: 'paragraph',
        text: 'You confirm you have every right needed for your content, including permission from people who appear in it and from any music owner.',
      },
    ],
  },
  {
    id: 'section-14',
    number: 14,
    title: 'Suspension and ending this agreement',
    blocks: [
      {
        type: 'paragraph',
        lead: 'You can stop',
        text: 'using Mingla Host at any time. Listings you have already sold must still be delivered or refunded.',
      },
      {
        type: 'paragraph',
        lead: 'We may suspend or close',
        text: 'your Brand, remove listings, or pause payouts if you break these terms, if we reasonably suspect fraud or harm to Buyers, or if the law or a Payment provider requires it. Where we can, we will tell you why and give you a chance to fix the problem first.',
      },
      {
        type: 'paragraph',
        text: 'The sections on fees and money owed, refunds and chargebacks, Buyer data, licences, liability and disputes continue after this agreement ends.',
      },
    ],
  },
  {
    id: 'section-15',
    number: 15,
    title: 'Liability',
    blocks: [
      {
        type: 'paragraph',
        lead: 'The service.',
        text: 'Mingla provides Mingla Host "as is". We work to keep it running, but we don\'t promise it will be uninterrupted or error-free.',
      },
      {
        type: 'paragraph',
        lead: "What we're not liable for.",
        text: 'We are not liable for lost profits, lost revenue, lost data, or indirect or consequential losses.',
      },
      {
        type: 'paragraph',
        lead: 'Our cap.',
        text: 'Our total liability to you is limited to the higher of:',
      },
      {
        type: 'list',
        items: [
          'the fees you paid to Mingla in the 3 months before the event that gave rise to the claim; or',
          'US$500 (or the equivalent in your local currency).',
        ],
      },
      {
        type: 'paragraph',
        lead: "What the cap doesn't cover.",
        text: 'Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else the law does not allow us to limit.',
      },
      {
        type: 'paragraph',
        lead: 'You cover Mingla.',
        text: 'You will cover Mingla for claims, losses and costs arising from your listings, your content, your messages, your use of Buyer data, your ads, or your breach of these terms or the law.',
      },
    ],
  },
  {
    id: 'section-16',
    number: 16,
    title: 'Changes to these terms',
    blocks: [
      { type: 'paragraph', text: 'We may change these terms at any time.' },
      {
        type: 'list',
        items: [
          '**Changes that make things worse for you** (for example, a higher fee, slower payouts or more responsibility for refunds) take effect **at least 30 days** after we tell you.',
          '**Changes required by law, or needed for safety or security**, can take effect straight away.',
        ],
      },
      {
        type: 'paragraph',
        text: "If you don't agree with a change, you can stop using Mingla Host before it takes effect.",
      },
    ],
  },
  {
    id: 'section-17',
    number: 17,
    title: 'Governing law and disputes',
    blocks: [
      {
        type: 'list',
        items: [
          '**Mingla LLC:** if your agreement is with Mingla LLC, it is governed by the laws of the State of North Carolina, USA.',
          '**UseMingla Limited:** if your agreement is with UseMingla Limited, it is governed by the laws of the Federal Republic of Nigeria.',
        ],
      },
      {
        type: 'paragraph',
        lead: 'Talk to us first.',
        text: 'Before starting any formal claim, contact support@usemingla.com. We will try to resolve the issue with you within 30 days.',
      },
      {
        type: 'paragraph',
        lead: 'Mingla LLC: arbitration.',
        text: "If your agreement is with Mingla LLC and we can't resolve a dispute informally, it will be settled by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules, before a single arbitrator, seated in Wake County, North Carolina. Hearings may be held by video. Either of us may instead bring an individual claim in small claims court if it qualifies. Claims are brought only individually, never as part of a class or representative action. Either of us may ask a court for urgent relief to protect intellectual property or stop misuse of the service.",
      },
      {
        type: 'paragraph',
        lead: 'UseMingla Limited: Nigerian courts.',
        text: "If your agreement is with UseMingla Limited and we can't resolve a dispute informally, the courts of Nigeria have exclusive jurisdiction.",
      },
      {
        type: 'paragraph',
        lead: 'Local protections.',
        text: 'Nothing in this section removes any protection the law where your Brand is based gives you and that cannot be excluded by contract.',
      },
    ],
  },
  {
    id: 'section-18',
    number: 18,
    title: 'Contact',
    blocks: [
      {
        type: 'paragraph',
        text: 'Questions about these terms, your payouts or your account: **support@usemingla.com**.',
      },
      {
        type: 'list',
        items: [
          'Mingla LLC, 700 Corporate Center Dr, Raleigh, NC 27607, USA',
          'UseMingla Limited (RC 9591121), No 1, Fortune Avenue, Off Omumah Pipeline Road, Igwuruta, Port Harcourt, Rivers State, Nigeria',
        ],
      },
    ],
  },
]

export function organiserTermsHeading(section: OrganiserTermsSection): string {
  return section.number === null ? section.title : `${section.number}. ${section.title}`
}
