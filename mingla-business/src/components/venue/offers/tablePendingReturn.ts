/**
 * #4490 P5-3 — a paid table booking that is waiting for the guest to come back
 * from the secure payment page.
 *
 * The table-hold payment returns to `/reserve/<brand>/confirm` (backend P5
 * deviation 11: that address is fixed by the #2050 gate). If the return lands
 * somewhere this device can't confirm from (a local stack whose return goes
 * to the public site, a closed tab, another browser), the guest is never
 * stranded: the venue page finds the waiting booking on this device and
 * confirms it ("Check my payment"), and the confirm page shows the table, the
 * hold and the minimum spend it was booked with. Stored on this device only;
 * nothing personal beyond what the guest typed, and dropped once confirmed or
 * after 6 hours.
 */

export interface PendingTableBooking {
  reservationDraftId: string;
  buyerStatusToken: string;
  brandId: string;
  venueId: string;
  venuePath: string | null;
  venueName: string | null;
  /** "B3 · Fri 21 Nov · 20:00 · 4 guests". */
  summary: string;
  holdLine: string | null;
  minSpendLine: string | null;
  savedAt: number;
}

const PREFIX = "mingla.venueTablePending.";
export const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage !== undefined ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isPendingFresh(p: PendingTableBooking, now: number): boolean {
  return now >= p.savedAt && now - p.savedAt < PENDING_TTL_MS;
}

export function parsePending(raw: string | null): PendingTableBooking | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingTableBooking>;
    if (typeof v.reservationDraftId !== "string" || typeof v.buyerStatusToken !== "string" || typeof v.venueId !== "string") return null;
    return {
      reservationDraftId: v.reservationDraftId,
      buyerStatusToken: v.buyerStatusToken,
      brandId: typeof v.brandId === "string" ? v.brandId : "",
      venueId: v.venueId,
      venuePath: typeof v.venuePath === "string" ? v.venuePath : null,
      venueName: typeof v.venueName === "string" ? v.venueName : null,
      summary: typeof v.summary === "string" ? v.summary : "",
      holdLine: typeof v.holdLine === "string" ? v.holdLine : null,
      minSpendLine: typeof v.minSpendLine === "string" ? v.minSpendLine : null,
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function savePending(p: PendingTableBooking): void {
  const s = storage();
  if (s === null) return;
  try {
    s.setItem(`${PREFIX}venue.${p.venueId}`, JSON.stringify(p));
    s.setItem(`${PREFIX}draft.${p.reservationDraftId}`, JSON.stringify(p));
  } catch {
    // Private mode / full storage: the confirm page still works on its own.
  }
}

export function readPendingForVenue(venueId: string, now: number = Date.now()): PendingTableBooking | null {
  const s = storage();
  if (s === null) return null;
  try {
    const p = parsePending(s.getItem(`${PREFIX}venue.${venueId}`));
    return p !== null && isPendingFresh(p, now) ? p : null;
  } catch {
    return null;
  }
}

export function readPendingForDraft(draftId: string, now: number = Date.now()): PendingTableBooking | null {
  const s = storage();
  if (s === null) return null;
  try {
    const p = parsePending(s.getItem(`${PREFIX}draft.${draftId}`));
    return p !== null && isPendingFresh(p, now) ? p : null;
  } catch {
    return null;
  }
}

export function clearPending(p: Pick<PendingTableBooking, "venueId" | "reservationDraftId">): void {
  const s = storage();
  if (s === null) return;
  try {
    s.removeItem(`${PREFIX}venue.${p.venueId}`);
    s.removeItem(`${PREFIX}draft.${p.reservationDraftId}`);
  } catch {
    // nothing to clear
  }
}

// ------------------------------------------------------- guest waitlist tokens

const WL = "mingla.venueWaitlistToken.";

export function saveWaitlistToken(waitlistId: string, token: string): void {
  const s = storage();
  if (s === null) return;
  try {
    s.setItem(`${WL}${waitlistId}`, token);
  } catch {
    // the link in the address keeps working
  }
}

export function readWaitlistToken(waitlistId: string): string | null {
  const s = storage();
  if (s === null) return null;
  try {
    return s.getItem(`${WL}${waitlistId}`);
  } catch {
    return null;
  }
}
