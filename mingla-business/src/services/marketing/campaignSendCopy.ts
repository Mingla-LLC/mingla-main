// #3682 wave 3 — the words for a send-now where some recipients failed at the
// provider. Pure (no client imports) so screens and services share it.

/** Truthful line for a send where some recipients failed at the provider. */
export function partialSendLine(delivered: number, failed: number): string {
  const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;
  return `Sent to ${people(delivered)}. ${people(failed)} couldn't be reached by the provider.`;
}

const peopleCount = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

/**
 * #4273 — the honest reason a reachable phone is not texted: Mingla has no
 * provider rate for that country yet. Null when nobody was skipped for it.
 */
export function unpricedSmsLine(count: number | null | undefined): string | null {
  if (typeof count !== "number" || count <= 0) return null;
  return `${peopleCount(count)} can't be texted: Mingla can't text their country yet.`;
}

/**
 * #4273 P2-a — one set of words for a Blast preview that failed on price, for
 * the lead method and for a method sent alongside it. Null when the code is
 * not a pricing failure (the caller keeps its own words).
 */
export function bookPricingErrorCopy(code: string): string | null {
  if (code.includes("RATE_BOOK_EXPIRED")) {
    return "SMS pricing needs a fresh provider rate card before this campaign can be sent.";
  }
  if (code.includes("RATE_BOOK_UNAVAILABLE")) {
    return "SMS pricing is unavailable right now. Mingla needs to refresh the provider rate card before sending.";
  }
  if (code.includes("COST")) {
    return "Provider cost could not be verified. Refresh the preview before confirming.";
  }
  if (code.includes("MMS")) {
    return "MMS media could not be verified. Fix the media or refresh the preview.";
  }
  return null;
}
