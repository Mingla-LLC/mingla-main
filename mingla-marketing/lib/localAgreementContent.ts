// #4182 — the complete, versioned Nigeria Mingla Local agreement.
// The canonical text below is fingerprinted and the same version, URL and
// digest are published by the release migration used by applicant signing.

export const LOCAL_AGREEMENT_VERSION = 'local-ng-1.0'
export const LOCAL_AGREEMENT_LAST_UPDATED = '29 October 2026'
export const LOCAL_AGREEMENT_STATUS = 'Effective 29 October 2026'
export const LOCAL_AGREEMENT_SHA256 =
  '65d2ac74f256dc9bf013aa56afced7f15210083854e471e89f8d7ddce255a954'

export type LocalAgreementBlock =
  | Readonly<{ type: 'paragraph'; lead?: string; text: string }>
  | Readonly<{ type: 'list'; items: readonly string[] }>

export interface LocalAgreementSection {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly blocks: readonly LocalAgreementBlock[]
}

export const LOCAL_AGREEMENT_SECTIONS: readonly LocalAgreementSection[] = [
  {
    id: 'plain-language-summary',
    number: null,
    title: 'Plain-language summary',
    blocks: [
      {
        type: 'paragraph',
        text: 'This summary helps you understand the programme, but the numbered sections below are the agreement. You choose one eligible place in your city each month, visit as a normal customer, create an honest written and video review, post the same finished video on your social account with Mingla invited as a collaborator, and submit everything to Mingla for review.',
      },
      {
        type: 'list',
        items: [
          'You are an **independent contractor**, not a Mingla employee or an agent of the place.',
          'The place does not choose, approve, pay for or veto your review.',
          'Your city programme shows your monthly fee before you sign. Payment is earned only for a complete month that Mingla accepts and publishes.',
          'You keep ownership of your work and give Mingla the content and likeness rights described in section 8, including use on the place card and in Mingla marketing.',
          'Only you can accept this agreement. Mingla records your typed legal name, the agreement version, its fingerprint and the time you accepted it.',
        ],
      },
    ],
  },
  {
    id: 'section-1',
    number: 1,
    title: 'Parties and acceptance',
    blocks: [
      {
        type: 'paragraph',
        text: 'This Mingla Local Agreement (the **"Agreement"**) is between **UseMingla Limited**, a private company limited by shares incorporated in Nigeria (RC 9591121), of No 1 Fortune Avenue, Off Omumah Pipeline Road, Igwuruta, Port Harcourt, Rivers State, Nigeria (**"Mingla"**, **"we"**, **"us"**), and the individual invited in Mingla Explorer to become a Mingla Local (**"you"**, the **"Local"**).',
      },
      {
        type: 'paragraph',
        lead: 'How the agreement is formed.',
        text: 'Mingla offers you a Local seat by sending the invitation in Mingla Explorer. You accept that offer by reading this Agreement, ticking the acceptance box and typing your full legal name. No Mingla Admin signs for you. Your electronic acceptance has the same effect as your handwritten signature.',
      },
      {
        type: 'paragraph',
        text: 'You must be at least 18 years old, have capacity to enter a binding contract, and provide accurate identity, contact, social-account, bank and tax information.',
      },
    ],
  },
  {
    id: 'section-2',
    number: 2,
    title: 'The Local programme',
    blocks: [
      {
        type: 'paragraph',
        text: 'Mingla engages you on a non-exclusive, rolling monthly basis to discover and review places in the city shown on your Local seat. A seat does not guarantee a minimum term, a minimum number of assignments or renewal for another month.',
      },
      {
        type: 'paragraph',
        text: 'You control how and when you perform the work within the programme deadlines and brief. You may work for others, provided that doing so does not create a conflict, compromise an honest review, misuse confidential information or breach this Agreement.',
      },
    ],
  },
  {
    id: 'section-3',
    number: 3,
    title: 'Choosing and visiting a place',
    blocks: [
      {
        type: 'list',
        items: [
          'Choose only a place that Mingla Explorer shows as eligible for your Local month and confirm the pick by the deadline shown in the app.',
          'Do not choose a place you own, manage, work for, represent, have a material financial interest in, or reviewed in another Local month unless Mingla expressly permits it.',
          'Visit as a normal customer. Do not ask the place to script, reward, approve, suppress or change the review.',
          'Follow the place rules and applicable law, obtain permission where filming requires it, and avoid recording people who have not consented.',
          'Pay your ordinary visit costs unless a written Mingla brief approves a specific reimbursable expense in advance. Places never pay you for a Mingla Local review.',
        ],
      },
    ],
  },
  {
    id: 'section-4',
    number: 4,
    title: 'Monthly deliverables and format',
    blocks: [
      {
        type: 'paragraph',
        text: 'For each Local month, you will submit one honest written review, the visit date and rating, at least one finished vertical video, and the public URL of the required social post. The app may permit additional supporting clips, but one finished video must contain the complete story.',
      },
      {
        type: 'paragraph',
        lead: 'Required video format.',
        text: 'The finished video should be approximately 30–60 seconds and must: (1) begin with the place card in your Mingla swipeable deck and show how you found the place; (2) show the arrival, atmosphere and genuine experience; (3) give an honest review of what you tried, what stood out, what could improve and who would enjoy it; and (4) end with your verdict, whether you would return, and an invitation to find the place on Mingla.',
      },
      {
        type: 'paragraph',
        text: 'Your account of the visit must be truthful and based on your real experience. Do not make claims you cannot support, conceal a material conflict, manipulate a rating, or present staged content as an independent visit.',
      },
    ],
  },
  {
    id: 'section-5',
    number: 5,
    title: 'Your social post and collaboration with Mingla',
    blocks: [
      {
        type: 'paragraph',
        text: 'Before submitting the month for approval, publish the same finished video on the social account you use for the programme, tag Mingla, and invite Mingla’s designated official account as a collaborator using the platform-native collaboration feature. Give Mingla the public post URL and keep the post available while Mingla reviews and pays the month, unless Mingla agrees otherwise in writing.',
      },
      {
        type: 'paragraph',
        text: 'Use all labels, paid-partnership tools and other notices required by applicable advertising law and the social platform. Claims must be truthful, clear and capable of substantiation.',
      },
    ],
  },
  {
    id: 'section-6',
    number: 6,
    title: 'Review, revisions and publication',
    blocks: [
      {
        type: 'paragraph',
        text: 'Mingla reviews the written review, the private submitted video and the public post. Mingla may accept the month or request reasonable changes needed to correct an error, meet the agreed format, protect privacy, comply with law or make the deliverable technically usable. Mingla will not require you to turn an honest negative opinion into a positive one.',
      },
      {
        type: 'paragraph',
        text: 'The reviewed place has no approval or veto right. When Mingla accepts the month, Mingla may publish the written review and approved video on the place’s expanded card and other Mingla surfaces under section 8.',
      },
    ],
  },
  {
    id: 'section-7',
    number: 7,
    title: 'Fee, expenses and payment',
    blocks: [
      {
        type: 'paragraph',
        lead: 'Monthly fee.',
        text: 'Your city programme and signing screen show the fee and currency for one complete accepted Local month. That displayed fee is incorporated into this Agreement for your seat. Mingla may change the rate for a future month by giving notice before that month begins; a change does not reduce a fee already earned.',
      },
      {
        type: 'paragraph',
        lead: 'When payment is earned.',
        text: 'The fee is earned after you complete every required deliverable, Mingla approves and publishes the review, the required social post is verified, and your payout account is ready. Incomplete, late, fraudulent, unrequested or unaccepted work is not payable. Mingla pays through the payout method shown in the app, subject to provider processing time.',
      },
      {
        type: 'paragraph',
        text: 'You are responsible for your own income tax and statutory contributions. Mingla may deduct and remit withholding tax where required and will provide the applicable record. Only expenses Mingla approved in writing before you incurred them are reimbursable.',
      },
    ],
  },
  {
    id: 'section-8',
    number: 8,
    title: 'Ownership, licence and likeness',
    blocks: [
      {
        type: 'paragraph',
        lead: 'Your ownership.',
        text: 'You keep ownership of original content you create, subject to the rights you grant below and any third-party rights in the material.',
      },
      {
        type: 'paragraph',
        lead: 'Licence to Mingla.',
        text: 'For each deliverable Mingla pays for, you grant Mingla and its affiliates a worldwide, perpetual, irrevocable, royalty-free, transferable and sublicensable licence to host, store, reproduce, publish, display, distribute, crop, resize, subtitle, translate, edit, re-cut, combine and otherwise adapt the deliverable for the Mingla apps and websites, the reviewed place’s expanded card, app-store materials, email, social media, partner and investor materials, publicity, promotion and paid or organic marketing.',
      },
      {
        type: 'paragraph',
        text: 'The licence includes your name, social handle, voice, image, likeness and performance as they appear in the paid deliverable. Mingla may credit you. Mingla may not use your likeness to create a materially false endorsement or a new synthetic performance you did not make.',
      },
      {
        type: 'paragraph',
        text: 'Mingla may keep the approved publication copy for the licensed uses. The private upload original is removed after successful processing when the media system confirms the approved derivative is available; lifecycle, dispute and legal-hold safeguards may delay deletion where necessary.',
      },
    ],
  },
  {
    id: 'section-9',
    number: 9,
    title: 'Third-party rights and permissions',
    blocks: [
      {
        type: 'paragraph',
        text: 'You must own or properly license every element you provide, including music, footage, photographs, fonts and artwork. You must obtain any person, location or property permission needed for Mingla and you to use the deliverable as this Agreement allows. Do not include confidential information or personal data you have no right to share.',
      },
    ],
  },
  {
    id: 'section-10',
    number: 10,
    title: 'Your promises',
    blocks: [
      {
        type: 'paragraph',
        text: 'You promise that your work is original or properly licensed; your statements are truthful and based on your real visit; you have authority to accept this Agreement and grant its rights; your work is lawful, non-defamatory and non-infringing; and performing it will not breach another agreement or duty.',
      },
    ],
  },
  {
    id: 'section-11',
    number: 11,
    title: 'Independent-contractor status',
    blocks: [
      {
        type: 'paragraph',
        text: 'You are an independent contractor, not an employee, worker, agent, partner or joint venturer of Mingla or the reviewed place. You have no authority to bind either one. You control the manner and means of your work, provide your ordinary equipment and internet, and receive no employee benefits.',
      },
    ],
  },
  {
    id: 'section-12',
    number: 12,
    title: 'Confidentiality and data protection',
    blocks: [
      {
        type: 'paragraph',
        text: 'Use Mingla’s non-public briefs, campaign plans, pricing, roadmap, security information and non-public data only to perform this Agreement. Do not disclose them. This duty lasts three years after the Agreement ends and indefinitely for trade secrets.',
      },
      {
        type: 'paragraph',
        text: 'Follow the Nigeria Data Protection Act 2023 and any other applicable data-protection law. Keep personal data secure, use it only as needed for the programme, and promptly tell Mingla about any suspected loss or unauthorised access. Mingla handles your account and signing data under its Privacy Policy.',
      },
    ],
  },
  {
    id: 'section-13',
    number: 13,
    title: 'Programme safety and conduct',
    blocks: [
      {
        type: 'paragraph',
        text: 'Act lawfully and professionally. Do not harass, threaten, discriminate against or endanger another person; impersonate Mingla or the place; solicit a bribe or undisclosed reward; buy fake engagement; manipulate programme eligibility; or misuse Mingla systems. Report a safety issue through Mingla support. In an emergency, contact local emergency services first.',
      },
    ],
  },
  {
    id: 'section-14',
    number: 14,
    title: 'Term, pause and termination',
    blocks: [
      {
        type: 'paragraph',
        text: 'This Agreement starts when you accept it and continues until either party ends it. Either party may end it on 14 days’ written notice. Mingla may pause assignments or end immediately for fraud, dishonesty, serious safety misconduct, infringement, unlawful content, manipulation, a material confidentiality or data breach, or another material breach that cannot reasonably be cured. A curable material breach receives seven days to cure where practical.',
      },
      {
        type: 'paragraph',
        text: 'Ending the Agreement does not remove rights already granted for paid deliverables or payment already earned. Sections that by their nature should continue—including payment, licence, confidentiality, data protection, warranties, liability and disputes—survive.',
      },
    ],
  },
  {
    id: 'section-15',
    number: 15,
    title: 'Indemnity and liability',
    blocks: [
      {
        type: 'paragraph',
        text: 'Each party will indemnify the other against third-party claims to the extent caused by its breach of this Agreement, infringement, gross negligence, fraud or wilful misconduct. You are responsible for claims caused by material you supplied or permissions you failed to obtain; Mingla is responsible for claims caused by Mingla-supplied material.',
      },
      {
        type: 'paragraph',
        text: 'Neither party is liable to the other for indirect or consequential loss. Except for fraud, wilful misconduct, confidentiality, intellectual-property, data-protection or indemnity obligations, each party’s aggregate liability under this Agreement is limited to the fees paid or payable to you in the three months before the event giving rise to the claim. Nothing excludes liability that the law does not permit a party to exclude.',
      },
    ],
  },
  {
    id: 'section-16',
    number: 16,
    title: 'Governing law and disputes',
    blocks: [
      {
        type: 'paragraph',
        text: 'Nigerian law governs this Agreement. The parties will first try in good faith to resolve a dispute directly, then by mediation. If it remains unresolved, it will be finally resolved by one arbitrator, in English, seated in Port Harcourt under the Arbitration and Mediation Act 2023. Either party may seek urgent injunctive relief in court for misuse of confidential information, personal data or intellectual property.',
      },
    ],
  },
  {
    id: 'section-17',
    number: 17,
    title: 'General terms and notices',
    blocks: [
      {
        type: 'paragraph',
        text: 'This Agreement, the city fee shown when you sign, and any written monthly brief are the entire agreement for the Local programme and replace earlier discussions about it. If they conflict, this Agreement controls unless a later document expressly says it amends this Agreement and both parties agree to it in writing.',
      },
      {
        type: 'paragraph',
        text: 'Mingla may assign this Agreement to an affiliate or successor. You may not assign it without written consent. If one provision is unenforceable, the rest remains effective. A delay in enforcing a right is not a waiver. Electronic records and counterparts are valid.',
      },
      {
        type: 'paragraph',
        text: 'Notices may be sent through Mingla Explorer or to the email attached to your account. Send legal notices to legal@usemingla.com. You can contact support@usemingla.com for programme help. Each party has had the opportunity to obtain independent legal advice before accepting this Agreement.',
      },
    ],
  },
]

export const localAgreementHeading = (section: LocalAgreementSection): string =>
  section.number === null ? section.title : `${section.number}. ${section.title}`

export const localAgreementCanonicalText = (): string =>
  JSON.stringify({
    version: LOCAL_AGREEMENT_VERSION,
    lastUpdated: LOCAL_AGREEMENT_LAST_UPDATED,
    sections: LOCAL_AGREEMENT_SECTIONS,
  })
