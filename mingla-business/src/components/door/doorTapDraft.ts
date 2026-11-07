/**
 * issue #4271 — the door sale draft passed between door screens.
 *
 * Sheet → Tap to Pay: `/event/<id>/door/tap/new?draft=<base64 json>`.
 * "Sell another" (after a tap sale or a pay code) →
 * `/event/<id>/door?sellAnother=1&draft=<base64 json>`, which reopens the
 * sheet with the same tickets (see doorSellAnotherHref).
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
  phoneCountryIso?: string | null;
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
      ...(draft.phoneCountryIso ? { phoneCountryIso: draft.phoneCountryIso } : {}),
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
      phoneCountryIso: typeof record.phoneCountryIso === "string" ? record.phoneCountryIso : null,
    };
  } catch {
    return null;
  }
};

/** "Sell another": reopen the door sale sheet with the same tickets. */
export const doorSellAnotherHref = (
  eventId: string,
  draft: DoorTapDraft,
  method?: "pay_code" | "cash",
): string =>
  `/event/${eventId}/door?sellAnother=1&draft=${encodeURIComponent(encodeDoorTapDraft(draft))}${
    method !== undefined ? `&method=${method}` : ""
  }`;

export const doorTapNewSaleHref = (eventId: string, draft: DoorTapDraft): string =>
  `/event/${eventId}/door/tap/new?draft=${encodeURIComponent(encodeDoorTapDraft(draft))}`;
