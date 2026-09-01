// ---------------------------------------------------------------
// #2902 — HOST (event organisers & promoters) truth set for the design preview.
//
// Every capability below was verified against shipped source before it was
// written here. The `evidence` field names the file or migration that proves
// it, so a reviewer can audit a claim without trusting this file.
//
// Nothing in this module claims an OUTCOME. "Sell tickets with an all-in price"
// is a capability. "Sell 40% more tickets" would be a performance claim, and
// this preview makes none.
// ---------------------------------------------------------------

export interface HostCapability {
  id: string
  /** Short verb phrase — what the organiser does. */
  title: string
  /** One sentence, plain English, no outcome promised. */
  body: string
  /** Repo path proving the capability ships. Rendered in the audit strip. */
  evidence: string
}

/** Step 1 — build. */
export const HOST_BUILD: readonly HostCapability[] = [
  {
    id: 'ari',
    title: 'Describe the night to Ari',
    body: 'Ari is a chat surface inside Mingla Host that turns a plain description of your event into a page, an offer and the marketing around it.',
    evidence: 'mingla-business/src/screens/ari/AriChatScreen.tsx',
  },
  {
    id: 'tiers',
    title: 'Set ticket tiers and sale windows',
    body: 'Tiers carry their own price and on-sale window, and a tier that has already sold is edit-locked so a live sale cannot be changed underneath a buyer.',
    evidence: 'supabase/migrations/20270526002590_issue_2590_tier_edit_locks.sql',
  },
  {
    id: 'page',
    title: 'Publish a public event page',
    body: 'The event renders as a public page a buyer can open without an account, with the same layout the Mingla apps render.',
    evidence: 'mingla-marketing/app/event-preview/EventPreviewClient.tsx',
  },
]

/** Step 2 — promote. */
export const HOST_PROMOTE: readonly HostCapability[] = [
  {
    id: 'contacts',
    title: 'Bring your own guest list',
    body: 'Import contacts from a CSV or the phone book so the people who already came to your last night are reachable from inside Mingla.',
    evidence: 'mingla-business/src/features/contact-import/ContactImportFlow.tsx',
  },
  {
    id: 'email',
    title: 'Send an email campaign',
    body: 'Campaigns send from Mingla with per-recipient click tracking and a working unsubscribe on every message.',
    evidence: 'supabase/functions/marketing-send',
  },
  {
    id: 'discovery',
    title: 'Appear in Explorer intent',
    body: 'Published Mingla events are eligible to surface to Explorers browsing by vibe, place and timing rather than by your name.',
    evidence: 'mingla-marketing/components/sections/explorer-home/event-card.tsx',
  },
]

/** Step 3 — run the door and read the result. */
export const HOST_MEASURE: readonly HostCapability[] = [
  {
    id: 'checkout',
    title: 'Take an all-in payment',
    body: 'Buyers see one combined fees-and-tax line and the final price before they pay, on card rails in your market.',
    evidence: 'mingla-business/src/payments',
  },
  {
    id: 'scan',
    title: 'Scan people in at the door',
    body: 'Door staff can be invited to a scanner without being given access to the rest of your Host account.',
    evidence: 'mingla-business/src/utils/__tests__/issue_885_scanner_invite_actionable.adversarial.test.ts',
  },
  {
    id: 'export',
    title: 'Export who actually came',
    body: 'The guest list exports to CSV, so the night produces a list you keep rather than a number you screenshot.',
    evidence: 'mingla-business/src/utils/guestCsvExport.ts',
  },
]

/**
 * The honesty block. A landing page that only lists strengths is not credible,
 * and these limits are all things a Lagos or Triangle organiser would hit in
 * week one. Each is a real, current constraint.
 */
export interface HostLimit {
  title: string
  body: string
}

export const HOST_LIMITS: readonly HostLimit[] = [
  {
    title: 'SMS blasts are not live in Nigeria',
    body: 'Text campaigns run in our US and UK markets. Nigerian organisers use email campaigns and the in-app guest list until the local SMS route is enabled.',
  },
  {
    title: 'Mingla is not a website builder',
    body: 'You get a Mingla event page, not a hosted domain of your own. If you need your own site, that is a separate product decision, not something this page pretends to solve.',
  },
  {
    title: 'Discovery is eligibility, not placement',
    body: 'Publishing makes your event eligible to be matched to Explorer intent. It does not buy you a position, and we will not tell you it does.',
  },
]

/**
 * Before / after. The "before" column is the stack an event organiser actually
 * describes today; the "after" column names only capabilities listed above.
 */
export interface WorkflowRow {
  job: string
  before: string
  after: string
}

export const HOST_WORKFLOW: readonly WorkflowRow[] = [
  {
    job: 'Make the page',
    before: 'A flyer in the group chat, a bio link, and a Google Form for names.',
    after: 'One Mingla event page built from a description, with the tiers on it.',
  },
  {
    job: 'Price it',
    before: 'A ticket price, then a service fee the buyer only meets at checkout.',
    after: 'One all-in price. Fees and tax are a single line the buyer sees before paying.',
  },
  {
    job: 'Reach people',
    before: 'Post, repost, DM back individually, hope the algorithm agrees.',
    after: 'Email your imported list, and be eligible to reach Explorers searching by vibe.',
  },
  {
    job: 'Run the door',
    before: 'A printed list, a phone screen, and one person who knows everyone.',
    after: 'Scanner-only invites for door staff, checking names against the live list.',
  },
  {
    job: 'Know what happened',
    before: 'A rough headcount and a cash tally the next afternoon.',
    after: 'Sold-by-tier, who checked in, and a CSV of the guests you can keep.',
  },
]
