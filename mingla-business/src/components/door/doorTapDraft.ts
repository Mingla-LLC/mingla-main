/**
 * issue #4271 — the door sale draft passed between door screens.
 *
 * Door mode → Tap to Pay: `/event/<id>/door/tap/new?draft=<base64 json>`.
 * "Sell another" (after a tap sale or a pay code) →
 * `/event/<id>/door/sell?draft=<base64 json>` (Door mode, #4389), which opens
 * with the same tickets.
 *
 * This file holds the shape and the door hub's reader (decodeDoorTapDraft). The
 * writers (encodeDoorTapDraft, doorSellAnotherHref, doorTapNewSaleHref) are in
 * doorTapDraftHref.ts, which only the on-intent door chunk imports, so the
 * UTF-8 encoder they need stays out of the eager web __common chunk. An ASCII
 * payload encodes exactly as `btoa` would, so `atob` here still reads it.
 */

export interface DoorTapDraft {
  lines: { ticketTypeId: string; quantity: number }[];
  eventDateId: string | null;
  buyerPhone?: string | null;
  phoneCountryIso?: string | null;
  /** Door polish: shown on the tap paid screen's Guest row only. */
  buyerName?: string | null;
}

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
      phoneCountryIso: typeof record.phoneCountryIso === "string" ? record.phoneCountryIso : null,
    };
  } catch {
    return null;
  }
};
