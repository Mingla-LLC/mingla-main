// #4452 §6.1–6.3 — the four free tools' page copy and their adaptive follow-up
// questions (design TOOLS and TSC, chapter 4c). Pure: no React, no I/O, so the
// node tests load it directly.
//
// The scenario rules mirror the server's (supabase/functions/_shared/
// growthToolFollowups.ts): the server re-checks every one and rejects a
// follow-up sent for the wrong scenario.

export type ToolKey = 'venues' | 'events' | 'trips' | 'pricing'
export type FollowupReason = 'no_website' | 'free_rsvp' | 'group_over_15' | 'free_today'

export interface ToolPageCopy {
  /** The hero pill, before " · free". */
  pill: string
  h: string
  em: string
  sub: string
  cta: string
  /** The "What you'll get" card, marked Example (design getcard). */
  getMetric: readonly [string, string]
  getRows: ReadonlyArray<readonly [string, string]>
  /** The research checklist (design TOOLS[k].run). */
  run: readonly string[]
  steps: ReadonlyArray<readonly [string, string]>
  /** The preview's next-step button when no scenario applies (design BASECTA). */
  reportCta: string
}

export const TOOL_PAGE: Record<ToolKey, ToolPageCopy> = {
  venues: {
    pill: 'Venue website grader',
    h: 'Your website is costing you',
    em: 'customers.',
    sub: 'Pick your place on Google and we grade your live website against the places near you. Free, about 60 seconds.',
    cta: 'Grade my website',
    getMetric: ['62', '/100 example score'],
    getRows: [['Loads on phones', 'Slow'], ['Book or order button', 'Missing'], ['Google profile', 'Strong'], ['Against 5 places nearby', '4th']],
    run: ['Finding your website', 'Testing it on a phone', 'Checking 5 places nearby', 'Writing your fixes'],
    steps: [['Pick your place', 'From Google, so nothing to type.'], ['We test it live', 'Speed, booking, menus and photos.'], ['Fixes in your inbox', 'Ranked by how much they cost you.']],
    reportCta: 'Open my full report',
  },
  events: {
    pill: 'Event turnout predictor',
    h: 'How many people will',
    em: 'actually show up?',
    sub: 'A real turnout forecast for your date, city and competition, and what your promo budget can buy. Free.',
    cta: 'Forecast my turnout',
    getMetric: ['312', 'people of 400, example forecast'],
    getRows: [['Best promo budget', '₦180,000'], ['Other events that night', '3 nearby'], ['Chance to sell out', '41%']],
    run: ['Reading your date and city', 'Finding competing events', 'Checking similar past events', 'Working out the budget'],
    steps: [['Tell us the basics', 'Name, city, date, capacity.'], ['We research live', 'Your date, your city, your competition.'], ['Forecast in your inbox', 'Turnout, budget and the maths.']],
    reportCta: 'Open my full forecast',
  },
  trips: {
    pill: 'Quote any trip',
    h: 'Price any trip in a minute,',
    em: 'not a spreadsheet.',
    sub: 'Describe the trip and we build the whole costed plan: real hotels and activities at current prices, and what to charge per person.',
    cta: 'Quote this trip',
    getMetric: ['$1,240', 'per person, example quote'],
    getRows: [['Hotel, 4 nights', 'Riad, 5 rooms'], ['Activities', '6 booked'], ['Your margin', '18%']],
    run: ['Finding hotels for your group', 'Pricing activities', 'Adding transfers and meals', 'Setting your price'],
    steps: [['Describe the trip', 'Where, how long, how many.'], ['We price it live', 'Real hotels and activities.'], ['Quote in your inbox', 'Line by line, ready to send.']],
    reportCta: 'Open my full quote',
  },
  pricing: {
    pill: 'The undercharging audit',
    h: 'Are you charging',
    em: 'what you’re worth?',
    sub: 'Your true cost per head, what similar experiences charge near you, and the price you should be charging. Free.',
    cta: 'Audit my pricing',
    getMetric: ['+£14', 'per seat, example'],
    getRows: [['Your true cost per head', '£31'], ['Similar experiences nearby', '£45 to £60'], ['Extra per month', '£672']],
    run: ['Working out your true cost', 'Finding similar experiences', 'Comparing prices nearby', 'Setting your price'],
    steps: [['Describe it', 'What, where, how many seats.'], ['We compare live', 'Real experiences near you.'], ['Audit in your inbox', 'Your price, with the maths.']],
    reportCta: 'Open my full audit',
  },
}

