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
  if (hasValue(target.target_id)) return "ok";
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

/** The kinds a host names in their own words ("for my trips"). */
const HOST_KIND_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["event", /\b(?:events?|tickets?|concerts?)\b/i],
  ["experience", /\bexperiences?\b/i],
  ["trip", /\b(?:trips?|tours?)\b/i],
  ["venue_order", /\b(?:menu|food orders?|drinks? orders?|orders)\b/i],
  ["reservation_deposit", /\b(?:reservations?|table deposits?|deposits?)\b/i],
];

export function hostNamedListingKinds(text: string): string[] {
  return HOST_KIND_PATTERNS.flatMap(([kind, pattern]) =>
    pattern.test(text) ? [kind] : []
  );
}

const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  event: "events",
  experience: "experiences",
  trip: "trips",
  venue_order: "venue orders",
  reservation_deposit: "table deposits",
});

export type DiscountTargetDefault =
  | { kind: "default"; listingKinds: string[]; reason: string }
  | { kind: "ask"; listingKinds: string[] };

/**
 * #3355 rework 3b (live eval favy10_mid_flow_ends_at): the listing kind for a
 * discount whose target the model left unspecified. In order:
 *   1. the kinds the host named in their own words;
 *   2. events, when the brand sells events;
 *   3. the brand's only kind;
 *   4. events, when the brand has no listings yet;
 *   5. otherwise ask one question listing the brand's kinds.
 */
export function resolveDiscountTargetDefault(
  brandKinds: readonly string[],
  hostText: string,
): DiscountTargetDefault {
  const named = hostNamedListingKinds(hostText);
  if (named.length > 0) {
    return { kind: "default", listingKinds: named, reason: "host_named" };
  }
  const kinds = [
    ...new Set(brandKinds.filter((kind) => LISTING_KINDS.has(kind))),
  ];
  if (kinds.includes("event")) {
    return {
      kind: "default",
      listingKinds: ["event"],
      reason: "brand_sells_events",
    };
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
    return refuse(
      `Which listings is this discount for: ${
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
  if (hasValue(targetId)) {
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
