// #4304 — Ari discount proposals are shaped to the SQL contract before a card.
//
// Production 2026-11-06 17:19 UTC: Ari proposed WYTHE20 with a target carrying
// BOTH `target_id` and `listing_kind` ({target_kind:"event", listing_kind:
// "event", target_id}). `brand_discount_targets.bdt_shape` allows exactly one
// of the two, so the INSERT inside issue_3872_upsert_discount violated the
// check, the edge writer answered 500 and the Host saw "EDGE_FAILED".
//
// This canonicaliser runs where every Ari proposal is canonicalised
// (agent-chat before the card, agent-confirm-action before execution, and the
// executor itself), so the stored proposal, the edited proposal and the write
// all carry the one shape SQL accepts:
//   - a specific listing:   target_kind + target_id, never listing_kind
//   - a whole listing kind: target_kind "listing_kind" + listing_kind, never
//                           target_id
//   - percent:              value_bps only
//   - amount / set_price:   value_minor only
//   - code:                 uppercased, spaces/dashes removed, 4-16 letters or
//                           numbers (bd_code_shape) — refused in plain words
//                           BEFORE any card when it cannot fit.
// It is idempotent: canonical args come back unchanged.

import { ToolError } from "./agentToolHelpers.ts";

/** Said to the Host as plain words before any card (OWNER_SPOKEN). */
export const DISCOUNT_PROPOSAL_REFUSED_CODE = "DISCOUNT_PROPOSAL_INVALID";

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

const LISTING_KINDS = new Set([
  "event",
  "experience",
  "trip",
  "venue_order",
  "reservation_deposit",
]);

/**
 * The kinds as hosts (and Flash) say them. #3355 rework 3b: Flash also writes
 * "event_ticket", "event_tickets" and "ticketed_events" for the event kind.
 */
const LISTING_KIND_WORDS: Readonly<Record<string, string>> = Object.freeze({
  events: "event",
  event_ticket: "event",
  event_tickets: "event",
  ticketed_event: "event",
  ticketed_events: "event",
  ticket: "event",
  tickets: "event",
  experiences: "experience",
  trips: "trip",
  tour: "trip",
  tours: "trip",
});

/**
 * #3355 rework 3b: words that name no kind at all ("all", "everything"). A
 * target written with one of these, or with no kind and no listing, is
 * UNSPECIFIED: agent-chat resolves it from the host's words and the brand's
 * listings (resolveDiscountTargetDefault) before the canonicaliser runs.
 * Any other unknown kind is still refused (#4304).
 */
const UNSPECIFIED_KIND_WORDS: ReadonlySet<string> = new Set([
  "all",
  "any",
  "every",
  "everything",
  "all_listings",
  "all_kinds",
  "brand",
  "brand_wide",
  "listing",
  "listings",
  "listing_kind",
]);

/** A listing kind word, canonical: the kind, "unspecified", or null (invalid). */
export function readListingKindWord(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "unspecified";
  if (typeof raw !== "string") return null;
  const word = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (word === "") return "unspecified";
  if (LISTING_KINDS.has(word)) return word;
  if (LISTING_KIND_WORDS[word]) return LISTING_KIND_WORDS[word];
  if (UNSPECIFIED_KIND_WORDS.has(word)) return "unspecified";
  return null;
}

/** Target kinds that name one listing (they need a target_id). */
const SPECIFIC_TARGET_KINDS: ReadonlySet<string> = new Set([
  "event",
  "ticket_type",
  "venue_menu",
  "menu_item",
  "venue_deposit",
]);

/**
 * How one raw target reads before canonicalising: "ok" (valid as is or by a
 * synonym), "unspecified" (no kind named), or "invalid" (a kind word Ari does
 * not know — still refused).
 */
function targetReading(raw: unknown): "ok" | "unspecified" | "invalid" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "unspecified";
  }
  const target = raw as Record<string, unknown>;
  if (target.target_kind === "listing_kind") {
    const kind = readListingKindWord(target.listing_kind);
    return kind === null
      ? "invalid"
      : kind === "unspecified"
      ? "unspecified"
      : "ok";
  }
  if (hasListingId(target.target_id)) return "ok";
  if (hasValue(target.listing_kind)) {
    const kind = readListingKindWord(target.listing_kind);
    if (kind === null) return "invalid";
    if (kind !== "unspecified") return "ok";
  }
  // A specific kind with no listing named ("event" with no id) names no
  // listing: #4304 refuses it on its own; agent-chat binds it from the host's
  // words and the brand's listings. A target kind Ari does not know stays
  // invalid.
  if (typeof target.target_kind === "string") {
    const word = target.target_kind.trim().toLowerCase();
    if (SPECIFIC_TARGET_KINDS.has(word)) return "unspecified";
    if (readListingKindWord(word) === null) return "invalid";
  }
  return "unspecified";
}

