/**
 * useEventBuyerCount — how many buyers a published event has (issue #3827).
 *
 * Reads `business_event_buyer_count`, the server's single definition of
 * "buyer" (paid orders, live tickets, going RSVPs). The editor uses it for one
 * thing: with NO buyers, Review changes stops promising a buyer notification
 * and stops demanding a reason. Only zero versus non-zero is contractual.
 *
 * Returns `null` whenever the answer is not KNOWN: no server id, the session
 * is not ready yet, still loading, the request failed, or the function is not
 * on the server yet (the web app ships before the migration is applied). `null` keeps the reason
 * mandatory, so not knowing can only ever be the stricter behaviour, and the
 * server re-checks on save regardless.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export const eventBuyerCountKeys = {
  all: ["event-buyer-count"] as const,
  detail: (serverEventId: string): readonly ["event-buyer-count", string] =>
    [...eventBuyerCountKeys.all, serverEventId] as const,
};

const DISABLED_KEY = ["event-buyer-count-disabled"] as const;

export const fetchEventBuyerCount = async (
  serverEventId: string,
): Promise<number> => {
  const { data, error } = await supabase.rpc("business_event_buyer_count", {
    p_event_id: serverEventId,
  });
  if (error !== null) {
    throw new Error(error.message);
  }
  if (typeof data !== "number" || !Number.isFinite(data) || data < 0) {
    throw new Error("event_buyer_count_malformed");
  }
  return data;
};

export const useEventBuyerCount = (
  serverEventId: string | null,
): number | null => {
  // The RPC is auth.uid()-scoped (event managers and above). Asked before the
  // session is ready it would be refused as signed out, so it waits (ORCH-1004).
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && serverEventId !== null;
  const query = useQuery({
    queryKey: enabled ? eventBuyerCountKeys.detail(serverEventId) : DISABLED_KEY,
    queryFn: () => fetchEventBuyerCount(serverEventId as string),
    enabled,
    // A sale can land while the editor is open: never serve a remembered zero.
    staleTime: 0,
    refetchOnMount: "always",
    // No refetch on focus: the answer would blink to "unknown" under an open
    // Review changes sheet. The server re-checks on save.
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!enabled || query.isError || query.data === undefined) return null;
  // While a refetch is in flight the last answer is not trusted either.
  if (query.isFetching) return null;
  return query.data;
};
