/**
 * issue #3281 — what the payment page lists for the add-ons in a cart.
 *
 * The session RPC returns the add-ons it priced (`extras`: one item per
 * add-on and ticket, `addOnName` and `quantity`). The hosted card page shows
 * them in its line description and the bank-transfer page in its custom
 * fields, one entry per add-on: "Add-on: {name} × {qty}". A cart without
 * add-ons gets nothing here, so every provider request stays byte-identical.
 */

import { addOnReceiptName } from "../_shared/buyerConfirmationPayload.ts";

/** Provider description fields are short: keep the joined text inside 500. */
export const ADD_ON_DESCRIPTION_MAX = 500;

/** "Add-on: {name} × {qty}" for each priced add-on, in the session's order. */
export function addOnLineDescriptions(extras: unknown): string[] {
  if (!Array.isArray(extras)) return [];
  const out: string[] = [];
  for (const item of extras) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.addOnName === "string" ? row.addOnName.trim() : "";
    const qty = Number(row.quantity);
    if (name.length === 0 || !Number.isInteger(qty) || qty <= 0) continue;
    out.push(`${addOnReceiptName(name)} × ${qty}`);
  }
  return out;
}

/**
 * The hosted page's line description: the discount note (when there is one)
 * then the add-ons, joined. Undefined when there is neither, so the request
 * omits the field exactly as before.
 */
export function hostedLineDescription(
  discountNote: string | null,
  addOns: readonly string[],
): string | undefined {
  const parts = [
    ...(discountNote !== null && discountNote.length > 0 ? [discountNote] : []),
    ...addOns,
  ];
  if (parts.length === 0) return undefined;
  const joined = parts.join(" · ");
  return joined.length <= ADD_ON_DESCRIPTION_MAX
    ? joined
    : `${joined.slice(0, ADD_ON_DESCRIPTION_MAX - 1)}…`;
}

/** The bank-transfer page's custom fields, one per add-on (empty: none). */
export function paystackAddOnCustomFields(
  addOns: readonly string[],
): Array<{ display_name: string; variable_name: string; value: string }> {
  return addOns.map((value, index) => ({
    display_name: "Add-on",
    variable_name: `mingla_add_on_${index + 1}`,
    value,
  }));
}