/**
 * #3355 rework 3b: true when a create_discount proposal names no listing kind
 * for one of its targets (or a listing-scoped code has no targets at all),
 * so the server must resolve the kind before any card.
 */
export function discountTargetsNeedDefault(
  args: Record<string, unknown>,
): boolean {
  if (args.kind === "sale_price" || args.value_type === "set_price") {
    return false;
  }
  const targets = Array.isArray(args.targets) ? args.targets : null;
  if (!targets || targets.length === 0) {
    return args.scope_kind === "listing_kinds" ||
      args.scope_kind === "listings";
  }
  return targets.some((raw) => targetReading(raw) === "unspecified");
}

/**
 * #3355 rework 4 (R4-3): the kinds a host names in their own words. Venue
 * kinds come ONLY from explicit phrases ("venue orders", "menu orders",
 * "food and drink orders", "table deposits"); bare "orders" ("10% off all
 * orders over ₦10,000", "the first 20 orders") and bare "deposit" ("no
 * deposit needed") never pick a kind. A phrase after "no", "not",
 * "without", "except" or "excluding" never selects.
 */
const HOST_KIND_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["event", /\b(?:events?|concerts?)\b/gi],
  ["experience", /\bexperiences?\b/gi],
  ["trip", /\btrips?\b/gi],
  [
    "venue_order",
    /\b(?:venue|menu|food|drinks?|bar|food\s+and\s+drinks?|food\s*(?:&|\/)\s*drinks?)\s+orders?\b/gi,
  ],
  [
    "reservation_deposit",
    /\b(?:table|reservation|booking)\s+deposits?\b|\btable\s+(?:reservations?|bookings?)\b/gi,
  ],
];

/**
 * Words that name a kind only when the brand sells it: "tickets" (events,
 * or a brand with no listings yet) and "tour" (trips; "the whole tour" on an
 * events brand is an event tour).
 */
const WEAK_KIND_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["event", /\btickets?\b/gi],
  ["trip", /\btours?\b/gi],
];

const NEGATED_BEFORE =
  /\b(?:no|not|without|except|excluding|exclude|never|but\s+not)\s+(?:\S+\s+){0,2}$/i;

function namedKinds(
  patterns: ReadonlyArray<[string, RegExp]>,
  text: string,
): string[] {
  const out: string[] = [];
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(
        Math.max(0, (match.index ?? 0) - 40),
        match.index,
      );
      if (NEGATED_BEFORE.test(before)) continue;
      if (!out.includes(kind)) out.push(kind);
      break;
    }
  }
  return out;
}

export function hostNamedListingKinds(text: string): string[] {
  return namedKinds(HOST_KIND_PATTERNS, text);
}

const VENUE_KINDS: ReadonlySet<string> = new Set([
  "venue_order",
  "reservation_deposit",
]);

const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  event: "events",
  experience: "experiences",
  trip: "trips",
  venue_order: "venue orders",
  reservation_deposit: "table deposits",
});

export type DiscountTargetDefault =
  | { kind: "default"; listingKinds: string[]; reason: string }
  | { kind: "ask"; listingKinds: string[]; notSold?: string[] };

/**
 * #3355 rework 3b / rework 4: the listing kind for a discount whose target
 * the model left unspecified. In order:
 *   1. the kinds the host named in their own words, when the brand sells
 *      them (venue orders and table deposits are taken as named; "tickets"
 *      and "tour" count only for a brand that sells events / trips). A kind
 *      the host named that the brand does not sell, while it sells other
 *      kinds, asks one question;
 *   2. the brand's only kind;
 *   3. events, when the brand has no listings yet;
 *   4. otherwise (R4-11, the brand sells several kinds and the host named
 *      none) ONE question listing the brand's kinds. Ari never assumes
 *      events for a brand that also sells trips or experiences.
 */
