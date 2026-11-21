/**
 * #4514 wave 5 — the query key factory for the buyer checkout's brand form read.
 * Its own module (not hooks/brandFormKeys.ts) because only the checkout step,
 * inside the one lazy forms owner, reads it: sharing the host factory pulled
 * that whole module into the eager bundle (the review's bundle finding).
 */
export const checkoutFormKeys = {
  /** The page's form as this buyer's checkout reads it, with or without a private ticket link. */
  forEvent: (eventId: string, withTicketLink: boolean) =>
    ["brand-forms", "checkout", eventId, withTicketLink ? "link" : "plain"] as const,
};
