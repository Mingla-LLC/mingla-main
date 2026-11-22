/**
 * #4548 — what a guest sees of a Guest pack, decided in one place.
 *
 * Pure (no React Native, no storage): the Explorer card, its tests and the
 * three ticket views read these rules. The server returns the pack to every
 * holder at any time, so the "until 24 hours after the event ends" cut-off
 * lives here, using the event's own end time.
 */

export interface GuestPackItem {
  label: string;
  url: string;
}

export interface GuestPackData {
  note: string | null;
  items: GuestPackItem[];
  updatedAt: string | null;
}

/** A guest can read the pack until this long after the event ends. */
export const GUEST_PACK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * True while the card may show. Uses the event's end, falling back to its
 * start when no end is known; with neither, the card stays (never hides a pack
 * on a missing time). A date that cannot be read also keeps the card.
 */
export function isGuestPackWindowOpen(input: {
  endsAtIso: string | null | undefined;
  startsAtIso?: string | null;
  now?: number;
}): boolean {
  const reference = input.endsAtIso ?? input.startsAtIso ?? null;
  if (reference === null || reference === "") return true;
  const ends = Date.parse(reference);
  if (Number.isNaN(ends)) return true;
  return (input.now ?? Date.now()) <= ends + GUEST_PACK_GRACE_MS;
}

const HIDDEN_ORDER_STATUSES = new Set([
  "refunded",
  "cancelled",
  "canceled",
  "pending",
  "failed",
  "expired",
  "abandoned",
]);

/** An order shows the pack unless it is refunded, cancelled or not paid yet. */
export function isOrderGuestPackEligible(input: {
  paymentStatus: string | null | undefined;
  cancelledAt?: string | null;
}): boolean {
  if (input.cancelledAt) return false;
  const status = (input.paymentStatus ?? "").trim().toLowerCase();
  if (status === "") return false;
  return !HIDDEN_ORDER_STATUSES.has(status);
}

/** An RSVP shows the pack only when going and approved (a pending guest never does). */
export function isRsvpGuestPackEligible(input: {
  status: string | null | undefined;
  approvalStatus: string | null | undefined;
}): boolean {
  return input.status === "going" && input.approvalStatus === "approved";
}

export type GuestPackRowKind = "pdf" | "page";

/** "Open PDF" only when the link's path ends in .pdf; Drive and the rest are web pages. */
export function guestPackRowKind(url: string): GuestPackRowKind {
  try {
    return /\.pdf$/i.test(new URL(url).pathname) ? "pdf" : "page";
  } catch {
    return "page";
  }
}

/** The link's site, so two rows of the same label stay apart ("www." dropped). */
export function guestPackSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/**
 * Keeps the items the in-app opener can open, in the host's order. A stored
 * item the classifier refuses is dropped and reported to `onRejected` (logged
 * by the caller), never opened.
 */
export function openableGuestPackItems(
  items: ReadonlyArray<GuestPackItem>,
  classify: (url: string) => { kind: string },
  onRejected?: (item: GuestPackItem) => void,
): GuestPackItem[] {
  const out: GuestPackItem[] = [];
  for (const item of items) {
    const kind = classify(item.url).kind;
    if (kind === "web" || kind === "document") out.push(item);
    else onRejected?.(item);
  }
  return out;
}

/** True when the host changed the pack after the guest's booking was made. */
export function isGuestPackUpdatedAfter(
  updatedAt: string | null | undefined,
  bookedAtIso: string | null | undefined,
): boolean {
  if (!updatedAt || !bookedAtIso) return false;
  const updated = Date.parse(updatedAt);
  const booked = Date.parse(bookedAtIso);
  if (Number.isNaN(updated) || Number.isNaN(booked)) return false;
  return updated > booked;
}

/** Whether there is anything to show once the items are filtered. */
export function hasGuestPackContent(
  note: string | null,
  items: ReadonlyArray<unknown>,
): boolean {
  return (note !== null && note.trim() !== "") || items.length > 0;
}

/** Defensive read of `pg_my_event_guest_pack`: anything that is not a pack is "no pack". */
export function parseGuestPack(value: unknown): GuestPackData | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const note = typeof row.note === "string" && row.note.trim() !== "" ? row.note : null;
  const items: GuestPackItem[] = [];
  if (Array.isArray(row.items)) {
    for (const raw of row.items) {
      if (raw === null || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.label === "string" && typeof item.url === "string") {
        items.push({ label: item.label, url: item.url });
      }
    }
  }
  if (note === null && items.length === 0) return null;
  return {
    note,
    items,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}
