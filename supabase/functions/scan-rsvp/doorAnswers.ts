// #4541 — pure RSVP scanner door-answer authority and subject selection.

export const RSVP_DOOR_ANSWERS_DEADLINE_MS = 1500;
export const RSVP_DOOR_FULL_ANSWERS_WINDOW_MS = 30 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMITTED = new Set(["success", "duplicate"]);
// #4541 R8.3: only a fresh admission by this actor is a receipt for full answers.
export const RSVP_DOOR_FULL_ANSWERS_RECEIPTS: ReadonlySet<string> = new Set(["success"]);

export type RsvpDoorSubject = { kind: "rsvp" | "rsvp_guest"; id: string };

/** Only an admitted primary or an explicitly claimed plus-one owns a door line. */
export function rsvpDoorSubjectFromScanResult(
  result: Record<string, unknown>,
): RsvpDoorSubject | null {
  if (typeof result.result !== "string" || !ADMITTED.has(result.result)) return null;
  const entityId = typeof result.entityId === "string" && UUID.test(result.entityId)
    ? result.entityId
    : null;
  if (entityId === null) return null;
  if (result.entityType === "primary") return { kind: "rsvp", id: entityId };
  if (result.entityType === "guest" && result.claimed === true) {
    return { kind: "rsvp_guest", id: entityId };
  }
  return null;
}

/** Full answers require this actor's recent fresh admission (success) at this event. */
export function ownsRecentAdmittedScan(
  row: Record<string, unknown> | null,
  actorId: string,
  eventId: string,
  nowMs: number = Date.now(),
): boolean {
  const scannedAt = typeof row?.scanned_at === "string" ? Date.parse(row.scanned_at) : NaN;
  return row !== null && row.scanner_user_id === actorId && row.requested_event_id === eventId &&
    typeof row.outcome === "string" && RSVP_DOOR_FULL_ANSWERS_RECEIPTS.has(row.outcome) &&
    !Number.isNaN(scannedAt) &&
    nowMs >= scannedAt && nowMs - scannedAt <= RSVP_DOOR_FULL_ANSWERS_WINDOW_MS;
}