export function resolveDiscountTargetDefault(
  brandKinds: readonly string[],
  hostText: string,
  /** R5-5: the code being bound; its own clause of the message decides. */
  code?: string | null,
): DiscountTargetDefault {
  const kinds = [
    ...new Set(brandKinds.filter((kind) => LISTING_KINDS.has(kind))),
  ];
  const namedIn = (text: string): string[] => [
    ...new Set([
      ...hostNamedListingKinds(text),
      ...namedKinds(WEAK_KIND_PATTERNS, text).filter((kind) =>
        kinds.includes(kind) || (kinds.length === 0 && kind === "event")
      ),
    ]),
  ];
  // R5-5: with several codes in the message and no code given, kinds named
  // for different codes are not merged: ask.
  const codes = codesNamedIn(hostText);
  if (!code && codes.length >= 2) {
    const per = codes.map((each) => namedIn(codeClause(hostText, each)).join());
    if (new Set(per.filter(Boolean)).size > 1) {
      return {
        kind: "ask",
        listingKinds: kinds.length > 0 ? kinds : ["event"],
      };
    }
  }
  const text = code ? codeClause(hostText, code) : hostText;
  const strong = hostNamedListingKinds(text);
  const weak = namedKinds(WEAK_KIND_PATTERNS, text).filter((kind) =>
    kinds.includes(kind) || (kinds.length === 0 && kind === "event")
  );
  const named = [...new Set([...strong, ...weak])];
  if (named.length > 0) {
    if (kinds.length === 0) {
      return { kind: "default", listingKinds: named, reason: "host_named" };
    }
    const notSold = named.filter((kind) =>
      !kinds.includes(kind) && !VENUE_KINDS.has(kind)
    );
    if (notSold.length === 0) {
      return { kind: "default", listingKinds: named, reason: "host_named" };
    }
    return { kind: "ask", listingKinds: kinds, notSold };
  }
  if (kinds.length === 1) {
    return { kind: "default", listingKinds: kinds, reason: "brand_only_kind" };
  }
  if (kinds.length === 0) {
    return {
      kind: "default",
      listingKinds: ["event"],
      reason: "brand_no_listings",
    };
  }
  return { kind: "ask", listingKinds: kinds };
}

/**
 * #3355 rework 5 (R5-5): the codes a host message names (upper-case words
 * with a digit, "FAVY10", "GIRLS20"), in order of first mention.
 */
const CODE_TOKEN =
  /(?<![\p{L}\p{N}])[A-Za-z][A-Za-z0-9]{3,15}(?![\p{L}\p{N}])/gu;
function codesNamedIn(text: string, also?: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(CODE_TOKEN)) {
    const upper = match[0].toUpperCase();
    const coded = /\d/.test(match[0]) && /^[A-Z0-9]+$/.test(match[0]);
    if ((coded || upper === also) && !out.includes(upper)) out.push(upper);
  }
  return out;
}

/**
 * #3355 rework 5 (R5-5): the part of the host's message that is about one
 * code. "FAVY10 10% off, and GIRLS20 20% off orders over ₦10,000": FAVY10's
 * clause is "FAVY10 10% off, and", so GIRLS20's minimum is not FAVY10's.
 * The words before the first code are shared ("For orders over ₦5,000 make
 * FAVY10 and GIRLS20"), a code listed straight into the next ("FAVY10 and
 * GIRLS20, both for orders over ₦5,000") shares that clause, and a clause
 * saying "both", "all", "each" or "every" is shared. With one code (or the
 * code not in the message) the whole message is its clause.
 */
