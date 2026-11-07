/**
 * Issue #3355 P1 (D-9) — deterministic money and publish refusals.
 *
 * The publish and money RPCs refuse with stable lowercase codes
 * (`RAISE EXCEPTION 'stripe_charges_disabled'`). Before this module those
 * arrived as RPC_FAILED / WRITE_FAILED, which agent-confirm-action treats as
 * "the write may have committed": the row stayed `executing` and the owner saw
 * "Ari is verifying the result" for a refusal that changed nothing.
 *
 * A Postgres RAISE rolls the whole RPC transaction back, receipt begin
 * included, so each code below is a definite "nothing was saved". They become
 * one typed, terminal ToolError (`DOMAIN_REFUSED`) whose message is the owner
 * sentence: the confirm path stores it as `DOMAIN_REFUSED: <sentence>` and the
 * Host thread shows "That didn't go through. <sentence>".
 *
 * Codes are matched as whole tokens (the same rule as the Organiser Terms
 * code in agentToolHelpers.ts): a longer code that merely contains one is a
 * different refusal and stays where it was.
 *
 * The meaning of every code is owned by the RPC bodies and by the Host's
 * `mingla-business/src/utils/paidPublishGuards.ts`; this file only words them.
 * A parity test keeps every Host guard reason present here.
 */

export const DOMAIN_REFUSED_CODE = "DOMAIN_REFUSED";

export type AriRefusalWho = "owner" | "admin" | "anyone";

export interface AriRefusalCopy {
  /** One plain owner sentence: what is wrong and what to do. No codes. */
  message: string;
  /**
   * Host route template for the fix, `{brandId}` / `{eventId}` substituted by
   * the caller when known. null when the fix is "answer differently".
   */
  fixRoute: string | null;
  /** Who can clear it. */
  who: AriRefusalWho;
}

const PAYMENTS_ONBOARD = "/brand/{brandId}/payments/onboard";

