/**
 * #4238 W2-5 (D7, RSVP part; I-4238-RSVP-CONVERSION-PAIRED). A positive public
 * RSVP (going / waitlisted) is a free sign-up on the ad platforms, sent from
 * the server with event_id = the RSVP id. The browser sends the twin with the
 * same id (PublicEventPage → fireAdReservation), so each pair deduplicates.
 *
 * Only a web caller sends `ad_context` (the browser's stored match keys and
 * click id). A native caller sends none, and then nothing is sent: native
 * events are never reported to the ad networks as website events (D20).
 * The fire never blocks or fails the RSVP: it runs after the RSVP is
 * committed, inside EdgeRuntime.waitUntil when available, otherwise awaited
 * with a bound no longer than one sender timeout.
 */

// @ts-ignore — Deno ESM import (pin matches adConversionFire.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type CheckoutAdContextInput,
  fireAdConversion,
  type FireAdConversionDeps,
  type FireAdConversionResult,
} from "../_shared/adConversionFire.ts";

/** The senders' own timeout; the RSVP response never waits longer. */
export const RSVP_AD_FIRE_BOUND_MS = 8_000;

const bounded = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/**
 * The browser's `ad_context` body field, validated. Null when absent or not an
 * object (a native caller, or a malformed field: the RSVP itself is unaffected).
 */
export function parseRsvpAdContext(
  raw: unknown,
  req: Request,
): CheckoutAdContextInput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    clickId: bounded(body.clickId, 512),
    fbp: bounded(body.fbp, 512),
    fbc: bounded(body.fbc, 512),
    scid: bounded(body.scid, 512),
    ttp: bounded(body.ttp, 512),
    trackingOptOut: body.trackingOptOut === true,
    clientIpAddress: forwarded ? forwarded.slice(0, 128) : null,
    clientUserAgent: bounded(body.clientUserAgent, 1024) ??
      bounded(req.headers.get("user-agent"), 1024),
  };
}

/** Only going and waitlisted RSVPs are sign-ups (maybe / not going are not). */
export function rsvpStatusFiresAdConversion(status: unknown): boolean {
  return status === "going" || status === "waitlisted";
}

export interface RsvpAdConversionInput {
  rsvpId: string | null | undefined;
  status: unknown;
  adContext: CheckoutAdContextInput | null;
}

/** Fire the server free sign-up for one RSVP. Never throws. */
export async function fireRsvpAdConversion(
  admin: SupabaseClient,
  input: RsvpAdConversionInput,
  deps: FireAdConversionDeps = {},
): Promise<FireAdConversionResult | null> {
  if (
    typeof input.rsvpId !== "string" || !input.rsvpId ||
    input.adContext === null || !rsvpStatusFiresAdConversion(input.status)
  ) {
    return null;
  }
  try {
    return await fireAdConversion(admin, {
      rsvpId: input.rsvpId,
      eventType: "reservation",
      surface: "web",
      lane: "consumer",
      adContext: input.adContext,
      clickId: input.adContext.clickId,
      eventTimeMs: Date.now(),
    }, deps);
  } catch (err) {
    console.error(
      "[public-submit-rsvp] ad conversion failed (non-fatal)",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

type WaitUntil = (task: Promise<unknown>) => void;

/**
 * Run the fire after the response when the runtime allows it; otherwise wait
 * for it, bounded, so the guest never waits longer than one sender timeout.
 */
export async function scheduleRsvpAdConversion(
  task: Promise<unknown>,
  waitUntil: WaitUntil | null = edgeWaitUntil(),
  boundMs = RSVP_AD_FIRE_BOUND_MS,
): Promise<void> {
  if (waitUntil !== null) {
    waitUntil(task);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, boundMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

function edgeWaitUntil(): WaitUntil | null {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: WaitUntil };
  }).EdgeRuntime;
  return typeof runtime?.waitUntil === "function"
    ? runtime.waitUntil.bind(runtime)
    : null;
}
