/**
 * issue #3281 S6 — the free add-ons a guest picks with their RSVP (pure half).
 *
 * The RSVP reader's `rsvpAddOns` lists every add-on that comes with the RSVP
 * (present only while add_on_rollout.rsvp_enabled is on). Paid RSVP add-ons
 * wait on a product decision, so only free ones (priceCents 0) can be picked:
 * the server refuses a paid one (`rsvp_add_on_needs_payment`).
 *
 * Limits mirror issue_3281_submit_rsvp_with_add_ons: up to maxPerTicket for
 * each person in the party (the guest plus their plus-ones), never more than
 * the places left, and a date-limited add-on counts its places on every date it
 * runs. The server stays the authority.
 *
 * Self-contained on purpose: it shares no module with the ticket cart
 * (ticketExtrasCart / TicketExtrasPicker), so the RSVP picker's on-use chunk
 * never pulls the cart into the Host web boot payload. No array spread or
 * array destructuring (Explorer's class D suites load this package with no
 * Babel runtime helpers).
 */

export interface RsvpAddOnPick {
  addOnId: string;
  quantity: number;
}

export interface RsvpAddOnItem {
  id: string;
  name: string;
  description: string | null;
  maxPerTicket: number;
  /** null when unlimited; a number shared by every date; or a count per date. */
  remaining: number | Record<string, number> | null;
  /** The event_dates it runs on; null means every date. */
  validOccurrenceIds: string[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const whole = (value: unknown, min: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min ? value : null;

/** The RSVP add-ons a guest may pick: the free ones, in the reader's order. */
export function freeRsvpAddOns(raw: unknown): RsvpAddOnItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RsvpAddOnItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
    const maxPerTicket = whole(item.maxPerTicket, 1);
    if (whole(item.priceCents, 0) !== 0 || maxPerTicket === null) continue;
    let remaining: RsvpAddOnItem["remaining"] = null;
    if (item.isUnlimited !== true) {
      if (typeof item.remaining === "number") {
        remaining = Math.max(0, Math.floor(item.remaining));
      } else if (isRecord(item.remaining)) {
        const byDate: Record<string, number> = {};
        for (const key of Object.keys(item.remaining)) {
          const n = item.remaining[key];
          if (typeof n === "number") byDate[key] = Math.max(0, Math.floor(n));
        }
        remaining = byDate;
      } else {
        remaining = 0; // a limited add-on whose count can't be read is not offered
      }
    }
    out.push({
      id: item.id,
      name: item.name,
      description:
        typeof item.description === "string" && item.description.trim().length > 0
          ? item.description
          : null,
      maxPerTicket,
      remaining,
      validOccurrenceIds: Array.isArray(item.validOccurrenceIds)
        ? item.validOccurrenceIds.filter((id): id is string => typeof id === "string")
        : null,
    });
  }
  return out;
}

/** The most of this add-on a party of `partySize` may take; 0 = none left. */
export function rsvpAddOnCap(item: RsvpAddOnItem, partySize: number): number {
  if (partySize <= 0) return 0;
  let cap = item.maxPerTicket * partySize;
  if (typeof item.remaining === "number") {
    cap = Math.min(cap, item.remaining);
  } else if (item.remaining !== null) {
    const counts = item.remaining;
    const dates = item.validOccurrenceIds ?? Object.keys(counts);
    for (const id of dates) cap = Math.min(cap, counts[id] ?? 0);
  }
  return Math.max(0, cap);
}

/** True when every pick is still on offer and within the party's limit. */
export function rsvpAddOnPicksFit(
  picks: readonly RsvpAddOnPick[],
  items: readonly RsvpAddOnItem[],
  partySize: number,
): boolean {
  return picks.every((pick) => {
    const item = items.find((candidate) => candidate.id === pick.addOnId);
    return item !== undefined && pick.quantity <= rsvpAddOnCap(item, partySize);
  });
}

/** Sets one add-on's count; a zero count drops it. Kept in the add-on id order. */
export function withRsvpAddOnQuantity(
  picks: readonly RsvpAddOnPick[],
  addOnId: string,
  quantity: number,
): RsvpAddOnPick[] {
  const next = picks.filter((pick) => pick.addOnId !== addOnId);
  const q = Math.floor(quantity);
  if (q > 0) next.push({ addOnId, quantity: q });
  next.sort((a, b) => a.addOnId.localeCompare(b.addOnId));
  return next;
}

/**
 * The confirmation's "Add-ons" line for an accepted Going reply: what was sent.
 * The server stores exactly these or refuses the whole RSVP, so the guest's own
 * picks are the record (no second read).
 */
export function rsvpAddOnLines(
  raw: unknown,
  picks: readonly RsvpAddOnPick[],
): Array<{ name: string; quantity: number }> {
  const items = freeRsvpAddOns(raw);
  const lines: Array<{ name: string; quantity: number }> = [];
  for (const pick of picks) {
    const item = items.find((candidate) => candidate.id === pick.addOnId);
    if (item !== undefined) lines.push({ name: item.name, quantity: pick.quantity });
  }
  return lines;
}
