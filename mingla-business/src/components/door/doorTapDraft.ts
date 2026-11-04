/**
 * issue #4271 — the hand-off from the door sale sheet to the Tap to Pay route.
 *
 * The sheet navigates to `/event/<id>/door/tap/new?draft=<base64 json>` with
 * `{lines, eventDateId, buyerPhone?}`. The tap route (owned by the Tap to Pay
 * build) decodes it with `decodeDoorTapDraft`. The payload is ASCII only
 * (uuids, integers, an E.164 number), so plain base64 is safe on every
 * runtime that ships `btoa`/`atob` (Hermes, browsers, Node 16+).
 */

export interface DoorTapDraft {
  lines: { ticketTypeId: string; quantity: number }[];
  eventDateId: string | null;
  buyerPhone?: string | null;
}

export const encodeDoorTapDraft = (draft: DoorTapDraft): string =>
  btoa(
    JSON.stringify({
      lines: draft.lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
      })),
      eventDateId: draft.eventDateId,
      ...(draft.buyerPhone ? { buyerPhone: draft.buyerPhone } : {}),
    }),
  );

export const decodeDoorTapDraft = (raw: string | null | undefined): DoorTapDraft | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(atob(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.lines)) return null;
    const lines = record.lines.flatMap((line: unknown) => {
      if (typeof line !== "object" || line === null) return [];
      const l = line as Record<string, unknown>;
      return typeof l.ticketTypeId === "string" &&
        typeof l.quantity === "number" &&
        Number.isInteger(l.quantity) &&
        l.quantity > 0
        ? [{ ticketTypeId: l.ticketTypeId, quantity: l.quantity }]
        : [];
    });
    if (lines.length === 0) return null;
    return {
      lines,
      eventDateId: typeof record.eventDateId === "string" ? record.eventDateId : null,
      buyerPhone: typeof record.buyerPhone === "string" ? record.buyerPhone : null,
    };
  } catch {
    return null;
  }
};

export const doorTapNewSaleHref = (eventId: string, draft: DoorTapDraft): string =>
  `/event/${eventId}/door/tap/new?draft=${encodeURIComponent(encodeDoorTapDraft(draft))}`;
