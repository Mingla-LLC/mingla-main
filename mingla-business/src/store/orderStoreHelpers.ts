/**
 * Sold-count helpers for edit-published flow.
 *
 * Wraps `useOrderStore` selectors to produce the SoldCountContext shape
 * `useLiveEventStore.updateLiveEventFields` consumes for buyer-protection
 * guard rails (capacity floor / tier-delete-with-sales / tier-price-lock /
 * tier-free-toggle / dropped-date with sales).
 *
 * Originally a TRANSITIONAL stub returning zeros (ORCH-0704 v2 — built
 * before Cycle 9c useOrderStore existed). Rewritten to live selectors
 * at Cycle 9c CLOSE (2026-05-02). Public signature unchanged — zero
 * caller-side changes.
 *
 * Per Cycle 9c spec §3.3.1.
 */

import { useOrderStore } from "./orderStore";
import type { LiveEvent } from "./liveEventStore";

export interface SoldCountContext {
  /** Sold count per tier ID. Drives Step 5 lock UX + per-tier guard rails. */
  soldCountByTier: Record<string, number>;
  /** Total event sold count. Drives whenMode/recurrence/multiDates dropped-date guard rails. */
  soldCountForEvent: number;
}

/**
 * Returns sold-count map for a given event by composing two
 * `useOrderStore` selectors. Filters orders by status in
 * {paid, refunded_partial}; sums (line.quantity - line.refundedQuantity)
 * per ticketTypeId.
 */
export const getSoldCountContextForEvent = (
  event: LiveEvent,
): SoldCountContext => {
  const soldCountByTier = useOrderStore.getState().getSoldCountByTier(event.id);
  const soldCountForEvent = useOrderStore
    .getState()
    .getSoldCountForEvent(event.id);
  return { soldCountByTier, soldCountForEvent };
};
