/**
 * #4490 Explorer W2 — the signed-in owner's calls for a venue booking, plan or
 * waitlist place in Purchases. Every call uses the user's session (the owner
 * path: `venue-offers`, `venue-membership-pay-link`, `venue-waitlist`); the
 * app never holds a booking, member or waitlist token. The server answers the
 * owner's own reads with the pass QR.
 *
 * Every failure throws `VenuePurchaseError` carrying the server's code; the
 * screen turns it into plain words (never a raw code).
 */
import {
  parseEntryCancelPreview,
  type EntryCancelPreview,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  parseGuestChangeSummary,
  type GuestChangeSummary,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import { supabase } from "./supabase";
import {
  parseVenueBooking,
  parseVenueMember,
  type VenueBooking,
  type VenueMember,
} from "../components/purchases/venuePurchaseModel";

export class VenuePurchaseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code.replaceAll("_", " "));
    this.name = "VenuePurchaseError";
    this.code = code;
  }
}

type Fn = "venue-offers" | "venue-membership-pay-link" | "venue-waitlist";

const randomId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  return typeof maybeCrypto?.randomUUID === "function"
    ? maybeCrypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** One idempotency key per user action (a retry of the same tap reuses it). */
export const venueActionKey = (scope: string): string => `venue-app:${scope}:${randomId()}`;

async function invoke(fn: Fn, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let code = "venue_request_failed";
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = (await context.json()) as { code?: unknown };
        if (typeof parsed.code === "string") code = parsed.code;
      } catch {
        // Keep the stable fallback when the edge answer is not JSON.
      }
    }
    throw new VenuePurchaseError(code);
  }
  if (data === null || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new VenuePurchaseError("venue_request_failed");
  }
  return (data as { data?: unknown }).data ?? null;
}

/** The owner's live booking (pass QR included for a confirmed booking). */
export async function getVenueBooking(groupId: string): Promise<VenueBooking> {
  const booking = parseVenueBooking(await invoke("venue-offers", { action: "get", groupId }));
  if (booking === null) throw new VenuePurchaseError("offer_booking_not_found");
  return booking;
}

export async function previewVenueCancel(groupId: string): Promise<EntryCancelPreview> {
  const preview = parseEntryCancelPreview(await invoke("venue-offers", { action: "cancel_preview", groupId }));
  if (preview === null) throw new VenuePurchaseError("offer_cancel_preview_invalid");
  return preview;
}

export async function cancelVenueBooking(groupId: string, preview: EntryCancelPreview, idempotencyKey: string): Promise<void> {
  await invoke("venue-offers", {
    action: "cancel",
    groupId,
    previewIds: preview.previewIds,
    previewHash: preview.previewHash,
    idempotencyKey,
    reason: "Cancelled by the guest in the Mingla app",
  });
}

export async function previewVenueGuestChange(groupId: string, guests: number): Promise<GuestChangeSummary> {
  const summary = parseGuestChangeSummary(
    await invoke("venue-offers", { action: "change_preview", groupId, change: "change_guests", payload: { guests } }),
  );
  if (summary === null) throw new VenuePurchaseError("offer_change_not_allowed");
  return summary;
}

export async function changeVenueGuests(input: {
  groupId: string;
  guests: number;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<void> {
  await invoke("venue-offers", {
    action: "change",
    groupId: input.groupId,
    change: "change_guests",
    payload: { guests: input.guests },
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  });
}

/** The owner's plan (member pass QR included while it opens the door). */
export async function getVenueMember(subscriptionId: string): Promise<VenueMember> {
  const member = parseVenueMember(await invoke("venue-offers", { action: "membership_get", subscriptionId }));
  if (member === null) throw new VenuePurchaseError("membership_not_found");
  return member;
}

export type VenueMemberAction = "membership_leave" | "membership_stay" | "membership_pause" | "membership_resume";

export async function actOnVenueMember(subscriptionId: string, action: VenueMemberAction, idempotencyKey: string): Promise<void> {
  await invoke("venue-offers", { action, subscriptionId, idempotencyKey });
}

/** Renew: the plan's web payment page (opened in the in-app browser). */
export async function openVenueMemberPayment(subscriptionId: string, idempotencyKey: string): Promise<string> {
  const session = await invoke("venue-membership-pay-link", { action: "pay", subscriptionId, idempotencyKey });
  const url = session !== null && typeof session === "object" ? (session as { authorizationUrl?: unknown }).authorizationUrl : null;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new VenuePurchaseError("membership_payment_unavailable");
  return url;
}

/** After the payment page closes: ask the provider, then re-read the plan. */
export async function confirmVenueMemberPayment(subscriptionId: string): Promise<void> {
  await invoke("venue-membership-pay-link", { action: "confirm_return", subscriptionId });
}

export async function leaveVenueWaitlist(waitlistId: string): Promise<void> {
  await invoke("venue-waitlist", { action: "leave", waitlistId });
}
