// #3281 S6 — the add-ons an admitted RSVP owes at the door.
//
// Read after admission (it can never change the scan result) through the
// service-role function issue_3281_rsvp_door_add_ons, and returned as its own
// top-level `addOns` field, never inside `doorAnswers`. An RSVP with none, a
// failed or slow read, or anything malformed adds no field at all, so the scan
// reply is unchanged for every RSVP without add-ons.

export interface DoorAddOnLine {
  name: string;
  quantity: number;
}

export interface DoorAddOnsClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: { message: string } | null }> };
}

export const RSVP_DOOR_ADD_ONS_DEADLINE_MS = 1500;

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

export async function readRsvpDoorAddOns(
  client: DoorAddOnsClient,
  rsvpId: string,
  deadlineMs: number = RSVP_DOOR_ADD_ONS_DEADLINE_MS,
): Promise<DoorAddOnLine[] | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  try {
    const { data, error } = await client
      .rpc("issue_3281_rsvp_door_add_ons", { p_rsvp_id: rsvpId })
      .abortSignal(deadline.signal);
    if (error !== null) {
      console.warn(JSON.stringify({ event: "rsvp_door_add_ons_unread", reason: error.message }));
      return null;
    }
    return parseDoorAddOns(data);
  } catch (caught) {
    console.warn(JSON.stringify({
      event: "rsvp_door_add_ons_unread",
      reason: caught instanceof Error ? caught.name : "unknown",
    }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
