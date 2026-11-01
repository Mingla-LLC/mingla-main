// #4216 — complete, versioned Creator agreement execution copy.
// The canonical text below is fingerprinted. The same version, URL and digest
// are pinned by the release migration; any material edit requires a new version.

export const CREATOR_AGREEMENT_VERSION = "creator-v1";
export const CREATOR_AGREEMENT_LAST_UPDATED = "31 October 2026";
export const CREATOR_AGREEMENT_STATUS = "Effective 31 October 2026";
export const CREATOR_AGREEMENT_SHA256 =
  "5f3a9bf9a3dd9a938b25730f7c2fa5c046ea8151dba5f3c63602c7aaacf23a96";

export type CreatorAgreementBlock =
  | Readonly<{ type: "paragraph"; text: string }>
  | Readonly<{ type: "list"; items: readonly string[] }>;

export interface CreatorAgreementSection {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly blocks: readonly CreatorAgreementBlock[];
}

export const CREATOR_AGREEMENT_SECTIONS: readonly CreatorAgreementSection[] = [
  {
    id: "plain-language-summary",
    number: null,
    title: "Plain-language summary",
    blocks: [
      {
        type: "paragraph",
        text: "This summary helps explain the programme. The numbered sections below are the binding terms.",
      },
      {
        type: "list",
        items: [
          "You must be at least 18 and complete the identity, social-handle, payout and agreement steps required by the app.",
          "Joining Mingla Creator does not guarantee work. You choose whether to express interest in or accept each Gig.",
          "For each Gig, the Host and Creator agree the fee, deliverables, dates, platforms and any sales share in the app. Once the approved Creator fee is paid, Mingla and the paying Host receive the perpetual marketing licence described below.",
          "The Host pays the Creator fee plus Mingla’s displayed booking fee before work begins. Mingla administers the payment and releases the Creator fee after the required posts are verified.",
          "You continue to own the original Content, but payment for an approved video includes a perpetual, worldwide licence allowing Mingla and the paying Host to reuse, edit, promote and advertise with it as often as they choose, without another usage fee.",
          "After the script is locked, a Host may request no more than two rounds of technical fixes. A Host may not use technical review to rewrite your honest opinion or demand a new creative direction.",
          "Sponsored posts must be truthful, clearly labelled as advertising and kept live for at least 30 days unless the Gig Terms require longer.",
          "The app records the agreement version, acceptance time and Gig Terms so the parties can see the same history.",
          "You are responsible for your taxes and ordinary business costs unless a Gig expressly states otherwise.",
          "The cancellation, refund and dispute rules below determine what happens when a party withdraws, misses a deadline or disagrees about delivery.",
        ],
      },
    ],
  },
  {
    id: "section-1",
    number: 1,
    title: "Parties, scope and electronic acceptance",
    blocks: [
      {
        type: "paragraph",
        text: "This Mingla Creator Program Agreement (the “Agreement”) is between MINGLA LLC, a North Carolina limited liability company, of 700 Corporate Center Dr, Raleigh, North Carolina 27607-4945, USA (“Mingla”, “we”, “us”), and the individual who accepts it through a Mingla application (“Creator”, “you”).",
      },
      {
        type: "paragraph",
        text: "This Agreement governs your participation in Mingla Creator, including your profile, applications, offers, Gigs, Content, payments, usage rights, disputes and ratings. Mingla’s Terms of Service at https://www.usemingla.com/terms-of-service and Privacy Policy at https://www.usemingla.com/privacy-policy are incorporated by reference. If there is a direct conflict about Creator Program activity, this Agreement controls; the General Terms continue to govern the rest of the Service.",
      },
      {
        type: "paragraph",
        text: "You accept this Agreement by reading it, ticking the acceptance box and selecting “Sign and continue” while signed into your account. Mingla records your account identifier, the Agreement version, the time of acceptance and related evidence. Your electronic acceptance is intended to have the same effect as a handwritten signature. Only you may accept for your Creator account.",
      },
      {
        type: "paragraph",
        text: "A Host separately accepts the displayed terms for a particular Gig by ticking each term and selecting the payment action. When you then accept the offer, the Host and Creator form the Gig Contract described in section 4.",
      },
    ],
  },
  {
    id: "section-2",
    number: 2,
    title: "Eligibility, account and verification",
    blocks: [
      {
        type: "paragraph",
        text: "You must be at least 18 years old, have legal capacity to contract, and provide accurate and current legal name, date of birth, contact, social-account, payout and tax information. If you act through a registered business, you represent that you have authority to bind it, but the individual shown as the Creator remains responsible for personal performance and conduct unless Mingla agrees otherwise in writing.",
      },
      {
        type: "paragraph",
        text: "You must protect your account, use only social accounts you control, and promptly report suspected compromise. You may not create duplicate identities, transfer a verified profile, buy or fabricate engagement, or misstate audience, location, experience or prior work.",
      },
      {
        type: "paragraph",
        text: "Creator verification may require at least one verified social handle, proof that you are 18 or older, a ready payout account, processed showcase media and acceptance of the current Agreement. Verification means only that the listed checks passed; it is not an endorsement, employment decision or guarantee of suitability, performance or future work.",
      },
    ],
  },
  {
    id: "section-3",
    number: 3,
    title: "Independent-contractor relationship and Mingla’s role",
    blocks: [
      {
        type: "paragraph",
        text: "You perform Creator services as an independent contractor, not as an employee, worker, agent, partner, franchisee or joint venturer of Mingla or a Host. You have no authority to bind Mingla or a Host. You control the manner and means of producing Content, subject to the agreed result, deadlines, lawful brief, platform requirements and safety rules. You normally provide your own equipment, connectivity, workspace, insurance and ordinary expenses, and you receive no employee benefits.",
      },
      {
        type: "paragraph",
        text: "The parties intend independent-contractor status, but a label does not override mandatory law or the actual facts. Nothing in this Agreement removes a right that cannot lawfully be waived in the place where you work.",
      },
      {
        type: "paragraph",
        text: "Mingla provides the marketplace, workflow, records, payment administration, verification tools and escalated-dispute administration. Mingla is not the Creator’s talent agent, employer or manager; is not the Host’s advertising agency; and does not guarantee a Host, Creator, venue, event, audience result, platform reach, payment-processor timing or minimum volume of work.",
      },
    ],
  },
  {
    id: "section-4",
    number: 4,
    title: "Gigs, offers and formation of each Gig Contract",
    blocks: [
      {
        type: "paragraph",
        text: "A “Gig” is a Host’s opportunity for Content relating to a listing or brand. A Gig may state the format, deliverables, platforms, shoot window, post-by date, budget, guest passes and optional sales share. The perpetual organic and paid-marketing licence in section 11 is included in every paid Gig and is part of the consideration for the Creator fee. Before acceptance, Mingla may hide the Host or listing identity and may hide a Creator’s handles and contact details to protect marketplace privacy.",
      },
      {
        type: "paragraph",
        text: "You may express interest using a package and fee. The Host may hire at that price or send a structured counter-offer. An offer remains open for the period shown in the app, ordinarily 48 hours. You are free to accept or decline.",
      },
      {
        type: "paragraph",
        text: "When the Host accepts the displayed Host terms and completes payment, and you accept the offer, a binding contract is formed between the Host and Creator (the “Gig Contract”). The Gig Contract consists of the immutable Gig Terms shown in the app, the Creator- and Host-facing provisions of this Agreement, and the recorded timeline. Mingla is a party only to its platform, payment-administration and dispute-administration obligations.",
      },
      {
        type: "paragraph",
        text: "The Gig Terms control commercial specifics such as fee, deliverables, dates, platforms, sales share and guest passes. The perpetual licence in section 11 is a standard term and is not shortened by a Gig field or message. This Agreement controls matters not addressed in the Gig Terms. A custom message does not change the Gig Contract unless the app records it as an accepted structured change.",
      },
      {
        type: "paragraph",
        text: "Before script lock, the app may permit structured changes to dates, passes, deliverables or other displayed fields. Every accepted version is preserved. A fee increase requires the Host to pay the difference; a fee decrease produces the applicable partial refund. The perpetual licence is not a negotiable field. Neither party may secretly replace an accepted version with an off-platform promise.",
      },
    ],
  },
  {
    id: "section-5",
    number: 5,
    title: "Fees, booking fee, payment administration and taxes",
    blocks: [
      {
        type: "paragraph",
        text: "At hire, the Host is charged the Creator fee plus Mingla’s displayed booking fee, currently calculated as 15% of the Creator fee unless a different amount is shown before payment. The booking fee is paid on top; it is not deducted from the Creator fee. The Host pays before work begins so Mingla can administer the Gig’s payment and refund rules.",
      },
      {
        type: "paragraph",
        text: "The app may describe money as “held by Mingla.” This means Mingla captures and administers the payment through its payment providers pending release or refund under the Gig Contract. It is not a bank deposit, savings product, trust account or regulated escrow unless Mingla expressly states otherwise where required by law.",
      },
      {
        type: "paragraph",
        text: "You earn the fixed Creator fee when the required posts pass verification and any waiting period shown in the Gig timeline expires. Under the current workflow, release occurs 48 hours after verification. Mingla then sends the fee to your connected payout account. Bank and processor settlement schedules, compliance checks, weekends and failed payout details may delay receipt. You must keep the payout account ready and accurate.",
      },
      {
        type: "paragraph",
        text: "If the Gig includes a sales share, eligible sales are calculated from the attributed subtotal after discounts and excluding taxes, tips, service charges and buyer fees. Mingla currently deducts a 5% platform fee from the sales-share payout. Refunds, reversals and chargebacks reduce or reverse the related share. Small sales-share balances may roll forward until they meet the displayed payout minimum. The fixed Creator fee is not subject to that minimum.",
      },
      {
        type: "paragraph",
        text: "You are responsible for income tax, self-employment tax, social contributions, VAT or similar obligations arising from your earnings. Mingla or its payment provider may collect tax information, issue information returns, and withhold or remit amounts when legally required. Only expenses expressly approved in the Gig Terms or in writing before they are incurred are reimbursable.",
      },
    ],
  },
  {
    id: "section-6",
    number: 6,
    title: "Workflow, deadlines and automated actions",
    blocks: [
      {
        type: "paragraph",
        text: "The normal workflow is: offer and acceptance; shoot plan; script; script lock; filming and upload; technical review; posting; link verification; fee release; day-30 check; and ratings. The app’s timeline is the authoritative record of state changes, accepted terms, deadlines, submissions, approvals, payments and dispute events.",
      },
      {
        type: "paragraph",
        text: "Deadlines are calculated by Mingla’s servers using the listing timezone. Notifications are a convenience, not a substitute for checking the app. You and the Host must monitor the active Gig.",
      },
      {
        type: "paragraph",
        text: "Unless the Gig shows a different lawful rule: an unaccepted offer expires after 48 hours; a script automatically locks after 48 hours of Host silence; an uploaded video automatically approves after three days of Host silence; a Creator normally has three days to resubmit an allowed technical fix; post checks retry as shown in the app; and the Creator fee releases 48 hours after the posts pass verification. Automated approval does not excuse fraud, infringement, an undisclosed material connection or a submission that is materially different from the locked script.",
      },
    ],
  },
  {
    id: "section-7",
    number: 7,
    title: "Creator performance and Content standards",
    blocks: [
      {
        type: "paragraph",
        text: "You will perform the accepted Gig personally and professionally; follow the locked script and the material facts in the accepted brief; meet the agreed format, duration, platforms and dates; attend the confirmed shoot safely and lawfully; and submit technically usable Content through the approved workflow.",
      },
      {
        type: "paragraph",
        text: "Your statements must reflect your honest experience and must not be false, misleading, defamatory, discriminatory, unsafe or unsupported. Do not fabricate attendance, views, results, testimonials or engagement. Do not include unlawful material, hate or harassment, sexual exploitation, dangerous conduct, undisclosed conflicts, private information, malware or content that violates a platform’s rules.",
      },
      {
        type: "paragraph",
        text: "Do not use a synthetic person, cloned voice, materially altered testimonial or generative output that could mislead viewers about what happened, who participated or what you experienced, unless the Gig expressly permits the technique and every necessary person consents. Ordinary editing, captions, colour correction and accessibility treatments are permitted.",
      },
    ],
  },
  {
    id: "section-8",
    number: 8,
    title: "Advertising disclosures and truthful endorsements",
    blocks: [
      {
        type: "paragraph",
        text: "Every sponsored post must clearly and conspicuously disclose the material connection between you and the Host. Use “Ad”, “#ad”, “Paid partnership” or a clearer label required by the audience’s law, placed where viewers will notice and understand it before or as they encounter the endorsement. Use the platform’s branded-content tool when required, but do not rely on a hidden tag, profile biography, discount code or vague wording such as “collab” if it does not clearly communicate advertising.",
      },
      {
        type: "paragraph",
        text: "The disclosure must appear on every relevant format, including video, caption, story, livestream, thumbnail or repost as applicable. You must give an honest opinion based on real experience and make only claims you can support. The Host must not require an unlawful or misleading claim. Both parties must promptly correct a missing disclosure or materially inaccurate claim.",
      },
      {
        type: "paragraph",
        text: "You must comply with applicable advertising and consumer-protection rules, including the U.S. FTC Endorsement Guides when U.S. consumers are targeted, the CAP Code and CMA guidance when UK consumers are targeted, and equivalent local rules elsewhere.",
      },
    ],
  },
  {
    id: "section-9",
    number: 9,
    title: "Script review, approval and technical fixes",
    blocks: [
      {
        type: "paragraph",
        text: "The Creator controls the authentic voice and creative treatment. The Host may review the proposed script for agreed facts, format, tags, disclosure, dates, prices, inclusions and brand-safety requirements. Once approved or automatically locked, the script is the creative baseline.",
      },
      {
        type: "paragraph",
        text: "After delivery, the Host may request no more than two rounds of technical fixes. A technical fix is limited to sound, picture quality, an agreed element missing from the locked script, or the wrong agreed length or format. A fix request must identify the category and explain the objective problem.",
      },
      {
        type: "paragraph",
        text: "The Host may not use technical review to demand a new concept, replace the Creator’s honest opinion, add an unagreed claim, obtain extra deliverables, or restart the project for subjective preference. The Creator must correct a valid technical issue and resubmit within the displayed deadline. A non-technical or abusive request may be challenged through the dispute process.",
      },
    ],
  },
  {
    id: "section-10",
    number: 10,
    title: "Posting, verification and the 30-day live period",
    blocks: [
      {
        type: "paragraph",
        text: "After approval, you will publish on the agreed platforms by the post-by date, use the required tags and disclosure, and submit each public URL through Mingla. The post author must match your verified handle. Mingla may check authorship, tags, disclosure, date and whether the post remains publicly accessible.",
      },
      {
        type: "paragraph",
        text: "Keep each agreed post live and materially unchanged for at least 30 days after verification, or longer if the Gig Terms expressly require it. Do not move the disclosure, remove required tags, substitute different Content or make the post private during that period without an applicable legal, safety or platform reason and prompt notice to Mingla.",
      },
      {
        type: "paragraph",
        text: "If a post is removed before day 30, any unpaid sales share stops and your reliability record may be affected. A fixed Creator fee already released is not automatically clawed back solely because of early removal, but fraud, infringement or a dispute outcome may create a separate repayment obligation.",
      },
    ],
  },
  {
    id: "section-11",
    number: 11,
    title: "Ownership and perpetual marketing licence",
    blocks: [
      {
        type: "paragraph",
        text: "You retain ownership of original Content you create. The Gig Contract grants only the limited rights stated in this section and the accepted Gig Terms. No ownership transfers to the Host or Mingla.",
      },
      {
        type: "paragraph",
        text: "After the fixed Creator fee is released, you grant both Mingla and the paying Host a non-exclusive, perpetual, irrevocable, worldwide, royalty-free, fully paid-up, transferable and sublicensable licence to use, host, store, copy, reproduce, publish, display, publicly perform, distribute, broadcast, transmit, advertise, promote, crop, resize, caption, translate, edit, adapt, re-cut, combine and create derivative works from the approved Content, and to use your name, verified handle, voice, image, likeness and performance as embodied in that Content. The licence covers any lawful commercial, advertising, marketing, publicity, product, platform, app-store, email, social, digital, broadcast, partner, investor or offline purpose, in any media now known or later developed.",
      },
      {
        type: "paragraph",
        text: "Mingla and the paying Host may use the approved Content organically or in paid advertising, boosting, dark posts and other promotional campaigns, repeatedly and for as long as they choose, without further approval, royalties or usage fees. They may sublicense these rights to their affiliates, agencies, contractors, advertising platforms, distributors and commercial partners for authorised uses. Running an advertisement directly from your own social account, including whitelisting or Spark Ads tied to your handle, still requires the separate account-level authorisation demanded by that platform; the licence does not require you to share a password or give continuing account access.",
      },
      {
        type: "paragraph",
        text: "The licence becomes effective only when the fixed Creator fee is released. If the fee is fully refunded before release, the perpetual licence does not arise. Once effective, the licence survives completion of the Gig, removal of the Creator’s post, termination of this Agreement and closure of either party’s account. Mingla and the Host may keep archival and production copies needed to exercise the licence.",
      },
      {
        type: "paragraph",
        text: "You waive any right to inspect or approve each authorised use of the approved Content and, to the extent permitted by law, agree not to assert moral rights against an authorised edit or adaptation. Mingla and the Host may not use the Content to make a materially false factual claim, create a materially new synthetic performance or voice clone, or imply that you personally endorsed a different product or proposition that does not reasonably arise from the approved Content.",
      },
    ],
  },
  {
    id: "section-12",
    number: 12,
    title: "Third-party materials, permissions and Host-supplied claims",
    blocks: [
      {
        type: "paragraph",
        text: "You must own or obtain commercially sufficient rights to every element you supply, including music, footage, photographs, fonts and artwork, for the perpetual worldwide organic and paid uses granted in section 11. You must obtain releases or permissions required for identifiable people, private property and locations. Do not use platform music or other material that is cleared only for a personal post if it cannot lawfully be used in paid advertising and sublicensed campaigns. Do not include confidential information or personal data you have no right to disclose.",
      },
      {
        type: "paragraph",
        text: "The Host is responsible for the accuracy and legality of claims, prices, dates, logos and materials it supplies. You are not required to repeat a claim you reasonably believe is false or unsupported. Each party grants the rights needed to combine its supplied materials with the approved Content and to exercise the perpetual licence, while ownership of pre-existing materials remains with their original owner.",
      },
    ],
  },
  {
    id: "section-13",
    number: 13,
    title: "Cancellation, missed deadlines and refunds",
    blocks: [
      {
        type: "paragraph",
        text: "Before Creator acceptance, the Host may cancel for a full refund, including the booking fee. If you decline or do not accept within 48 hours, the Host receives a full refund, including the booking fee.",
      },
      {
        type: "paragraph",
        text: "If you accept and later withdraw, or miss the final upload deadline without an approved extension, the Host receives a full refund, including the booking fee, and your reliability record may be affected.",
      },
      {
        type: "paragraph",
        text: "If the Host cancels after Creator acceptance but before script lock, 75% of the Creator fee is refunded and 25% is paid to the Creator for reserved time and work begun. The matching booking-fee portion attributable to the Creator-paid amount is retained; the remainder is refunded. The app’s payment breakdown controls the exact calculation.",
      },
      {
        type: "paragraph",
        text: "After script lock, neither party may unilaterally cancel for an automatic refund. The parties must use the Gig dispute process, except that Mingla may reverse a transaction when required by law, payment-network rules, sanctions, fraud controls or a final legal order.",
      },
    ],
  },
  {
    id: "section-14",
    number: 14,
    title: "Gig disputes and settlement",
    blocks: [
      {
        type: "paragraph",
        text: "A party may open a Gig dispute when the workflow permits, including after two unsuccessful technical-fix rounds, a missed post-by deadline, an unresolved post-verification failure, or an abusive non-technical fix request. Opening a dispute pauses affected timers and holds unreleased funds.",
      },
      {
        type: "paragraph",
        text: "The Host and Creator may exchange recorded settlement offers for three days. An offer states the proposed refund percentage and any note. Silence never counts as acceptance. An accepted offer is binding and Mingla may implement the corresponding release or refund.",
      },
      {
        type: "paragraph",
        text: "If settlement fails or an offer is declined, Mingla may escalate the dispute for administrator review. Mingla will review the shared timeline, accepted terms, script, submissions, fix requests, post evidence and party statements, and will use commercially reasonable efforts to decide within two working days. Outcomes may release the fee, partially refund it, or fully refund it. A persistent technical defect after the second fix ordinarily supports a 50% refund, but the evidence and seriousness control.",
      },
      {
        type: "paragraph",
        text: "Mingla’s Gig decision is final for administration of the platform payment and reliability records, subject to chargeback rights and any non-waivable legal rights. It does not prevent a party from using the formal legal-dispute process incorporated in section 21.",
      },
    ],
  },
  {
    id: "section-15",
    number: 15,
    title: "Ratings, reliability and marketplace integrity",
    blocks: [
      {
        type: "paragraph",
        text: "After completion, the Host and Creator may rate each other. Ratings may remain hidden until both are submitted or seven days pass. Mingla may calculate reliability from objective events such as on-time scripts, uploads and posts, withdrawals after acceptance and early post removals. Reliability may be shown only after the minimum history stated in the app.",
      },
      {
        type: "paragraph",
        text: "Do not manipulate ratings, retaliate for an honest review, trade favourable ratings, threaten another party, or use a rating to demand unagreed work. Mingla may remove fraudulent, abusive, irrelevant or legally prohibited content and may correct a system-generated record when evidence shows it is wrong.",
      },
    ],
  },
  {
    id: "section-16",
    number: 16,
    title: "Confidentiality, privacy and media retention",
    blocks: [
      {
        type: "paragraph",
        text: "Use non-public briefs, pricing, campaign plans, security information, personal data and unreleased product information only to perform the Gig. Do not disclose or exploit it. This duty lasts three years after the relationship ends and indefinitely for trade secrets.",
      },
      {
        type: "paragraph",
        text: "Mingla handles account, signing, payment and workflow data under the Privacy Policy. Each party must follow applicable data-protection law, secure personal data, use it only for the Gig, and promptly report a suspected loss or unauthorised disclosure.",
      },
      {
        type: "paragraph",
        text: "Mingla ordinarily retains showcase media while the Creator profile is active and may retain approved delivery media and derivatives indefinitely to exercise the perpetual licence. Dispute evidence is ordinarily retained for approximately 180 days, while fraud prevention, backups, an unresolved dispute, legal hold, tax or regulatory duties may require longer retention. Source uploads may be deleted after successful processing while approved publication and marketing copies remain.",
      },
    ],
  },
  {
    id: "section-17",
    number: 17,
    title: "Safety and prohibited conduct",
    blocks: [
      {
        type: "paragraph",
        text: "Follow venue rules and applicable law, use reasonable care, obtain filming permission where required, and avoid recording a person who has not consented. If you feel unsafe, leave and contact local emergency services. Report material safety concerns to Mingla support.",
      },
      {
        type: "paragraph",
        text: "You must not harass, threaten, discriminate, bribe, impersonate, stalk or endanger another person; solicit an undisclosed reward; move an active Gig or payment off-platform to avoid fees or records; misuse guest passes; interfere with systems; launder money; evade sanctions; or use Mingla for illegal activity. Hosts are subject to the same standards through their Host terms and Gig acceptance.",
      },
    ],
  },
  {
    id: "section-18",
    number: 18,
    title: "Warranties and indemnity",
    blocks: [
      {
        type: "paragraph",
        text: "You promise that you have authority to enter this Agreement; your Content is original or properly licensed; your statements are truthful and based on genuine experience; you have the required permissions; and your performance and Content will not infringe rights, breach another obligation or violate law. Mingla promises that it has authority to provide the Service and administer the payment workflow. A Host is responsible for its supplied materials, claims and instructions.",
      },
      {
        type: "paragraph",
        text: "Each party will indemnify the other against third-party claims, losses and reasonable costs to the extent caused by that party’s breach, infringement, gross negligence, fraud or wilful misconduct. You are responsible for claims caused by material you supplied or permissions you failed to obtain. Mingla is responsible for claims caused by Mingla-supplied material. The indemnified party must give prompt notice and reasonable cooperation; no settlement may admit fault or impose a non-monetary obligation on the other party without consent.",
      },
    ],
  },
  {
    id: "section-19",
    number: 19,
    title: "Disclaimers and limitation of liability",
    blocks: [
      {
        type: "paragraph",
        text: "Except for express promises in this Agreement, the Service is provided “as is” and “as available.” Mingla does not guarantee uninterrupted access, social-platform availability, audience reach, campaign results, a minimum number of Gigs, Host conduct, venue conditions, payout-provider timing or continued availability of a third-party feature.",
      },
      {
        type: "paragraph",
        text: "To the maximum extent permitted by law, no party is liable to another for indirect, incidental, special, punitive or consequential loss, including lost opportunity or expected reach. Except for payment obligations, fraud, wilful misconduct, confidentiality, data-protection, intellectual-property, personal-injury or indemnity obligations, each party’s aggregate liability under this Agreement is limited to the greater of USD $100 or the Creator fees paid or payable under the affected Gig and the six months preceding the event giving rise to the claim. Nothing excludes liability that applicable law does not permit a party to exclude.",
      },
    ],
  },
  {
    id: "section-20",
    number: 20,
    title: "Term, suspension and termination",
    blocks: [
      {
        type: "paragraph",
        text: "This Agreement begins when you accept it and continues until you or Mingla end Creator participation. You may stop applying for new Gigs at any time. Either party may end the framework on 14 days’ notice, but accepted Gigs continue unless cancelled or resolved under their terms.",
      },
      {
        type: "paragraph",
        text: "Mingla may pause or end access immediately for fraud, payment abuse, sanctions risk, unlawful Content, serious safety misconduct, infringement, manipulation, a material confidentiality or data breach, or another material breach that cannot reasonably be cured. Where practical, a curable material breach receives seven days to cure.",
      },
      {
        type: "paragraph",
        text: "Termination does not erase payment already earned, refund duties, accepted Gig obligations, rights validly granted for paid Content, or provisions that by their nature survive, including confidentiality, data protection, ownership, licences, warranties, indemnity, liability and disputes.",
      },
    ],
  },
  {
    id: "section-21",
    number: 21,
    title: "Formal disputes, governing law and mandatory local rights",
    blocks: [
      {
        type: "paragraph",
        text: "The Gig dispute process in section 14 addresses performance and payment administration for one Gig. Any broader legal dispute with Mingla is governed by the informal-resolution, arbitration, opt-out, class-action and venue provisions in sections 18 and 19 of Mingla’s Terms of Service, which are incorporated here. The current General Terms provide a 30-day arbitration opt-out and apply North Carolina law and Wake County venue, subject to their stated exceptions.",
      },
      {
        type: "paragraph",
        text: "Nothing in this Agreement deprives you of mandatory employment-status, consumer, data-protection, intellectual-property, payment or access-to-court rights that cannot be waived where you live or perform the work. If a mandatory local rule conflicts with this Agreement, that rule controls only to the extent required.",
      },
    ],
  },
  {
    id: "section-22",
    number: 22,
    title: "Changes, records, notices and general terms",
    blocks: [
      {
        type: "paragraph",
        text: "Mingla may update the Creator Program for future Gigs. A material change to this Agreement receives a new version. Mingla will present the new version for acceptance before you enter a new Gig when re-consent is required. A change does not rewrite an already accepted Gig or reduce payment already earned.",
      },
      {
        type: "paragraph",
        text: "The Agreement version and its canonical text or fingerprint, your acceptance record, each immutable Gig Terms version and the shared timeline are the parties’ electronic records. You may download or request a copy. Electronic records, signatures and counterparts are valid to the extent allowed by law.",
      },
      {
        type: "paragraph",
        text: "Notices may be sent in the app or to the email attached to the account. Legal notices to Mingla must be sent to legal@usemingla.com; programme support may be sent to support@usemingla.com. You must keep your contact details current.",
      },
      {
        type: "paragraph",
        text: "Mingla may assign this Agreement to an affiliate or successor. You may not assign personal performance without written consent. If a provision is unenforceable, it will be modified to the minimum extent necessary or severed, and the remainder continues. A delay enforcing a right is not a waiver. Headings and the summary aid reading but do not change meaning. This Agreement, the incorporated General Terms and Privacy Policy, and each accepted Gig Terms version are the entire agreement for the Creator Program.",
      },
    ],
  },
  {
    id: "schedule-a",
    number: null,
    title: "Schedule A — Minimum Gig Terms recorded in the app",
    blocks: [
      {
        type: "paragraph",
        text: "Each Gig Contract should record, at minimum, the following fields. A missing required field should block hire rather than be inferred later.",
      },
      {
        type: "list",
        items: [
          "Host, Creator and associated listing or campaign.",
          "Creator fee, currency, Mingla booking fee and total charged to the Host.",
          "Format, count, duration and platform for each deliverable.",
          "Shoot window or shoot date, post-by date and applicable timezone.",
          "Required tags, disclosure, tracked link and guest passes.",
          "Perpetual worldwide organic and paid-marketing rights for Mingla and the paying Host are included in the Creator fee.",
          "Any separate platform authorisation needed to run advertising directly from the Creator’s own account; no additional Content-usage fee is due.",
          "Optional sales-share percentage, eligible basis and platform fee.",
          "Accepted structured changes and the current immutable terms version.",
          "Any expressly approved reimbursable expense.",
        ],
      },
    ],
  },
  {
    id: "schedule-b",
    number: null,
    title: "Schedule B — Advertising-disclosure baseline",
    blocks: [
      {
        type: "paragraph",
        text: "Use a clear disclosure viewers immediately understand, such as “Ad” or “#ad”, and the platform paid-partnership tool where appropriate. Put it at the beginning or otherwise before viewers encounter the endorsement; repeat it visually and audibly where the format requires. Do not bury disclosure after “more”, among hashtags, only in a biography, or behind an ambiguous label. The stricter applicable local rule controls.",
      },
    ],
  },
] as const;

export function creatorAgreementHeading(
  section: CreatorAgreementSection,
): string {
  return section.number === null
    ? section.title
    : `${section.number}. ${section.title}`;
}

export function creatorAgreementCanonicalText(): string {
  return CREATOR_AGREEMENT_SECTIONS.map((section) => {
    const body = section.blocks
      .map((block) =>
        block.type === "list"
          ? block.items.map((item) => `- ${item}`).join("\n")
          : block.text,
      )
      .join("\n\n");
    return `${creatorAgreementHeading(section)}\n\n${body}`;
  }).join("\n\n");
}
