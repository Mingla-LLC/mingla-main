/**
 * #4514 wave 5 — every word of the buyer's checkout Questions step and the
 * after-purchase hand-off. Imported ONLY by the step (inside the one lazy forms
 * owner), so none of it reaches the eager bundle. The eager checkout code carries
 * only the inline marker (ticketCheckoutService) and each route's refusal codes.
 */

/**
 * #4514 wave 5 — the buyer's checkout Questions step and the after-purchase
 * hand-off (BUILD CONTRACT v2 §5.4, §5.5). Exact words from the contract.
 */
export const CHECKOUT_FORM_COPY = {
  stepName: "Questions",
  stepTitle: "A few questions",
  caption: (brand: string): string => (brand.length > 0 ? `Questions from ${brand}` : "A few questions"),
  needsAnswers: "Answer the required questions to continue",
  tryAgain: "Try again",
  // P3-C: offered once a Try again has failed (no retry loop).
  backToEvent: "Back to event",
  retryFailed: "We still couldn't load the questions. Nothing was charged.",
  loading: "Loading the questions…",
  skip: "Skip",
  optionalNote: "Optional. You can skip these.",
  refusedRequired: "Answer the required questions to continue. Nothing was charged.",
  refusedInvalid: "Some answers need another look. Nothing was charged.",
  refusedChanged: "The host changed these questions. Check your answers and continue. Nothing was charged.",
  refusedUnavailable: "We couldn't save your answers. Nothing was charged. Please try again.",
  purchaseLinkFailed: "We couldn't open the questions. The host can send you a link.",
  // Review fix 2: the server still asks for answers but no form could be shown.
  noFormRefused: "We couldn't load this event's questions. Nothing was charged. Try again.",
} as const;

/** The checkout refusal codes the Questions step explains (anything else is the payment screen's). */
export function checkoutFormRefusalCopy(code: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case "form_answers_required":
      return CHECKOUT_FORM_COPY.refusedRequired;
    case "form_answers_invalid":
      return CHECKOUT_FORM_COPY.refusedInvalid;
    case "form_changed":
      return CHECKOUT_FORM_COPY.refusedChanged;
    default:
      return CHECKOUT_FORM_COPY.refusedUnavailable;
  }
}
