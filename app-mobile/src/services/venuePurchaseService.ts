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

import { onlineManager } from "@tanstack/react-query";

import { supabase } from "./supabase";
import {
  parseVenueBooking,
  parseVenueMember,
  type VenueBooking,
  type VenueMember,
} from "../components/purchases/venuePurchaseModel";

export class VenuePurchaseError extends Error {
  readonly code: string;
  /** #4490 W4: places left, when the server says so (`offer_sold_out`). */
  readonly remaining: number | null;

  constructor(code: string, remaining: number | null = null) {
    super(code.replaceAll("_", " "));
    this.name = "VenuePurchaseError";
    this.code = code;
    this.remaining = remaining;
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

/**
 * #4490 W3 fix 3 (W3-N25): a request that got no answer is "offline" only
 * when the phone itself is offline (the app's one connectivity signal:
 * React Query's onlineManager, fed by NetInfo in config/queryClient). Online,
 * it is the server that did not answer ("venue_unreachable"), which a screen
 * words as its plain load-failure line, never "You're offline".
 */
export function venueNoAnswerCode(isOnline: boolean): "offline" | "venue_unreachable" {
  return isOnline ? "venue_unreachable" : "offline";
}

/** A read the page waits on gives up after this long (W3-N25: was ~60 s). */
export const VENUE_READ_TIMEOUT_MS = 10_000;

/**
 * W3 fix 4 (W3-N35) — the read's own clock. The `timeout` option alone never
 * fired: functions-js aborts through the request's `signal`, and the app's
 * Supabase fetch wrapper (services/supabase.ts) sends every request with its
 * OWN abort signal, so the caller's was dropped and the wrapper's 20 s hard
 * cap was the only one that ran (the device saw the error at ~20 s). The race
 * is the same reliable path that wrapper uses (Promise.race; abort is not
 * dependable on Hermes); the request left on the wire ends at its 20 s cap.
 */
export function raceVenueRead<T>(work: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new VenuePurchaseError(venueNoAnswerCode(onlineManager.isOnline()))),
      timeoutMs,
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * #4490 W4: the same owner-path call, shared with the native venue checkout
 * (`venueOfferCheckoutService`), so both use one error and timeout rule.
 */
export function invokeVenueFunction(
  fn: Fn,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  return invoke(fn, body, options);
}

async function invoke(
  fn: Fn,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  const { data, error } = await raceVenueRead(
    supabase.functions.invoke(fn, {
      body,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    }),
    options.timeoutMs,
  );
  if (error) {
    // #4490 Explorer W3: a request that never got an answer (no network, the
    // server down, or the read timed out) is named, so a screen can say
    // "You're offline" only when the phone is (W3 fix 3, W3-N25).
    if ((error as { name?: unknown }).name === "FunctionsFetchError") {
      throw new VenuePurchaseError(venueNoAnswerCode(onlineManager.isOnline()));
    }
    let code = "venue_request_failed";
    let remaining: number | null = null;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = (await context.json()) as { code?: unknown; remaining?: unknown };
        if (typeof parsed.code === "string") code = parsed.code;
        if (typeof parsed.remaining === "number" && Number.isFinite(parsed.remaining)) remaining = parsed.remaining;
      } catch {
        // Keep the stable fallback when the edge answer is not JSON.
      }
    }
    throw new VenuePurchaseError(code, remaining);
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

/**
 * #4490 Explorer W3 — one offer's days between two venue dates (no identity
 * needed; the same `availability` read buyer web uses). The pane turns the
 * rows into "Sold out" or bookable; it never prices from them.
 */
export async function getVenueOfferAvailability(input: {
  offeringId: string;
  from: string;
  to: string;
}): Promise<unknown> {
  return invoke(
    "venue-offers",
    {
      action: "availability",
      offeringId: input.offeringId,
      from: input.from,
      to: input.to,
    },
    { timeoutMs: VENUE_READ_TIMEOUT_MS },
  );
}
