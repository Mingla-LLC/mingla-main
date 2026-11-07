/**
 * issue #4271 — what the guest's `/pay/door/<code>` page shows, as pure data
 * (approved design B4–B5). Kept apart from the host's doorPayCodeState.ts so the
 * public guest page and the host screen share no state module.
 */

import type {
  DoorPayLatePayment,
  DoorPayLiveStatus,
} from "../../services/doorPayCodeService";

export interface DoorPayGuestEndCopy {
  title: string;
  body: string;
}

/**
 * B5 — the guest's "can't be used" states. Pre-purchase: no app talk.
 * "You weren't charged." only when Stripe is the provider: the server closes a
 * Stripe page before it reports a code closed. Paystack has no close call, so a
 * Paystack guest (or one whose provider the server didn't name) is told what
 * happens if a payment still lands: it's refunded in full.
 */
export const doorPayGuestEndCopy = (
  status: "expired" | "paid" | "cancelled" | "failed",
  provider: "stripe" | "paystack" | null,
): DoorPayGuestEndCopy => {
  const closeConfirmed = provider === "stripe";
  switch (status) {
    case "expired":
      return {
        title: "This code has expired",
        body: closeConfirmed
          ? "You weren't charged. Ask the door to show a new one."
          : "No payment has come in. If one still lands, it's refunded to you in full. Ask the door to show a new one.",
      };
    case "paid":
      return {
        title: "This code is already paid",
        body: "If that was you, you're in. Check your texts for the receipt.",
      };
    case "cancelled":
      return {
        title: "The door cancelled this sale",
        body: closeConfirmed
          ? "You weren't charged."
          : "No payment has come in. If one still lands, it's refunded to you in full.",
      };
    case "failed":
      return {
        title: "Payment didn't go through",
        body: "You weren't charged. Ask the door to show a new code.",
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

/** The guest's money on a closed code: never "you weren't charged" here. */
export const doorPayGuestLateCopy = (
  state: DoorPayLatePayment["state"],
  amount: string,
): DoorPayGuestEndCopy => {
  switch (state) {
    case "refunded":
      return {
        title: "Your payment was refunded",
        body: `Your payment came in after this code closed. ${amount} was refunded to you. It can take a few days to show.`,
      };
    case "refunding":
      return {
        title: "Your payment is being refunded",
        body: `Your payment came in after this code closed. ${amount} is queued to go back to you. It hasn't reached you yet. Ask the door to show a new code.`,
      };
    case "kept":
      return {
        title: "We have your payment",
        body: `${amount} came in after this code closed. Show this screen at the door.`,
      };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
};

/** Coming back from the provider's page, the code alone can't say it's over. */
export const doorPayGuestReturnSettled = (view: {
  status: DoorPayLiveStatus;
  latePayment: DoorPayLatePayment | null;
}): boolean => view.status === "paid" || view.latePayment != null;
