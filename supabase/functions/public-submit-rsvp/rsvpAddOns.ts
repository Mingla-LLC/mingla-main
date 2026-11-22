/**
 * issue #3281 S6 — the free add-ons a guest picks with their RSVP.
 *
 * The request may carry `rsvpAddOns: [{ addOnId, quantity }]`. Absent, null or
 * empty: the RSVP is submitted exactly as before (#4541's
 * `submit_event_rsvp_with_form`). Otherwise the database wrapper
 * `issue_3281_submit_rsvp_with_add_ons` submits the same RSVP first and then
 * stores the add-ons in the same transaction (dark until
 * `add_on_rollout.rsvp_enabled`; any refusal undoes the RSVP). Paid RSVP
 * add-ons are a later slice and are refused here by the database.
 */

export interface RsvpAddOnRequest {
  addOnId: string;
  quantity: number;
}

export type ParsedRsvpAddOns =
  | { ok: true; addOns: RsvpAddOnRequest[] | null }
  | { ok: false; status: 400; body: { error: "rsvp_add_ons_invalid" } };

export const RSVP_ADD_ONS_RPC = "issue_3281_submit_rsvp_with_add_ons";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_ITEMS = 40;
const MAX_QUANTITY = 400;

const invalid = (): ParsedRsvpAddOns => ({
  ok: false,
  status: 400,
  body: { error: "rsvp_add_ons_invalid" },
});

/** Reads `rsvpAddOns`; null means "none asked for" (today's RSVP call). */
export function parseRsvpAddOns(raw: unknown): ParsedRsvpAddOns {
  if (raw === undefined || raw === null) return { ok: true, addOns: null };
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return invalid();
  if (raw.length === 0) return { ok: true, addOns: null };
  const seen = new Set<string>();
  const addOns: RsvpAddOnRequest[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return invalid();
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "addOnId" && key !== "quantity")) {
      return invalid();
    }
    const { addOnId, quantity } = record;
    if (typeof addOnId !== "string" || !UUID_RE.test(addOnId)) return invalid();
    if (
      typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return invalid();
    }
    const key = addOnId.toLowerCase();
    if (seen.has(key)) return invalid();
    seen.add(key);
    addOns.push({ addOnId, quantity });
  }
  return { ok: true, addOns };
}

const REFUSALS: ReadonlyArray<{ code: string; status: number }> = [
  { code: "rsvp_add_ons_unavailable", status: 409 },
  { code: "rsvp_add_on_needs_payment", status: 409 },
  { code: "extra_not_available", status: 409 },
  { code: "extra_capacity_exceeded", status: 409 },
  { code: "extra_quantity_above_max", status: 400 },
  { code: "extras_invalid", status: 400 },
];

/** A database refusal of the add-ons, as the reply the RSVP form shows; else null. */
export function rsvpAddOnRefusal(
  error: { message?: string | null } | null,
): { status: number; body: { error: string } } | null {
  const message = error?.message ?? "";
  for (const refusal of REFUSALS) {
    if (message.includes(refusal.code)) {
      return { status: refusal.status, body: { error: refusal.code } };
    }
  }
  return null;
}
