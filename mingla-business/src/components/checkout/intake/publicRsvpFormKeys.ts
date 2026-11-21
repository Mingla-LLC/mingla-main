/**
 * #4541 — the query key for the public RSVP page's form read. A leaf module
 * (like ./checkoutFormKeys.ts) so the eagerly loaded public event page does
 * not pull the whole host brandFormKeys factory into the entry bundle.
 */
export const publicRsvpFormKeys = {
  /** The questions on the public RSVP page, for one event. */
  forEvent: (eventId: string) => ["brand-forms", "public-rsvp", eventId] as const,
};
