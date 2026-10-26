/**
 * #4111 Wave D — React Query hooks for brand enquiries in Explorer.
 * Keys come from `brandEnquiryKeys` (queryKeys.ts). Mutations surface errors
 * through their callers (toast / inline), never silently.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnquiryPlan } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import {
  fetchBrandEnquiryProfile,
  fetchBrandIdentity,
  fetchEnquiryThread,
  fetchMyBrandPlans,
  listMyEnquiries,
  reportEnquiry,
  sendEnquiryGuestReply,
  type BrandEnquiryProfile,
  type BrandIdentity,
  type EnquiryThread,
  type MyEnquiryRow,
} from "../services/brandEnquiryService";
import { supabase } from "../services/supabase";
import { brandEnquiryKeys } from "./queryKeys";

/** Anon-safe: whether the brand takes messages + its reply time. */
export function useBrandEnquiryProfile(brandId: string | null) {
  return useQuery<BrandEnquiryProfile>({
    queryKey: brandEnquiryKeys.profile(brandId ?? ""),
    queryFn: () => fetchBrandEnquiryProfile(brandId as string),
    enabled: brandId !== null && brandId.length > 0,
    staleTime: 5 * 60_000,
  });
}

/** Signed-in only: "Your plans with {Brand}". */
export function useMyBrandPlans(userId: string | null, brandId: string | null) {
  return useQuery<EnquiryPlan[]>({
    queryKey: brandEnquiryKeys.plans(userId ?? "", brandId ?? ""),
    queryFn: () => fetchMyBrandPlans(brandId as string),
    enabled: userId !== null && brandId !== null && brandId.length > 0,
    staleTime: 60_000,
  });
}

/** Brand identity for a plan row (id or slug) — fetched only when Message is tapped. */
export function useBrandIdentity(
  ref: { brandId?: string | null; brandSlug?: string | null },
  enabled: boolean,
) {
  const key = ref.brandId ?? (ref.brandSlug ? `slug:${ref.brandSlug}` : "");
  return useQuery<BrandIdentity | null>({
    queryKey: brandEnquiryKeys.brandIdentity(key),
    queryFn: () => fetchBrandIdentity(ref),
    enabled: enabled && key.length > 0,
    staleTime: 10 * 60_000,
  });
}

/** The Friends tab rows: one per enquiry, live while the list is mounted. */
export function useMyEnquiryRows(userId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery<MyEnquiryRow[]>({
    queryKey: brandEnquiryKeys.list(userId ?? ""),
    queryFn: () => listMyEnquiries(userId as string),
    enabled: userId !== null,
    staleTime: 15_000,
  });
  useEffect(() => {
    if (userId === null) return undefined;
    // RLS scopes these events to the guest's own enquiries.
    const channel = supabase
      .channel(`explorer-enquiries:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "brand_enquiries", filter: `guest_user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.list(userId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);
  return query;
}

/** One thread, kept live with the Wave C pattern (realtime filtered on conversation_id). */
export function useEnquiryThread(userId: string | null, enquiryId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery<EnquiryThread>({
    queryKey: brandEnquiryKeys.thread(userId ?? "", enquiryId ?? ""),
    queryFn: () => fetchEnquiryThread(enquiryId as string),
    enabled: userId !== null && enquiryId !== null && enquiryId.length > 0,
    staleTime: 5_000,
  });
  const conversationId = query.data?.conversationId ?? null;
  useEffect(() => {
    if (conversationId === null || userId === null || enquiryId === null) return undefined;
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.thread(userId, enquiryId) });
      void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.list(userId) });
    };
    const channel = supabase
      .channel(`explorer-enquiry:${enquiryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "brand_enquiries", filter: `conversation_id=eq.${conversationId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, enquiryId, queryClient, userId]);
  return query;
}

export function useEnquiryGuestReply(userId: string | null, enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendEnquiryGuestReply(enquiryId, body),
    onSettled: () => {
      if (userId === null) return;
      void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.thread(userId, enquiryId) });
      void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.list(userId) });
    },
  });
}

export function useEnquiryReport(userId: string | null, enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => reportEnquiry(enquiryId, reason),
    onSettled: () => {
      if (userId === null) return;
      void queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.thread(userId, enquiryId) });
    },
  });
}
