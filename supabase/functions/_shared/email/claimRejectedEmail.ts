// Ve3 — venue claim rejected operator email body.

import type { GenericBodyInput } from "./types.ts";

export function buildClaimRejectedEmail(input: {
  brandName: string;
  rejectionReason: string;
}): GenericBodyInput {
  const reason = input.rejectionReason.trim();
  return {
    variant: "generic_notification",
    title: "Update on your venue submission",
    paragraphs: [
      `We couldn't approve ${input.brandName} at this time.`,
      reason.length > 0
        ? `Reason: ${reason}`
        : "Our team will follow up if we need more information.",
      "You can submit a new claim with updated details when you're ready.",
    ],
    cta: null,
  };
}