export interface ScenarioCopy {
  reason: FollowupReason
  /** The "Asked because …" tag (binding copy, design TSC). */
  tag: string
  /** The research screen's second line while this situation is being worked on. */
  runLine: string
  /** The scenario's next-step button. */
  cta: string
  getMetric: readonly [string, string]
  getRows: ReadonlyArray<readonly [string, string]>
}

export const SCENARIO: Record<ToolKey, ScenarioCopy> = {
  venues: {
    reason: 'no_website',
    tag: 'asked because Google lists no website',
    runLine: 'No website found, checking your Google and Instagram',
    cta: 'Make my free Mingla Host page',
    getMetric: ['No site', 'Google shows no website for you'],
    getRows: [['Places nearby with a website', '4 of 5'], ['Booking or order link', 'None found'], ['Google profile', 'Strong']],
  },
  events: {
    reason: 'free_rsvp',
    tag: 'asked because it’s free',
    runLine: 'Free event: estimating show-up rate',
    cta: 'Set up RSVPs on Mingla Host',
    getMetric: ['58%', 'of RSVPs likely to show, example'],
    getRows: [['RSVPs to aim for', '690'], ['Reminders that cut no-shows', '24 h and 3 h before'], ['Best place to promote', 'Instagram stories']],
  },
  trips: {
    reason: 'group_over_15',
    tag: 'asked because groups over 15 need transport',
    runLine: 'Big group: adding a coach and rooms',
    cta: 'Turn this into a bookable trip on Mingla Host',
    getMetric: ['$1,090', 'per person, example quote for 24'],
    getRows: [['Coach, 4 days', 'Included'], ['Rooms', '12 twin'], ['Your margin', '20%']],
  },
  pricing: {
    reason: 'free_today',
    tag: 'asked because it’s free today',
    runLine: 'Free today: working out what it costs you',
    cta: 'Start charging with Mingla Host',
    getMetric: ['£31', 'per head you pay yourself, example'],
    getRows: [['What you lose each month', '£1,488'], ['Similar experiences nearby', '£45 to £60'], ['A fair first price', '£40']],
  },
}

/** Trips ask about a coach and rooms from 16 people ("groups over 15"; same rule as the server). */
export const TRIP_GROUP_THRESHOLD = 16

/** The facts each tool's question is decided by, from its own form state. */
export type ScenarioFacts =
  | { tool: 'venues'; googlePick: boolean; googleWebsite: string; typedWebsite: string }
  | { tool: 'events'; free: boolean }
  | { tool: 'trips'; groupSize: number }
  | { tool: 'pricing'; free: boolean }

/** Is the adaptive question asked? (The branching the design's TSC shows.) */
export function followupActive(f: ScenarioFacts): boolean {
  switch (f.tool) {
    case 'venues':
      return f.googlePick && f.googleWebsite.trim() === '' && f.typedWebsite.trim() === ''
    case 'events':
      return f.free
    case 'trips':
      return Number.isFinite(f.groupSize) && f.groupSize >= TRIP_GROUP_THRESHOLD
    case 'pricing':
      return f.free
  }
}

/** Which form fields the scenario hides (design `hide:'price'`). */
export function hiddenFields(f: ScenarioFacts): readonly string[] {
  if (f.tool === 'events' && followupActive(f)) return ['ticket_price']
  if (f.tool === 'pricing' && followupActive(f)) return ['current_price']
  return []
}

export type FollowupAnswers =
  | { tool: 'venues'; found_via: 'instagram' | 'whatsapp' | 'google_only' | null }
  | { tool: 'events'; rsvp_goal: string; no_shows: 'lots' | 'few' | null }
  | { tool: 'trips'; coach: boolean | null; rooms: 'twin' | 'single' | null }
  | { tool: 'pricing'; session_cost: string; deposit: 'probably' | 'not_sure' | null }

