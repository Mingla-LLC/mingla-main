// #3281 S6 — the add-ons an admitted RSVP owes at the door.
//
// biz_rsvp_scan returns them with the admission (issue_3281_rsvp_door_add_ons
// inside the same call), so the door path makes no extra round trip; they are
// returned as their own top-level `addOns` field, never inside `doorAnswers`.
// An RSVP with none, or anything malformed, adds no field at all, so the scan
// reply is unchanged for every RSVP without add-ons (and on a database that
// predates add-ons, where the admission never carries the field).

export interface DoorAddOnLine {
  name: string;
  quantity: number;
}

/** The door line's items, or null when there is nothing to show. */
export function parseDoorAddOns(data: unknown): DoorAddOnLine[] | null {
  if (!Array.isArray(data)) return null;
  const lines: DoorAddOnLine[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const { name, quantity } = item as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) continue;
    lines.push({ name, quantity });
  }
  return lines.length > 0 ? lines : null;
}

/**
 * The scan reply with its door line normalised: biz_rsvp_scan puts an
 * admitted RSVP holder's add-ons in its own reply (`addOns`), so the door
 * makes no second read. Only an admitted RSVP holder keeps the field, as
 * `[{ name, quantity }]`; anything else, empty or malformed drops it, so the
 * reply is byte for byte as before for every RSVP without add-ons.
 */
export function withDoorAddOns(
  result: Record<string, unknown>,
  isRsvpHolder: boolean,
): Record<string, unknown> {
  if (!("addOns" in result)) return result;
  const { addOns: raw, ...rest } = result;
  const lines = isRsvpHolder ? parseDoorAddOns(raw) : null;
  return lines === null ? rest : { ...rest, addOns: lines };
}
