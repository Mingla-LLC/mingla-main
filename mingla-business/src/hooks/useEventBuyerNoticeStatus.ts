/**
 * useEventBuyerNoticeStatus — whether buyers are emailed about live edits of
 * this event, how many people that is, and how the last email went
 * (issue #3827).
 *
 * Reads `business_event_buyer_notice_status` (event managers and above;
 * counts only, never an address). The live editors use it for copy: with
 * emails on they say how many people will be told; otherwise they say plainly
 * that buyer emails are not switched on.
 *
 * Returns `null` whenever the answer is not KNOWN: no server id, the session
 * is not ready, still loading, the request failed, or the function is not on
 * the server yet (the web app ships before the migration is applied). `null`
 * reads as "not switched on", so not knowing can never promise an email.
 */
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  parseBuyerNoticeStatus,
  type BuyerNoticeStatus,
} from "../utils/buyerNoticeCopy";

export const eventBuyerNoticeStatusKeys = {
  all: ["event-buyer-notice-status"] as const,
  detail: (
    serverEventId: string,
  ): readonly ["event-buyer-notice-status", string] =>
    [...eventBuyerNoticeStatusKeys.all, serverEventId] as const,
};

const DISABLED_KEY = ["event-buyer-notice-status-disabled"] as const;

export const fetchEventBuyerNoticeStatus = async (
  serverEventId: string,
): Promise<BuyerNoticeStatus> => {
  const { data, error } = await supabase.rpc(
    "business_event_buyer_notice_status",
    { p_event_id: serverEventId },
  );
  if (error !== null) {
    throw new Error(error.message);
  }
  const status = parseBuyerNoticeStatus(data);
  if (status === null) {
    throw new Error("event_buyer_notice_status_malformed");
  }
  return status;
};

export const useEventBuyerNoticeStatus = (
  serverEventId: string | null,
): BuyerNoticeStatus | null => {
  // The RPC is auth.uid()-scoped. Asked before the session is ready it would
  // be refused as signed out, so it waits (ORCH-1004).
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && serverEventId !== null;
  const query = useQuery({
    queryKey: enabled
      ? eventBuyerNoticeStatusKeys.detail(serverEventId)
      : DISABLED_KEY,
    queryFn: () => fetchEventBuyerNoticeStatus(serverEventId as string),
    enabled,
    // A sale, or the switch itself, can change while the editor is open.
    staleTime: 0,
    refetchOnMount: "always",
    // No refetch on focus: the copy would blink under an open Review changes
    // sheet. The server decides on save regardless.
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!enabled || query.isError || query.data === undefined) return null;
  return query.data;
};
