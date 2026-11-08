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
    if (typeof listingKind !== "string" || !LISTING_KINDS.has(listingKind)) {
      return refuse(
        "I couldn't tell which kind of listing this discount is for. Say events, experiences or trips and I'll set it up.",
      );
    }
    return { target_kind: "listing_kind", listing_kind: listingKind };
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
  if (typeof listingKind === "string" && LISTING_KINDS.has(listingKind)) {
    // No id but a kind: the Host meant every listing of that kind.
    return { target_kind: "listing_kind", listing_kind: listingKind };
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
