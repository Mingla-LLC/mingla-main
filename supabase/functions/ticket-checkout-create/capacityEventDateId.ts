/**
 * issue #3281 PR10 — DETAIL on ticket_capacity_exceeded carries event_date_id.
 * PostgREST may surface DETAIL on `details`, `detail`, or (rarely) `message`.
 */
export function capacityEventDateIdFromError(
  err: { details?: unknown; detail?: unknown; message?: unknown } | null |
    undefined,
): string | null {
  if (err == null) return null;
  const candidates = [err.details, err.detail, err.message];
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (uuidRe.test(trimmed)) return trimmed.toLowerCase();
    const m = trimmed.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
    );
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}
