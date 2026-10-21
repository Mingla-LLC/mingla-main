import type {
  OfferingEngagementCtaType,
  OfferingEngagementScope,
} from "./offeringEngagementCapture";

// #4037 — public pages import only these three tiny functions; the sender (and
// its request building) loads on first use, off the eager web boot chunk.
const send = async (
  ...args: Parameters<
    typeof import("./offeringEngagementSend").sendOfferingEngagement
  >
): Promise<void> => {
  try {
    const { sendOfferingEngagement } = await import("./offeringEngagementSend");
    await sendOfferingEngagement(...args);
  } catch (error) {
    console.warn("[offeringEngagement] capture failed (non-blocking)", error);
  }
};

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
