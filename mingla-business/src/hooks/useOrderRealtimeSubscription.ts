/**
 * useOrderRealtimeSubscription — ORCH-0852 bulletproof confirmation safety net.
 *
 * Subscribes to UPDATE events on `public.ticket_checkout_sessions` filtered to
 * a single session id. Fires `onOrderReady` exactly once when the session's
 * `order_id` transitions from NULL → a finalized UUID, regardless of whether
 * the finalization came from the synchronous `ticket-checkout-confirm` edge
 * function OR from the Stripe webhook backup path.
 *
 * Used by `mingla-business/app/checkout/[eventId]/confirm.tsx` on web when the
 * initial synchronous `confirmTicketCheckout` returns `status: "pending"` or
 * throws. Subscription stays open until `checkoutSessionId` is set to `null`
 * (caller toggles after order is rendered) or the consumer unmounts.
 *
 * Requires `public.ticket_checkout_sessions` to be in the `supabase_realtime`
 * publication — added by migration `20260606000100_orch_0852_realtime_checkout_sessions.sql`.
 *
 * Spec: SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md §M1.
 */

import { useEffect, useRef } from "react";
import { supabase } from "../services/supabase";
import {
  confirmTicketCheckout,
  type TicketCheckoutConfirmResult,
} from "../services/ticketCheckoutService";

export interface UseOrderRealtimeSubscriptionArgs {
  /** Active session id, or null to suspend the subscription. */
  checkoutSessionId: string | null;
  /** Buyer status token — required to fetch the order from the confirm edge. */
  buyerStatusToken: string | null;
  /** Fires exactly once when the order materializes server-side. */
  onOrderReady: (order: NonNullable<TicketCheckoutConfirmResult["order"]>) => void;
}

export const useOrderRealtimeSubscription = ({
  checkoutSessionId,
  buyerStatusToken,
  onOrderReady,
}: UseOrderRealtimeSubscriptionArgs): void => {
  // Stable ref to the callback so the effect doesn't re-subscribe when the
  // caller passes an inline arrow function.
  const onOrderReadyRef = useRef(onOrderReady);
  useEffect(() => {
    onOrderReadyRef.current = onOrderReady;
  }, [onOrderReady]);

  useEffect(() => {
    if (checkoutSessionId === null) return;
    if (buyerStatusToken === null || buyerStatusToken.length === 0) return;

    // Unique channel name — same defensive pattern as useBrandStripeStatus
    // to avoid React 18 StrictMode double-mount races.
    const channelName = `checkout-session-${checkoutSessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let cancelled = false;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ticket_checkout_sessions",
          filter: `id=eq.${checkoutSessionId}`,
        },
        async (payload) => {
          if (cancelled) return;
          const newRow = payload.new as { order_id?: string | null } | null;
          if (!newRow || !newRow.order_id) return;
          try {
            const result = await confirmTicketCheckout(
              checkoutSessionId,
              buyerStatusToken,
            );
            if (cancelled) return;
            if (result.order) {
              onOrderReadyRef.current(result.order);
            }
          } catch (err) {
            // Realtime caught the update but the fetch-back-via-confirm
            // failed. Don't crash; log and rely on the buyer's manual
            // refresh + email recovery path.
            console.warn(
              "[useOrderRealtimeSubscription] post-realtime confirm fetch failed",
              err,
            );
          }
        },
      )
      .subscribe();

    return (): void => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [checkoutSessionId, buyerStatusToken]);
};