export type FollowupBody =
  | { found_via: 'instagram' | 'whatsapp' | 'google_only' }
  | { rsvp_goal: number; no_shows: 'lots' | 'few' }
  | { coach: boolean; rooms: 'twin' | 'single' }
  | { session_cost: number; deposit: 'probably' | 'not_sure' }

/** What is still missing from an asked follow-up ("Still need: …"), empty when complete. */
export function followupMissing(a: FollowupAnswers): string[] {
  switch (a.tool) {
    case 'venues':
      return a.found_via ? [] : ['where people find you']
    case 'events': {
      const out: string[] = []
      const n = Number(a.rsvp_goal)
      if (!(a.rsvp_goal.trim() !== '' && Number.isFinite(n) && n >= 1)) out.push('your RSVP goal')
      if (!a.no_shows) out.push('no-shows before')
      return out
    }
    case 'trips': {
      const out: string[] = []
      if (a.coach === null) out.push('coach or not')
      if (!a.rooms) out.push('rooms')
      return out
    }
    case 'pricing': {
      const out: string[] = []
      const n = Number(a.session_cost)
      if (!(a.session_cost.trim() !== '' && Number.isFinite(n) && n >= 0)) out.push('what each session costs you')
      if (!a.deposit) out.push('deposits')
      return out
    }
  }
}

/** The `input.followup` the server validates, or null (not asked, or not complete). */
export function followupBody(f: ScenarioFacts, a: FollowupAnswers): FollowupBody | null {
  if (!followupActive(f) || f.tool !== a.tool || followupMissing(a).length > 0) return null
  switch (a.tool) {
    case 'venues':
      return a.found_via ? { found_via: a.found_via } : null
    case 'events':
      return a.no_shows ? { rsvp_goal: Math.round(Number(a.rsvp_goal)), no_shows: a.no_shows } : null
    case 'trips':
      return a.coach !== null && a.rooms ? { coach: a.coach, rooms: a.rooms } : null
    case 'pricing':
      return a.deposit ? { session_cost: Math.round(Number(a.session_cost) * 100) / 100, deposit: a.deposit } : null
  }
}

/**
 * The run input with the follow-up attached. Without one the input is returned
 * as is, so the request body is byte-for-byte today's (SC-136).
 */
export function withFollowup<T extends object>(input: T, followup: FollowupBody | null): T | (T & { followup: FollowupBody }) {
  return followup ? { ...input, followup } : input
}

/** The research checklist: the situation line replaces the second item when it applies (§6.3). */
export function researchLines(tool: ToolKey, active: boolean, situation?: string): string[] {
  const run = TOOL_PAGE[tool].run
  return active ? [run[0], situation || SCENARIO[tool].runLine, ...run.slice(2)] : [...run]
}

/** The trips situation line with their own numbers (design: "Group of 24: adding a coach and twin rooms"). */
export function tripSituationLine(groupSize: number, coach: boolean | null, rooms: 'twin' | 'single' | null): string {
  const r = rooms ? `${rooms} rooms` : 'rooms'
  return `Group of ${Math.round(groupSize)}: ${coach === false ? 'pricing' : 'adding a coach and'} ${r}`
}

/**
 * How far the checklist has got at `elapsedMs` of an `expectedMs` run. Items tick
 * on fixed fractions of the expected time, and the last item never ticks before
 * the response arrives (`done`), so the screen never claims "done" early.
 */
export function researchProgress(elapsedMs: number, expectedMs: number, items: number, done: boolean): { ticked: number; pct: number } {
  if (done) return { ticked: items, pct: 100 }
  const frac = Math.max(0, Math.min(elapsedMs / Math.max(1, expectedMs), 1))
  const ticked = Math.min(items - 1, Math.floor(frac * items))
  return { ticked, pct: Math.min(92, Math.round(frac * 92)) }
}

/** The preview's next-step button: the scenario's when it applied, else the tool's. */
export function nextStepCta(tool: ToolKey, reason: FollowupReason | null): string {
  return reason && SCENARIO[tool].reason === reason ? SCENARIO[tool].cta : TOOL_PAGE[tool].reportCta
}

/** `tool_followup_shown` properties: the tool and the reason only (never an answer). */
export function followupShownProps(tool: ToolKey): { tool: ToolKey; reason: FollowupReason } {
  return { tool, reason: SCENARIO[tool].reason }
}
