/**
 * #4111 — Customer enquiries for the signed-in team member (all their brands).
 *
 * One query per filter, keyed by the factory below. brand_enquiries is in the
 * realtime publication, so the list, the Messages badge and Home's To-do
 * converge without polling; a mutation in the thread also invalidates the
 * whole family.
 */

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  listBrandEnquiries,
  type BrandEnquiryList,
  type BrandEnquiryListFilter,
} from "../services/brandEnquiriesService";

export const brandEnquiryKeys = {
  all: ["brandEnquiries"] as const,
  list: (userId: string, filter: BrandEnquiryListFilter) =>
    ["brandEnquiries", "list", userId, filter] as const,
  thread: (userId: string, enquiryId: string) =>
    ["brandEnquiries", "thread", userId, enquiryId] as const,
  byConversation: (userId: string, conversationId: string) =>
    ["brandEnquiries", "byConversation", userId, conversationId] as const,
};

export function useBrandEnquiries(
  filter: BrandEnquiryListFilter = "open",
  options: { enabled?: boolean } = {},
): UseQueryResult<BrandEnquiryList> {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const enabled = userId !== null && options.enabled !== false;
  const nonce = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

  const query = useQuery({
    queryKey: userId ? brandEnquiryKeys.list(userId, filter) : (["brandEnquiries", "list-disabled", filter] as const),
    enabled,
    queryFn: () => listBrandEnquiries(filter),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!enabled || !userId) return;
    const channel = supabase
      .channel(`brand-enquiries:${userId}:${filter}:${nonce.current}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_enquiries" }, () => {
        void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.all });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, filter, queryClient, userId]);

  return query;
}
