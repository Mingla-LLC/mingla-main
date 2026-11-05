/**
 * #4273 wave B — the Blast composer's selection model: which groups, which
 * methods, and which sealed lane a campaign travels on. Pure functions only.
 *
 * Every count the host reads comes from the server. Nothing here adds rows up.
 */

export type BlastChannel = "email" | "sms" | "push";

/** Display order of the "Send by" chips, and the order a lead is chosen in. */
export const BLAST_CHANNEL_ORDER: readonly BlastChannel[] = ["email", "sms", "push"];

export const BLAST_CHANNEL_CHIP_LABEL: Record<BlastChannel, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push · free",
};

/** Today's limit message, shown on the Push chip. */
export const PUSH_AUDIENCE_LIMIT = "pick Your Book, Followers or a saved group";

export function sortBlastChannels(channels: Iterable<BlastChannel>): BlastChannel[] {
  const set = new Set(channels);
  return BLAST_CHANNEL_ORDER.filter((channel) => set.has(channel));
}

/** The method whose draft leads the campaign group. */
export function leadBlastChannel(channels: Iterable<BlastChannel>): BlastChannel {
  return sortBlastChannels(channels)[0] ?? "email";
}

/** Toggles one method. Returns null when that would leave none ticked. */
export function toggleBlastChannel(
  channels: readonly BlastChannel[],
  channel: BlastChannel,
): BlastChannel[] | null {
  const next = channels.includes(channel)
    ? channels.filter((value) => value !== channel)
    : [...channels, channel];
  return next.length === 0 ? null : sortBlastChannels(next);
}

export const isBuyerSourceKey = (key: string): boolean =>
  key === "brand_buyers" || key.startsWith("event:");

export interface BlastAudienceOptionLike {
  kind:
    | "brand_buyers"
    | "event_buyers"
    | "all_brand_people"
    | "manual_group"
    | "brand_followers"
    | "brand_circle_extended";
  target_id: string;
}

/** The server's key for one picker row. */
export function sourceKeyForOption(option: BlastAudienceOptionLike): string {
  switch (option.kind) {
    case "all_brand_people":
      return "book";
    case "brand_followers":
      return "followers";
    case "brand_circle_extended":
      return "extended";
    case "manual_group":
      return `group:${option.target_id}`;
    case "brand_buyers":
      return "brand_buyers";
    case "event_buyers":
      return `event:${option.target_id}`;
    default: {
      const unreachable: never = option.kind;
      return unreachable;
    }
  }
}

/** The source key behind a saved audience's query definition. */
export function sourceKeysForDefinition(
  audienceId: string,
  definition: { kind?: unknown; brand_id?: unknown; event_id?: unknown; sources?: unknown } | null,
): string[] {
  switch (definition?.kind) {
    case "combined_sources":
      return Array.isArray(definition.sources)
        ? definition.sources.filter((key): key is string => typeof key === "string")
        : [];
    case "all_brand_people":
      return ["book"];
    case "brand_followers":
      return ["followers"];
    case "brand_circle_extended":
      return ["extended"];
    case "manual_group":
      return [`group:${audienceId}`];
    case "brand_buyers":
      return ["brand_buyers"];
    case "event_buyers":
      return typeof definition.event_id === "string" ? [`event:${definition.event_id}`] : [];
    default:
      return [];
  }
}

/**
 * One group by one method keeps its existing lane unchanged. Anything wider
 * travels on the combined lane, which is what counts each person once. Followers
 * who are all in the Book also need it: the old follower lane leaves them out.
 */
export function needsCombinedLane(
  sourceKeys: readonly string[],
  channels: readonly BlastChannel[],
  followersAlsoInBook = 0,
): boolean {
  if (sourceKeys.length === 0) return false;
  if (sourceKeys.length > 1 || channels.length > 1) return true;
  return sourceKeys[0] === "followers" && followersAlsoInBook > 0;
}