export function codeClause(text: string, code: string | null): string {
  if (!code) return text;
  const target = normaliseAriDiscountCode(code);
  const hits = [...text.matchAll(CODE_TOKEN)].filter((match) => {
    const upper = match[0].toUpperCase();
    return upper === target ||
      (/\d/.test(match[0]) && /^[A-Z0-9]+$/.test(match[0]));
  });
  const codes = new Set(hits.map((match) => match[0].toUpperCase()));
  if (codes.size < 2 || !codes.has(target)) return text;
  const segments = hits.map((match, index) => ({
    code: match[0].toUpperCase(),
    text: text.slice(
      match.index ?? 0,
      hits[index + 1]?.index ?? text.length,
    ),
  }));
  const content = (segment: { code: string; text: string }) =>
    segment.text.slice(segment.code.length).replace(
      /[^\p{L}\p{N}₦$£€%]+/gu,
      " ",
    )
      .trim().toLowerCase();
  const parts = [text.slice(0, hits[0].index ?? 0)];
  segments.forEach((segment, index) => {
    if (segment.code === target) {
      parts.push(segment.text);
      // Listed straight into the next code: the next clause is shared.
      let next = index;
      while (
        /^(?:|and|plus|or|&)$/.test(content(segments[next])) &&
        segments[next + 1]
      ) {
        next++;
        parts.push(segments[next].text);
      }
    } else if (/\b(?:both|all|each|every|either)\b/i.test(segment.text)) {
      parts.push(segment.text);
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * #3355 rework 4 (R4-3) / rework 5 (R5-4): "10% off all orders over
 * ₦10,000", "minimum order ₦5,000", "when they spend over 10k" set the
 * minimum order (minor units), never the target kind. Only a currency amount
 * counts: a currency mark or code ("₦", "NGN", "$", "naira") or "k". A count
 * ("orders over 10 tickets", "bookings over 4 guests") is not money, and
 * spaced thousands ("₦10 000") are read whole.
 */
const MINIMUM_LEAD = String
  .raw`\b(?:(?:orders?|purchases?|baskets?|carts?|bookings?|spend(?:ing)?|spends?|buy(?:ing)?)\s+(?:of\s+|worth\s+|totalling\s+|totaling\s+)?(?:over|above|more\s+than|at\s+least|of\s+at\s+least|from)|minimum\s+(?:order|spend|purchase)(?:\s+(?:of|is|value))?|min\.?\s+(?:order|spend)(?:\s+of)?)`;
const MINIMUM_ORDER = new RegExp(
  String
    .raw`${MINIMUM_LEAD}\s*(₦|NGN|N(?=\d)|US\$|\$|USD|£|GBP|€|EUR|CA\$|CAD|GH₵|GHS|KSh|KES)?\s*(\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?(?:\s*(naira|ngn|dollars?|usd|pounds?|gbp|euros?|eur|cedis?|ghs|shillings?|kes))?(?![\w%])(\s+(?:tickets?|guests?|people|persons?|seats?|items?|pax|tables?|spots?|places?|attendees?|bookings?|orders?|units?|heads?|passes?|nights?|rooms?))?`,
  "i",
);

const CURRENCY_OF: ReadonlyArray<[RegExp, string]> = [
  [/^(?:₦|ngn|n|naira)$/i, "NGN"],
  [/^(?:us\$|\$|usd|dollars?)$/i, "USD"],
  [/^(?:ca\$|cad)$/i, "CAD"],
  [/^(?:£|gbp|pounds?)$/i, "GBP"],
  [/^(?:€|eur|euros?)$/i, "EUR"],
  [/^(?:gh₵|ghs|cedis?)$/i, "GHS"],
  [/^(?:ksh|kes|shillings?)$/i, "KES"],
];

function currencyOf(mark: string | undefined): string | null {
  if (!mark) return null;
  return CURRENCY_OF.find(([pattern]) => pattern.test(mark.trim()))?.[1] ??
    null;
}

/** What the host stated as a minimum order. */
export type StatedMinimum =
  | { kind: "amount"; minor: number; currency: string | null }
  | { kind: "count"; count: number; noun: string }
  | { kind: "no_currency"; amount: number }
  | { kind: "currency_mismatch"; currency: string };

export function parseStatedMinimumOrder(
  text: string,
  brandCurrency?: string | null,
): StatedMinimum | null {
  const match = MINIMUM_ORDER.exec(text);
  if (!match) return null;
  const [, prefix, whole, cents, thousands, suffix, count] = match;
  const number = Number(whole.replace(/[, ]/g, "")) +
    (cents ? Number(`0.${cents}`) : 0);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (count) {
    return { kind: "count", count: number, noun: count.trim().toLowerCase() };
  }
  const currency = currencyOf(prefix) ?? currencyOf(suffix);
  if (!currency && !thousands) return { kind: "no_currency", amount: number };
  const brand = brandCurrency ? brandCurrency.trim().toUpperCase() : null;
  if (currency && brand && currency !== brand) {
    return { kind: "currency_mismatch", currency };
  }
  const major = number * (thousands ? 1_000 : 1);
  return { kind: "amount", minor: Math.round(major * 100), currency };
}

function countNoun(noun: string): string {
  if (/^(?:people|pax|persons?)$/.test(noun)) return "people";
  return /s$/.test(noun) ? noun : `${noun}s`;
}

export function statedMinimumOrderMinor(
  text: string,
  brandCurrency?: string | null,
): number | null {
  const stated = parseStatedMinimumOrder(text, brandCurrency);
  return stated?.kind === "amount" ? stated.minor : null;
}

/**
 * Fills min_subtotal_minor from the host's words (the code's own clause,
 * R5-5) when the model left it out. A ticket or guest count, a number with
 * no currency, or a currency other than the brand's is asked about in one
 * plain question before any card (R5-4); Mingla minimums are amounts only.
 */
export function applyStatedMinimumOrder(
  args: Record<string, unknown>,
  hostText: string,
  brandCurrency?: string | null,
): Record<string, unknown> {
  if (args.kind === "sale_price" || args.value_type === "set_price") {
    return args;
  }
  const code = typeof args.code === "string" && args.code.trim()
    ? normaliseAriDiscountCode(args.code)
    : null;
  const stated = parseStatedMinimumOrder(
    codeClause(hostText, code),
    brandCurrency,
  );
  if (!stated) return args;
  const subject = code ?? "this discount";
  if (stated.kind === "count") {
    return refuse(
      `Mingla discounts can have a minimum order amount, but not a minimum number of ${
        countNoun(stated.noun)
      }. Should ${subject} have a minimum order amount instead, or no minimum? Tell me and I'll set it up.`,
    );
  }
  if (hasValue(args.min_subtotal_minor)) return args;
  if (stated.kind === "no_currency") {
    return refuse(
      `Is the minimum order for ${subject} ${
        stated.amount.toLocaleString("en-US")
      } in your brand's currency? Tell me the amount with its currency and I'll set it up.`,
    );
  }
  if (stated.kind === "currency_mismatch") {
    return refuse(
      `Your brand sells in ${
        (brandCurrency ?? "").toUpperCase()
      }, so the minimum order for ${subject} has to be in ${
        (brandCurrency ?? "").toUpperCase()
      } too. What should it be? Tell me and I'll set it up.`,
    );
  }
  return { ...args, min_subtotal_minor: stated.minor };
}

function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * Applies the resolved default to every unspecified target (valid targets
 * are kept as they are). An "ask" throws one plain question listing the
 * brand's kinds (DISCOUNT_PROPOSAL_INVALID, said before any card).
 */
export function applyDiscountTargetDefault(
  args: Record<string, unknown>,
  resolved: DiscountTargetDefault,
): Record<string, unknown> {
  if (resolved.kind === "ask") {
    const labels = resolved.listingKinds.map((kind) =>
      `your ${KIND_LABELS[kind] ?? kind}`
    );
    const code = typeof args.code === "string" && args.code.trim()
      ? normaliseAriDiscountCode(args.code)
      : null;
    const subject = code ? code : "this discount";
    if (resolved.notSold && resolved.notSold.length > 0) {
      const missing = listInWords(
        resolved.notSold.map((kind) => KIND_LABELS[kind] ?? kind),
      );
      return refuse(
        `You don't have any ${missing} yet. Should ${subject} be for ${
          listInWords(labels)
        }? Tell me and I'll set it up.`,
      );
    }
    return refuse(
      `Which listings is ${subject} for: ${
        listInWords(labels)
      }? Tell me and I'll set it up.`,
    );
  }
  const defaults = resolved.listingKinds.map((kind) => ({
    target_kind: "listing_kind",
    listing_kind: kind,
  }));
  const targets = Array.isArray(args.targets) ? args.targets : [];
  const kept = targets.filter((raw) => targetReading(raw) !== "unspecified");
  const out: Record<string, unknown> = {
    ...args,
    targets: [...kept, ...defaults],
  };
  if (kept.length === 0) out.scope_kind = "listing_kinds";
  return out;
}

const refuse = (message: string): never => {
  throw new ToolError(DISCOUNT_PROPOSAL_REFUSED_CODE, message);
};

const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

/**
 * #3355 rework 5 (R5-18): a listing id that names a listing. The nil UUID
 * (`00000000-0000-0000-0000-000000000000`, a model placeholder) names none:
 * the target is unspecified, so the server fill-in binds it.
 */
const NIL_UUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const hasListingId = (value: unknown): boolean =>
  hasValue(value) &&
  !(typeof value === "string" && NIL_UUID.test(value.trim()));

/** Uppercase and strip spaces / dashes, exactly as the SQL writer does. */
export function normaliseAriDiscountCode(raw: unknown): string {
  return typeof raw === "string"
    ? raw.trim().replace(/[\s-]/g, "").toUpperCase()
    : "";
}

function canonicalTarget(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return refuse(
      "I couldn't tell which listing this discount is for. Tell me the event, experience or trip, or say it's for everything of one kind.",
    );
  }
  const target = raw as Record<string, unknown>;
  const targetKind = target.target_kind;
  const listingKind = target.listing_kind;
  const targetId = target.target_id;

  if (targetKind === "listing_kind") {
    // #3355 Wave F / rework 3b (live eval): Flash writes the kind as the host
    // says it ("events", "tickets", "event_ticket"). Those name the same
    // kind; anything else is still refused in plain words.
    const spoken = readListingKindWord(listingKind);
    if (spoken !== null && LISTING_KINDS.has(spoken)) {
      return { target_kind: "listing_kind", listing_kind: spoken };
    }
    return refuse(
      "I couldn't tell which kind of listing this discount is for. Say events, experiences or trips and I'll set it up.",
    );
  }
  if (typeof targetKind !== "string" || targetKind.length === 0) {
    return refuse(
      "I couldn't tell which listing this discount is for. Tell me the event, experience or trip, or say it's for everything of one kind.",
    );
  }
  if (hasListingId(targetId)) {
    // A specific listing: the id names it; listing_kind would break bdt_shape.
    return { target_kind: targetKind, target_id: targetId };
  }
  const spokenKind = readListingKindWord(listingKind);
  if (spokenKind !== null && LISTING_KINDS.has(spokenKind)) {
    // No id but a kind: the Host meant every listing of that kind.
    return { target_kind: "listing_kind", listing_kind: spokenKind };
  }
  return refuse(
    "I couldn't tell which listing this discount is for. Tell me the event, experience or trip, or say it's for everything of one kind.",
  );
}

/**
 * #3355 rework 7 (R7-11): the host typed a valid code ("Create a discount
 * code FAVY10…") but the model's proposal carries a code that is not one
 * (mangled, with a symbol, too long). The host's own code is used, exactly
 * as they wrote it (normalised the way the SQL writer does), so the refusal
 * never tells the host their valid code is invalid. Any other proposal is
 * unchanged.
 */
export function withHostStatedDiscountCode(
  toolName: string,
  args: Record<string, unknown>,
  hostCode: string | null | undefined,
): Record<string, unknown> {
  if (toolName !== "create_discount" || args.kind !== "code") return args;
  const host = normaliseAriDiscountCode(hostCode);
  if (!DISCOUNT_CODE_PATTERN.test(host)) return args;
  if (DISCOUNT_CODE_PATTERN.test(normaliseAriDiscountCode(args.code))) {
    return args;
  }
  return { ...args, code: host };
}

/**
 * Canonical `create_discount` args. Throws DISCOUNT_PROPOSAL_INVALID with an
 * owner sentence when the proposal cannot be made valid without guessing.
 */
export function canonicalizeCreateDiscountArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };

  if (typeof out.name === "string") out.name = out.name.trim();
  if (typeof out.name === "string" && out.name.length > 60) {
    refuse(
      "Discount names can be up to 60 characters. Give me a shorter name and I'll set it up.",
    );
  }

  if (out.kind === "code") {
    const code = normaliseAriDiscountCode(out.code);
    if (!DISCOUNT_CODE_PATTERN.test(code)) {
      refuse(
        "Discount codes need 4 to 16 letters or numbers, with no symbols (for example SUMMER20). Tell me the code you'd like and I'll set it up.",
      );
    }
    out.code = code;
  } else {
    delete out.code;
  }

  if (out.value_type === "percent") {
    delete out.value_minor;
    if (!hasValue(out.value_bps)) {
      refuse("How much off should this be? Tell me the percentage.");
    }
  } else if (out.value_type === "amount" || out.value_type === "set_price") {
    delete out.value_bps;
    if (!hasValue(out.value_minor)) {
      refuse(
        out.value_type === "amount"
          ? "How much off should this be? Tell me the amount."
          : "What should the sale price be? Tell me the amount.",
      );
    }
  }

  if (Array.isArray(out.targets)) {
    const seen = new Set<string>();
    const targets: Record<string, unknown>[] = [];
    for (const raw of out.targets) {
      const target = canonicalTarget(raw);
      const key = target.target_kind === "listing_kind"
        ? `kind:${String(target.listing_kind)}`
        : `${String(target.target_kind)}:${String(target.target_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    out.targets = targets;
  }
  return out;
}