// #3355: every deterministic refusal code maps to a typed DOMAIN_REFUSED
// (I-ARI-DETERMINISTIC-REFUSAL-TYPED, declared in
// supabase/functions/_shared/__tests__/issue_3355_turn_hygiene.implementor.test.ts).
export const ARI_REFUSAL_COPY: Readonly<Record<string, AriRefusalCopy>> = Object
  .freeze({
    stripe_charges_disabled: {
      message:
        "This brand can't take payments yet, so nothing was published. Finish payment setup in Payments, then ask me again.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "admin",
    },
    payment_collection_unavailable: {
      message:
        "This brand can't take payments yet, so nothing was published. Finish payment setup in Payments, then ask me again.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "admin",
    },
    event_currency_required: {
      message:
        "Paid tickets need a payout currency, and that comes from payment setup. Finish it in Payments, or make the tickets free. Nothing was saved.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "admin",
    },
    event_currency_unsupported: {
      message:
        "That currency isn't supported for paid tickets yet. Choose your brand's payout currency instead. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    paid_currency_not_ready: {
      message:
        "This brand's payout currency isn't ready for paid tickets yet. Finish payment setup in Payments, then ask me again. Nothing was saved.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "admin",
    },
    ticket_currency_must_match_event_currency: {
      message:
        "Every ticket has to use the same currency as the event. Pick one currency and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    offering_date_past: {
      message:
        "That date has already passed. Pick a date that's still ahead and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    trip_date_past: {
      message:
        "That trip date has already passed. Pick dates that are still ahead and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    // #3355 P8 — the Ari trip create refuses what the owner hasn't given.
    trip_timezone_required: {
      message:
        "The trip needs a time zone. Tell me the city it's in and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    trip_dates_required: {
      message:
        "The trip needs its first and last day. Tell me them and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    trip_dates_invalid: {
      message:
        "The last day of the trip has to be on or after the first day. Pick the dates again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    trip_place_invalid: {
      message:
        "Pick the place from the search suggestions and ask me again. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    trip_refund_policy_draft_only: {
      message:
        "A published trip's refund policy is changed in the trip editor. Nothing was saved.",
      fixRoute: null,
      who: "anyone",
    },
    city_required: {
      message:
        "Add the city where this happens before publishing (or mark it online). Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    party_types_required: {
      message:
        "Choose what kind of event this is before publishing. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    party_types_not_canonical: {
      message:
        "One of the event types isn't one Mingla offers. Pick from the list and ask me again. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    private_access_not_ready: {
      message:
        "Private events can't be published yet. Choose Public or Unlisted and ask me again. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    event_title_required: {
      message:
        "This event needs a title before it can be published. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    event_ticket_required: {
      message:
        "This event needs at least one ticket before it can be published. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    event_date_required: {
      message:
        "This event needs a date and time before it can be published. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    insufficient_event_permission: {
      message:
        "Your role on this brand can't make that change. Ask a brand admin to do it. Nothing was saved.",
      fixRoute: null,
      who: "admin",
    },
    trip_pricing_tier_required: {
      message:
        "This trip needs at least one price option before it can be published. Nothing was published.",
      fixRoute: null,
      who: "anyone",
    },
    bank_required_for_installments: {
      message:
        "Payment plans need a connected bank account first. The brand owner can add one in Payments. Nothing was saved.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "owner",
    },
    payout_not_ready: {
      message:
        "Payouts aren't set up for this brand yet. Finish payment setup in Payments, then ask me again. Nothing was saved.",
      fixRoute: PAYMENTS_ONBOARD,
      who: "admin",
    },
  });

export const ARI_REFUSAL_CODES: readonly string[] = Object.freeze(
  Object.keys(ARI_REFUSAL_COPY),
);

function tokenPattern(code: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9_])${code}(?:$|[^a-z0-9_])`);
}

const REFUSAL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> =
  ARI_REFUSAL_CODES
    .map((code) => [code, tokenPattern(code)] as const);

/** The refusal code `raw` carries as a whole token, else null. */
export function detectAriRefusalCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  for (const [code, pattern] of REFUSAL_PATTERNS) {
    if (pattern.test(raw)) return code;
  }
  return null;
}

/**
 * The owner sentence for the refusal `raw` carries, else null. Callers build
 * the typed `ToolError(DOMAIN_REFUSED_CODE, message)` (agentToolHelpers.ts
 * owns ToolError; importing it here would make an import cycle).
 */
export function ariDomainRefusalMessage(raw: unknown): string | null {
  const code = detectAriRefusalCode(raw);
  return code === null ? null : ARI_REFUSAL_COPY[code].message;
}

/**
 * #4304 — owner sentences for the Host discount writer's refusals.
 *
 * `brand-discount-upsert` answers a refused write with a stable `detail`
 * (SQL RAISE codes and the CHECK constraints it maps). These are scoped to
 * that one writer — never matched as global tokens, because generic words such
 * as `window_invalid` mean something else elsewhere. Every refusal rolled the
 * RPC transaction back, so each sentence ends "Nothing was saved."
 */
export const DISCOUNT_WRITE_REFUSAL_COPY: Readonly<Record<string, string>> =
  Object.freeze({
    code_taken:
      "That code is already used by another live discount on this brand. Pick a different code and ask me again. Nothing was saved.",
    code_shape_invalid:
      "Discount codes need 4 to 16 letters or numbers, with no symbols (for example SUMMER20). Pick a code like that and ask me again. Nothing was saved.",
    value_shape_invalid:
      "The discount amount didn't add up. Tell me either a percentage off or a fixed amount off, and ask me again. Nothing was saved.",
    currency_missing:
      "A fixed amount off needs the brand's currency, and this brand doesn't have one yet. Finish payment setup in Payments, or use a percentage off instead. Nothing was saved.",
    currency_mismatch:
      "That amount isn't in this brand's currency. Use the brand's currency or a percentage off. Nothing was saved.",
    target_shape_invalid:
      "I couldn't tell which listings this discount is for. Name the event, experience or trip, or say it's for everything of one kind. Nothing was saved.",
    target_not_discountable:
      "That listing can't take a discount (it may be free, an RSVP, or deleted). Pick a paid listing and ask me again. Nothing was saved.",
    target_not_in_brand:
      "That listing belongs to a different brand. Pick one of this brand's listings and ask me again. Nothing was saved.",
    scope_target_mismatch:
      "A sale price works on one ticket or item at a time. Pick the single ticket or item and ask me again. Nothing was saved.",
    set_price_needs_one_item:
      "A sale price works on one ticket or item at a time. Pick the single ticket or item and ask me again. Nothing was saved.",
    set_price_not_lower:
      "A sale price has to be lower than the current price. Pick a lower price and ask me again. Nothing was saved.",
    sale_price_overlap:
      "That item already has a sale running in that window. End it first or pick other dates. Nothing was saved.",
    too_many_automatics:
      "This brand already has the most automatic discounts it can run at once. End one first, then ask me again. Nothing was saved.",
    window_invalid:
      "The discount has to end after it starts. Give me an end date after the start and ask me again. Nothing was saved.",
    schedule_invalid:
      "That schedule doesn't fit a discount. Codes run for a date window; daily hours and use-count endings are for automatic discounts. Nothing was saved.",
    name_invalid:
      "Discount names need 1 to 60 characters. Give me a shorter name and ask me again. Nothing was saved.",
    kind_not_available:
      "That kind of discount isn't available yet. Try a code or an automatic discount. Nothing was saved.",
    insufficient_permission:
      "Your role on this brand can't make that kind of discount. Ask a finance manager or brand admin to do it. Nothing was saved.",
    version_conflict:
      "This discount changed somewhere else a moment ago. Ask me to load it again, then redo the change. Nothing was saved.",
    discount_not_found:
      "I couldn't find that discount any more. It may have been deleted. Nothing was saved.",
    invalid_input:
      "Something in that discount wasn't in a form I can save (a date or listing). Tell me again and I'll redo it. Nothing was saved.",
  });