export interface SendByRules {
  sourceKeys: readonly string[];
  /** The combined lane is live for this host (false keeps one method at a time). */
  combinedAllowed: boolean;
  /** The sealed Book, group or follower lanes accept this audience on their own. */
  sealedAudience: boolean;
  lead: BlastChannel;
  /** Delivery switches per picked Mingla-reach source, by method. */
  followersEnabled?: Partial<Record<BlastChannel, boolean>>;
  extendedEnabled?: Partial<Record<BlastChannel, boolean>>;
}

/** Why each chip cannot be ticked right now. */
export function sendByUnavailable(rules: SendByRules): Partial<Record<BlastChannel, string>> {
  const reasons: Partial<Record<BlastChannel, string>> = {};
  for (const channel of BLAST_CHANNEL_ORDER) {
    if (rules.sourceKeys.includes("followers") && rules.followersEnabled?.[channel] === false) {
      reasons[channel] = "this isn't switched on for Followers yet";
    }
    if (rules.sourceKeys.includes("extended") && rules.extendedEnabled?.[channel] === false) {
      reasons[channel] = "this isn't switched on for Friends of followers yet";
    }
    if (!rules.combinedAllowed && !rules.sealedAudience && channel !== rules.lead) {
      reasons[channel] = PUSH_AUDIENCE_LIMIT;
    }
  }
  // Unchanged rule, now on the chip: a buyer list has no Mingla account
  // guarantee, so Push is off for the whole selection, never for a subset.
  if (rules.sourceKeys.some(isBuyerSourceKey)) reasons.push = PUSH_AUDIENCE_LIMIT;
  return reasons;
}

/**
 * Takes a method off when it stopped being available. At least one stays on: if
 * every ticked method went away, the first available one takes over.
 */
export function reconcileBlastChannels(
  channels: readonly BlastChannel[],
  unavailable: Partial<Record<BlastChannel, string>>,
): BlastChannel[] {
  const kept = sortBlastChannels(channels.filter((channel) => unavailable[channel] === undefined));
  if (kept.length > 0) return kept;
  const fallback = BLAST_CHANNEL_ORDER.find((channel) => unavailable[channel] === undefined);
  return [fallback ?? channels[0] ?? "email"];
}

/** "Your Book + Followers", shortened so the button stays one line. */
export function audienceButtonName(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length <= 3) return names.join(" + ");
  return `${names.slice(0, 2).join(" + ")} + ${names.length - 2} more`;
}

const people = (count: number): string => (count === 1 ? "1 person" : `${count} people`);

/** The button's caption: the server's combined total, never a sum of rows. */
export function combinedCountCaption(count: number | null): string | null {
  return count === null ? null : `${people(count)} · each counted once`;
}

export type PickerCountState =
  | { state: "none" }
  | { state: "counting" }
  | { state: "ready"; people: number }
  | { state: "unavailable" };

export function pickerDoneLabel(count: PickerCountState): string {
  switch (count.state) {
    case "none":
      return "Pick at least one group";
    case "counting":
      return "Counting…";
    case "ready":
      return `Done · ${people(count.people)}`;
    case "unavailable":
      // Never a sum of rows: the review sheet still shows the server's total.
      return "Done";
    default: {
      const unreachable: never = count;
      return unreachable;
    }
  }
}

export function followerRowStatus(input: {
  reachCount: number;
  followersTotal: number | null;
  followersAlsoInBook: number | null;
}): { countLabel: string; pickable: boolean } | null {
  const total = input.followersTotal;
  const also = input.followersAlsoInBook;
  if (total === null || also === null || also === 0) return null;
  const noun = total === 1 ? "follower" : "followers";
  return {
    countLabel: also === total
      ? `${total} ${noun} · also in Your Book`
      : `${total} ${noun} · ${also} also in Your Book`,
    pickable: true,
  };
}

