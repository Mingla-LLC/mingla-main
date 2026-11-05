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

const REMOVABLE_TOKEN =
  /\{\{event:[^}]*\}\}|\{(?:first_name|event_name|event_date|event_date_short|event_time|doors_open|ends_at|event_url|spots_left|previous_event_name|next_event_name|event_id|brand_name)\}/;

/**
 * SMS and push have no personalization step on the way out (only email's send
 * loop substitutes), so a token would reach the guest as raw "{first_name}".
 * The brand name is known here and is written in; the rest are removed.
 *
 * This runs on what the host typed, so it touches ONLY the spot a token held:
 * the space and punctuation a removal would strand. Everything else, emoticons,
 * lists, "...", "!!!", line breaks, comes back exactly as written.
 */
export function stripUnsupportedTokens(text: string, brandName: string | null): string {
  const brand = brandName?.trim() ?? "";
  let out = text.split("{brand_name}").join(brand.length > 0 ? brand : "{brand_name}");
  for (;;) {
    const match = REMOVABLE_TOKEN.exec(out);
    if (match === null) return out;
    out = removeTokenAt(out, match.index, match[0].length);
  }
}

function removeTokenAt(text: string, start: number, length: number): string {
  let before = text.slice(0, start);
  let after = text.slice(start + length);
  const spaceBefore = /[ \t]+$/.test(before);
  const spaceAfter = /^[ \t]+/.test(after);
  before = before.replace(/[ \t]+$/, "");
  after = after.replace(/^[ \t]+/, "");
  const lineStart = before.length === 0 || before.endsWith("\n");
  const closing = /^[,.!?;:]+/.exec(after)?.[0] ?? "";
  if (lineStart) {
    // Nothing is left for the punctuation to close.
    return before + after.slice(closing.length).replace(/^[ \t]+/, "");
  }
  if (closing.length > 0) {
    // "Friday, {first_name}." reads "Friday.", never "Friday,."
    return before.replace(/[,;:]$/, "") + after;
  }
  if (after.length === 0 || after.startsWith("\n")) return before + after;
  return `${before}${spaceBefore || spaceAfter ? " " : ""}${after}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201D", ldquo: "\u201C",
  sbquo: "\u201A", bdquo: "\u201E", prime: "\u2032", Prime: "\u2033",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", bull: "\u2022", middot: "\u00B7",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122", deg: "\u00B0", para: "\u00B6", sect: "\u00A7",
  euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2", curren: "\u00A4",
  times: "\u00D7", divide: "\u00F7", plusmn: "\u00B1", frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
  iexcl: "\u00A1", iquest: "\u00BF", laquo: "\u00AB", raquo: "\u00BB", shy: "", zwj: "\u200D", zwnj: "\u200C",
  aacute: "\u00E1", agrave: "\u00E0", acirc: "\u00E2", atilde: "\u00E3", auml: "\u00E4", aring: "\u00E5", aelig: "\u00E6",
  ccedil: "\u00E7", eacute: "\u00E9", egrave: "\u00E8", ecirc: "\u00EA", euml: "\u00EB",
  iacute: "\u00ED", igrave: "\u00EC", icirc: "\u00EE", iuml: "\u00EF", ntilde: "\u00F1",
  oacute: "\u00F3", ograve: "\u00F2", ocirc: "\u00F4", otilde: "\u00F5", ouml: "\u00F6", oslash: "\u00F8",
  uacute: "\u00FA", ugrave: "\u00F9", ucirc: "\u00FB", uuml: "\u00FC", yacute: "\u00FD", yuml: "\u00FF", szlig: "\u00DF",
  Aacute: "\u00C1", Agrave: "\u00C0", Auml: "\u00C4", Eacute: "\u00C9", Egrave: "\u00C8", Ntilde: "\u00D1", Ouml: "\u00D6", Uuml: "\u00DC",
};

/** One pass only, so "&amp;lt;" reads "&lt;" as the author wrote it. */
function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (whole, code: string) => {
    if (code.startsWith("#")) {
      const value = /^#[xX]/.test(code)
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      const valid = value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
      return valid ? String.fromCodePoint(value) : " ";
    }
    // An unknown name is markup, not words: it never reaches a guest as text.
    return NAMED_ENTITIES[code] ?? (/^[a-zA-Z]+[0-9]*$/.test(code) ? " " : whole);
  });
}

/** The email body as one line of plain words: no HTML, no event cards. */
export function emailBodyToPlainText(bodyHtml: string): string {
  return decodeEntities(
    bodyHtml
      .replace(/\{\{event:[^}]*\}\}/g, " ")
      .replace(/<\s*(style|script)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Filled-in text is ours to tidy; what the host typed never comes through here. */
function tidyFilledText(text: string): string {
  return text
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t,.;:!?-]+/, "")
    .trim();
}

/** Marks that attach to the character before them, so a cut cannot land there. */
const ATTACHES_TO_PREVIOUS = /^[\u0300-\u036F\u200D\uFE0E\uFE0F\u20E3]|^\uD83C[\uDFFB-\uDFFF]|^\uDB40[\uDC20-\uDC7F]/;

/** The longest whole-character prefix within `units`. Never half an emoji. */
function cutAtCharacter(text: string, units: number): string {
  let end = Math.min(units, text.length);
  for (;;) {
    if (end <= 0) return "";
    const last = text.charCodeAt(end - 1);
    const isHalfPair = last >= 0xd800 && last <= 0xdbff;
    const rest = text.slice(end);
    if (!isHalfPair && !ATTACHES_TO_PREVIOUS.test(rest) && last !== 0x200d) {
      return text.slice(0, end);
    }
    end -= 1;
  }
}

const GSM_EXTENDED = "^{}\\[~]|\u20AC";

/** What a carrier counts: each GSM extended character costs two septets. */
export function gsmSeptets(text: string): number {
  let total = 0;
  for (const character of text) total += GSM_EXTENDED.includes(character) ? 2 : 1;
  return total;
}

function fitToLength(
  text: string,
  max: number,
  measure: (value: string) => number = (value) => value.length,
): string {
  if (measure(text) <= max) return text;
  const room = max - measure("...");
  let cut = cutAtCharacter(text, room);
  while (measure(cut) > room) cut = cutAtCharacter(cut, cut.length - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Back up to a whole word unless that would throw away most of the room.
  const end = lastSpace >= cut.length * 0.6 ? lastSpace : cut.length;
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
  const subject = tidyFilledText(stripUnsupportedTokens(input.subject, input.brandName));
  const body = tidyFilledText(stripUnsupportedTokens(emailBodyToPlainText(input.bodyHtml), input.brandName));
  if (subject.length === 0 && body.length === 0) return "";
  const headline = subject.length === 0 || /[.!?:]$/.test(subject) ? subject : `${subject}.`;
  const words = [headline, body].filter((part) => part.length > 0).join(" ");
  const brand = input.brandName?.trim() ?? "";
  const full = brand.length > 0 ? `${brand}: ${words}` : words;
  const folded = measure.sanitizeGsm7(full);
  return measure.isGsm7(folded)
    ? fitToLength(folded, SMS_PREFILL_MAX_GSM, gsmSeptets)
    : fitToLength(folded, SMS_PREFILL_MAX_UCS2);
}

export function prefillPushFromEmail(input: { bodyHtml: string; brandName: string | null }): string {
  const body = tidyFilledText(stripUnsupportedTokens(emailBodyToPlainText(input.bodyHtml), input.brandName));
  return fitToLength(body, PUSH_PREFILL_MAX);
}

/** The email subject feeds the push title. */
export function pushTitleFromSubject(subject: string, brandName: string | null): string {
  return fitToLength(tidyFilledText(stripUnsupportedTokens(subject, brandName)), PUSH_TITLE_MAX);
}

// ── Plain sentences for choices made on the host's behalf ───────────────────

const METHOD_NAME: Record<BlastChannel, string> = { email: "Email", sms: "SMS", push: "Push" };

/**
 * A method the host ticked went away because of the groups they picked. Says so
 * in a sentence, because a chip going grey is easy to miss when the Blast then
 * goes out by a method they never chose.
 */
export function blastFallbackSentence(
  before: readonly BlastChannel[],
  after: readonly BlastChannel[],
  sourceKeys: readonly string[],
): string | null {
  const dropped = before.filter((channel) => !after.includes(channel));
  if (dropped.length === 0 || after.length === 0) return null;
  const names = dropped.map((channel) => METHOD_NAME[channel]).join(" and ");
  const who = dropped.includes("push") && sourceKeys.some(isBuyerSourceKey)
    ? "a buyer list"
    : "these groups";
  const replacement = after.filter((channel) => !before.includes(channel));
  const method = (replacement.length > 0 ? replacement : after)
    .map((channel) => METHOD_NAME[channel]).join(" and ");
  return replacement.length > 0
    ? `${names} can't reach ${who}, so this will go by ${method} instead.`
    : `${names} can't reach ${who}, so this will go by ${method} only.`;
}

/**
 * A method nobody can receive on must not hold back the others: when the lead
 * reaches no one and another method reaches someone, the lead steps aside.
 */
export function leadStepsAside(
  leadReachable: number | null,
  siblingReachable: readonly (number | null)[],
): boolean {
  return leadReachable === 0 && siblingReachable.some((count) => (count ?? 0) > 0);
}

/** The SMS card's reach line when there is no number yet. */
export function smsReachNote(state: "none_picked" | "loading" | "unavailable"): string {
  switch (state) {
    case "none_picked":
      return "Pick who gets this to see reach";
    case "loading":
      return "Loading reach…";
    case "unavailable":
      return "Reach shows on review";
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
