import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "../context/AuthContext";
import { marketingKeys } from "./marketing/marketingKeys";
import {
  clearWizardInvitePlan,
  getWizardInvitePlan,
  listWizardInviteBookPeople,
  listWizardInviteManualGroups,
  quoteWizardInvitePlan,
  replaceWizardInvitePlan,
  type WizardInviteSelection,
} from "../services/offeringInvitePlanService";

export function useOfferingInvitePlan(input: {
  eventId: string | null;
  brandId: string;
  search: string;
  enabled: boolean;
}) {
  const client = useQueryClient();
  const { isAuthReady } = useAuth();
  const eventId = input.eventId;
  const plan = useQuery({
    queryKey: marketingKeys.offeringInvites.plan(eventId ?? "pending"),
    enabled: isAuthReady && input.enabled && eventId !== null,
    queryFn: () => getWizardInvitePlan(eventId!),
    staleTime: 10_000,
  });
  const people = useInfiniteQuery({
    queryKey: marketingKeys.offeringInvites.activeBookPeople(input.brandId, input.search),
    enabled: isAuthReady && input.enabled && input.brandId.length > 0,
    queryFn: ({ pageParam }) => listWizardInviteBookPeople(
      input.brandId,
      input.search.trim() || null,
      pageParam,
    ),
    initialPageParam: null as { updatedAt: string; personId: string } | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 15_000,
  });
  const groups = useQuery({
    queryKey: marketingKeys.offeringInvites.manualGroups(input.brandId),
    enabled: isAuthReady && input.enabled && input.brandId.length > 0,
    queryFn: () => listWizardInviteManualGroups(input.brandId),
    staleTime: 15_000,
  });
  const quote = useQuery({
    queryKey: marketingKeys.offeringInvites.quote(eventId ?? "pending", plan.data?.selectionRevision ?? 0),
    enabled: isAuthReady && input.enabled && eventId !== null && plan.data !== undefined,
    queryFn: () => quoteWizardInvitePlan(eventId!, plan.data!.selectionRevision),
    staleTime: 10_000,
  });
  const replace = useMutation({
    mutationFn: (value: { selection: WizardInviteSelection; expectedRevision: number; clientRequestId: string }) =>
      replaceWizardInvitePlan({ eventId: eventId!, ...value }),
    onSuccess: (next) => {
      client.setQueryData(marketingKeys.offeringInvites.plan(next.eventId), next);
      void client.invalidateQueries({ queryKey: marketingKeys.offeringInvites.quote(next.eventId, next.selectionRevision) });
    },
  });
  const clear = useMutation({
    mutationFn: (value: { expectedRevision: number; clientRequestId: string }) =>
      clearWizardInvitePlan({ eventId: eventId!, ...value }),
    onSuccess: (next) => {
      client.setQueryData(marketingKeys.offeringInvites.plan(next.eventId), next);
      void client.invalidateQueries({ queryKey: marketingKeys.offeringInvites.quote(next.eventId, next.selectionRevision) });
    },
  });
  const refreshAuthoritative = useCallback(async () => {
    if (eventId === null) throw new Error("wizard_invite_event_required");
    const nextPlan = await getWizardInvitePlan(eventId);
    client.setQueryData(marketingKeys.offeringInvites.plan(eventId), nextPlan);
    const nextQuote = await quoteWizardInvitePlan(eventId, nextPlan.selectionRevision);
    client.setQueryData(
      marketingKeys.offeringInvites.quote(eventId, nextPlan.selectionRevision),
      nextQuote,
    );
    return { plan: nextPlan, quote: nextQuote };
  }, [client, eventId]);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const wasActive = appState.current === "active";
      appState.current = next;
      // Same predicate as the plan query: a foreground refresh bypasses
      // React Query's enabled, so it must never fire pre-auth or while the
      // caller has invites disabled.
      if (
        next === "active" && !wasActive &&
        isAuthReady && input.enabled && eventId !== null
      ) {
        void refreshAuthoritative().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [eventId, input.enabled, isAuthReady, refreshAuthoritative]);
  return { plan, people, groups, quote, replace, clear, refreshAuthoritative };
}

/** Hydrates the persisted plan anywhere the wizard needs review/publish truth. */
export function useOfferingInvitePlanSummary(input: {
  eventId: string | null;
  enabled: boolean;
  quoteWhenEmpty?: boolean;
}) {
  const client = useQueryClient();
  const { isAuthReady } = useAuth();
  const plan = useQuery({
    queryKey: marketingKeys.offeringInvites.plan(input.eventId ?? "pending"),
    enabled: isAuthReady && input.enabled && input.eventId !== null,
    queryFn: () => getWizardInvitePlan(input.eventId!),
    staleTime: 10_000,
  });
  const quote = useQuery({
    queryKey: marketingKeys.offeringInvites.quote(
      input.eventId ?? "pending",
      plan.data?.selectionRevision ?? 0,
    ),
    enabled: isAuthReady && input.enabled && input.eventId !== null && plan.data !== undefined &&
      (input.quoteWhenEmpty !== false || plan.data.selectedCount > 0),
    queryFn: () => quoteWizardInvitePlan(input.eventId!, plan.data!.selectionRevision),
    staleTime: 10_000,
  });
  const refreshAuthoritative = useCallback(async () => {
    if (input.eventId === null) throw new Error("wizard_invite_event_required");
    const nextPlan = await getWizardInvitePlan(input.eventId);
    client.setQueryData(marketingKeys.offeringInvites.plan(input.eventId), nextPlan);
    if (input.quoteWhenEmpty === false && nextPlan.selectedCount === 0) {
      return { plan: nextPlan, quote: null };
    }
    const nextQuote = await quoteWizardInvitePlan(input.eventId, nextPlan.selectionRevision);
    client.setQueryData(
      marketingKeys.offeringInvites.quote(input.eventId, nextPlan.selectionRevision),
      nextQuote,
    );
    return { plan: nextPlan, quote: nextQuote };
  }, [client, input.eventId, input.quoteWhenEmpty]);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const wasActive = appState.current === "active";
      appState.current = next;
      // Same predicate as the plan query: a foreground refresh bypasses
      // React Query's enabled, so it must never fire pre-auth or while the
      // caller has the summary disabled.
      if (
        next === "active" && !wasActive &&
        isAuthReady && input.enabled && input.eventId !== null
      ) {
        void refreshAuthoritative().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [input.eventId, input.enabled, isAuthReady, refreshAuthoritative]);
  return { plan, quote, refreshAuthoritative };
}