/** AUDIENCE block detail for one group, from the server's totals. */
export function audienceSourceDetail(source: {
  key: string;
  count: number;
  alsoInBookCount: number;
}): string {
  if (source.key === "book" || source.alsoInBookCount === 0) return people(source.count);
  if (source.alsoInBookCount === source.count) {
    return `${people(source.count)}, also in Your Book`;
  }
  return `${people(source.count)}, ${source.alsoInBookCount} also in Your Book`;
}

// ── Pre-fill: one message, written once ─────────────────────────────────────

const PERSONAL_TOKEN =
  /\{(first_name|event_name|event_date|event_date_short|event_time|doors_open|ends_at|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g;
const EVENT_TOKEN = /\{\{event:[^}]*\}\}/g;

/**
 * SMS and push have no personalization step on the way out (only email's send
 * loop substitutes), so a token would reach the guest as raw "{first_name}".
 * The brand name is known here and is written in; the rest are removed.
 */
export function stripUnsupportedTokens(text: string, brandName: string | null): string {
  return text
    .replace(EVENT_TOKEN, " ")
    .replace(/\{brand_name\}/g, brandName ?? "")
    .replace(PERSONAL_TOKEN, "")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t,.;:!?-]+/, "")
    .trim();
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** The email body as one line of plain words: no HTML, no event cards. */
export function emailBodyToPlainText(bodyHtml: string): string {
  return bodyHtml
    .replace(EVENT_TOKEN, " ")
    .replace(/<\s*(style|script)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fitToLength(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 3;
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  // Back up to a whole word unless that would throw away most of the room.
  const end = lastSpace >= room * 0.6 ? lastSpace : room;
  return `${cut.slice(0, end).replace(/[\s,.;:!?-]+$/, "")}...`;
}

/** The STOP footer the adapter adds on its own line: "\n\nReply STOP to opt out." */
const SMS_FOOTER_LENGTH = 24;
/**
 * Auto-filled SMS fits ONE segment with the footer, so filling in never makes a
 * Blast cost more than one text per person. The host can write longer, and the
 * reach, encoding and segment estimate on the card stays visible either way.
 */
export const SMS_PREFILL_MAX_GSM = 160 - SMS_FOOTER_LENGTH;
export const SMS_PREFILL_MAX_UCS2 = 70 - SMS_FOOTER_LENGTH;
export const PUSH_PREFILL_MAX = 120;
export const PUSH_TITLE_MAX = 80;

// Same alphabet test as the send path (utils/smsCost.isGsm7), after its folding.
export interface SmsMeasure {
  isGsm7: (text: string) => boolean;
  sanitizeGsm7: (text: string) => string;
}

export function prefillSmsFromEmail(
  input: { subject: string; bodyHtml: string; brandName: string | null },
  measure: SmsMeasure,
): string {
  const subject = stripUnsupportedTokens(input.subject, input.brandName);
  const body = stripUnsupportedTokens(emailBodyToPlainText(input.bodyHtml), input.brandName);
  if (subject.length === 0 && body.length === 0) return "";
  const headline = subject.length === 0 || /[.!?:]$/.test(subject) ? subject : `${subject}.`;
  const words = [headline, body].filter((part) => part.length > 0).join(" ");
  const brand = input.brandName?.trim() ?? "";
  const full = brand.length > 0 ? `${brand}: ${words}` : words;
  const folded = measure.sanitizeGsm7(full);
  return fitToLength(folded, measure.isGsm7(folded) ? SMS_PREFILL_MAX_GSM : SMS_PREFILL_MAX_UCS2);
}

export function prefillPushFromEmail(input: { bodyHtml: string; brandName: string | null }): string {
  const body = stripUnsupportedTokens(emailBodyToPlainText(input.bodyHtml), input.brandName);
  return fitToLength(body, PUSH_PREFILL_MAX);
}

/** The email subject feeds the push title. */
export function pushTitleFromSubject(subject: string, brandName: string | null): string {
  return fitToLength(stripUnsupportedTokens(subject, brandName), PUSH_TITLE_MAX);
}
