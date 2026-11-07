// #4304 — one source of truth for the Host discount writer's refusals
// (`brand-discount-upsert` response `detail`). Every refusal rolled the SQL
// transaction back, so nothing was saved.
//
// `host` is shown in the Business app's manual discount editor; `ari` is the
// sentence Ari says in chat (supabase/functions/_shared/ariRefusalCopy.ts
// re-exports DISCOUNT_WRITE_REFUSAL_COPY). Pure data: no imports, so Deno edge
// functions and the React Native app both read this file.

export interface DiscountWriteRefusalCopy {
  /** Inline error in the Host's discount editor. */
  host: string;
  /** Ari's chat sentence (ends "Nothing was saved."). */
  ari: string;
}

export const DISCOUNT_WRITE_REFUSALS: Readonly<
  Record<string, DiscountWriteRefusalCopy>
> = Object.freeze({
  code_taken: {
    host:
      "That code is already used by another live discount. Pick a different code.",
    ari:
      "That code is already used by another live discount on this brand. Pick a different code and ask me again. Nothing was saved.",
  },
  code_shape_invalid: {
    host:
      "Codes need 4 to 16 letters or numbers, with no symbols (for example SUMMER20).",
    ari:
      "Discount codes need 4 to 16 letters or numbers, with no symbols (for example SUMMER20). Pick a code like that and ask me again. Nothing was saved.",
  },
  value_shape_invalid: {
    host: "Set either a percentage off or a fixed amount off, then save again.",
    ari:
      "The discount amount didn't add up. Tell me either a percentage off or a fixed amount off, and ask me again. Nothing was saved.",
  },
  currency_missing: {
    host:
      "A fixed amount off needs your brand's currency. Finish payment setup in Payments, or use a percentage off.",
    ari:
      "A fixed amount off needs the brand's currency, and this brand doesn't have one yet. Finish payment setup in Payments, or use a percentage off instead. Nothing was saved.",
  },
  currency_mismatch: {
    host:
      "That amount isn't in your brand's currency. Use the brand's currency or a percentage off.",
    ari:
      "That amount isn't in this brand's currency. Use the brand's currency or a percentage off. Nothing was saved.",
  },
  target_shape_invalid: {
    host: "Pick the listings this discount is for again, then save.",
    ari:
      "I couldn't tell which listings this discount is for. Name the event, experience or trip, or say it's for everything of one kind. Nothing was saved.",
  },
  target_not_discountable: {
    host:
      "One of the picked listings can't take a discount (it may be free, an RSVP, or deleted). Remove it and save again.",
    ari:
      "That listing can't take a discount (it may be free, an RSVP, or deleted). Pick a paid listing and ask me again. Nothing was saved.",
  },
  target_not_in_brand: {
    host:
      "One of the picked listings belongs to a different brand. Remove it and save again.",
    ari:
      "That listing belongs to a different brand. Pick one of this brand's listings and ask me again. Nothing was saved.",
  },
  scope_target_mismatch: {
    host:
      "A sale price works on one ticket or item at a time. Pick a single ticket or item.",
    ari:
      "A sale price works on one ticket or item at a time. Pick the single ticket or item and ask me again. Nothing was saved.",
  },
  set_price_needs_one_item: {
    host:
      "A sale price works on one ticket or item at a time. Pick a single ticket or item.",
    ari:
      "A sale price works on one ticket or item at a time. Pick the single ticket or item and ask me again. Nothing was saved.",
  },
  set_price_not_lower: {
    host: "A sale price must be lower than the list price.",
    ari:
      "A sale price has to be lower than the current price. Pick a lower price and ask me again. Nothing was saved.",
  },
  sale_price_overlap: {
    host: "This item already has a sale in that time window.",
    ari:
      "That item already has a sale running in that window. End it first or pick other dates. Nothing was saved.",
  },
  too_many_automatics: {
    host:
      "This brand already has the maximum number of live automatic discounts.",
    ari:
      "This brand already has the most automatic discounts it can run at once. End one first, then ask me again. Nothing was saved.",
  },
  window_invalid: {
    host: "The end date has to be after the start date.",
    ari:
      "The discount has to end after it starts. Give me an end date after the start and ask me again. Nothing was saved.",
  },
  schedule_invalid: {
    host:
      "That schedule doesn't fit this discount. Daily hours and use-count endings are only for automatic discounts.",
    ari:
      "That schedule doesn't fit a discount. Codes run for a date window; daily hours and use-count endings are for automatic discounts. Nothing was saved.",
  },
  name_invalid: {
    host: "Names need 1 to 60 characters.",
    ari:
      "Discount names need 1 to 60 characters. Give me a shorter name and ask me again. Nothing was saved.",
  },
  kind_not_available: {
    host: "That kind of discount isn't available yet.",
    ari:
      "That kind of discount isn't available yet. Try a code or an automatic discount. Nothing was saved.",
  },
  insufficient_permission: {
    host:
      "Your role on this brand can't make that kind of discount. Ask a finance manager or brand admin.",
    ari:
      "Your role on this brand can't make that kind of discount. Ask a finance manager or brand admin to do it. Nothing was saved.",
  },
  version_conflict: {
    host:
      "This discount changed elsewhere. Load latest, then redo your change.",
    ari:
      "This discount changed somewhere else a moment ago. Ask me to load it again, then redo the change. Nothing was saved.",
  },
  discount_not_found: {
    host: "This discount no longer exists. It may have been deleted.",
    ari:
      "I couldn't find that discount any more. It may have been deleted. Nothing was saved.",
  },
  invalid_input: {
    host:
      "A date or listing in this discount isn't valid. Check the fields and try again.",
    ari:
      "Something in that discount wasn't in a form I can save (a date or listing). Tell me again and I'll redo it. Nothing was saved.",
  },
});

/** Ari's sentence per writer detail (scoped to brand-discount-upsert). */
export const DISCOUNT_WRITE_REFUSAL_COPY: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(DISCOUNT_WRITE_REFUSALS).map(([detail, copy]) => [
        detail,
        copy.ari,
      ]),
    ),
  );

export const DISCOUNT_WRITE_FALLBACK_HOST_COPY =
  "Couldn't save this discount. Check the fields and try again.";

/** The editor's inline error for a writer `detail` (unknown → generic). */
export function discountWriteHostCopy(detail: unknown): string {
  return typeof detail === "string" &&
      Object.prototype.hasOwnProperty.call(DISCOUNT_WRITE_REFUSALS, detail)
    ? DISCOUNT_WRITE_REFUSALS[detail].host
    : DISCOUNT_WRITE_FALLBACK_HOST_COPY;
}
