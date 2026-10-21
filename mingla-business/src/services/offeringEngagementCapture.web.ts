import { supabase } from "./supabase";
import type {
  OfferingEngagementCtaType,
  OfferingEngagementScope,
} from "./offeringEngagementCapture";

type EventType = "page_view" | "cta_click" | "checkout_start";

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

async function send(
  scope: OfferingEngagementScope,
  eventType: EventType,
  ctaType: OfferingEngagementCtaType | null,
  checkoutSessionId: string | null,
): Promise<void> {
  try {
    const pageUrl = window.location.href;
    const referrer = document.referrer.trim();
    const { error } = await supabase.functions.invoke(
      "offering-engagement-capture",
      {
        body: {
          eventId: eventId(),
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

export async function captureOfferingPageView(
  scope: OfferingEngagementScope,
): Promise<void> {
  await send(scope, "page_view", null, null);
}

export async function captureOfferingCta(
  scope: OfferingEngagementScope,
  ctaType: OfferingEngagementCtaType,
): Promise<void> {
  await send(scope, "cta_click", ctaType, null);
}

export async function captureOfferingCheckoutStart(
  scope: OfferingEngagementScope,
  checkoutSessionId: string,
): Promise<void> {
  await send(scope, "checkout_start", null, checkoutSessionId);
}
