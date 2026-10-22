/**
 * #4037 — the buyer-web traffic sender, loaded on first use by
 * `offeringEngagementCapture.web.ts` so it stays off the eager web boot chunk.
 * Aggregate counting only: no cookies, no storage, no ad or PostHog code.
 */
import { supabase } from "./supabase";
import type {
  OfferingEngagementCtaType,
  OfferingEngagementScope,
} from "./offeringEngagementCapture";

export type OfferingEngagementEventType =
  "page_view" | "cta_click" | "checkout_start";

function eventId(): string {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function")
    return maybeCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

export async function sendOfferingEngagement(
  scope: OfferingEngagementScope,
  eventType: OfferingEngagementEventType,
  ctaType: OfferingEngagementCtaType | null,
  checkoutSessionId: string | null,
): Promise<void> {
  try {
    const earlyWindow = window as Window & {
      __minglaEarlyEngagementCapture?: {
        scope: OfferingEngagementScope;
        eventId: string;
        completed: Promise<boolean>;
      };
    };
    const early = earlyWindow.__minglaEarlyEngagementCapture;
    let captureEventId: string | null = null;
    if (
      eventType === "page_view" &&
      early?.scope.brandId === scope.brandId &&
      early?.scope.entityType === scope.entityType &&
      early?.scope.entityId === scope.entityId
    ) {
      delete earlyWindow.__minglaEarlyEngagementCapture;
      if (await early.completed) return;
      // The keepalive request failed. Reuse its event id so a late success and
      // this hydrated fallback still collapse to one first-party visit.
      captureEventId = early.eventId;
    }
    const pageUrl = window.location.href;
    const referrer = document.referrer.trim();
    const { error } = await supabase.functions.invoke(
      "offering-engagement-capture",
      {
        body: {
          eventId: captureEventId ?? eventId(),
          brandId: scope.brandId,
          entityType: scope.entityType,
          entityId: scope.entityId,
          eventType,
          ctaType,
          checkoutSessionId,
          surface: "buyer_web",
          pageUrl,
          referrer: referrer.length > 0 ? referrer : null,
        },
      },
    );
    if (error !== null) {
      console.warn("[offeringEngagement] capture unavailable", error);
    }
  } catch (error) {
    console.warn("[offeringEngagement] capture failed (non-blocking)", error);
  }
}
