import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { DraftEvent } from "../store/draftEventStore";
import { useDraftEventStore } from "../store/draftEventStore";
import type { LiveEvent } from "../store/liveEventStore";
import {
  cancelBusinessEvent,
  endBusinessEventTicketSales,
  fetchBusinessEventById,
  fetchBusinessEventsForBrand,
  publishBusinessEventDraft,
  type BusinessEventDetail,
  type PublishedBusinessEvent,
} from "../services/businessEvents";
import type { Brand } from "../store/currentBrandStore";
import { useAuth } from "../context/AuthContext";
import { eventDraftKeys } from "./useServerDraftEvents";
import { publicEventKeys } from "./usePublicEvents";
// ORCH-0965 — invalidate the home composite-upcoming cache on every event
// mutation so the home dashboard reflects new lifecycle state on next render.
// Imported from the keyless `upcomingKeys` module to avoid a require-cycle
// (useUpcomingForBrand → useBusinessEvents → useUpcomingForBrand).
import { upcomingKeys } from "./upcomingKeys";
// META-ORCH-1187 [Growth Analytics Hub] — offering-published conversion (SC-6).
import { postHogService } from "../services/postHogService";

const STALE_TIME_MS = 30 * 1000;
const DISABLED_KEY = ["business-events-disabled"] as const;

const logMutationError = (label: string, error: Error): void => {
  console.error(`[${label}] Operation failed:`, error);
};

const detailForPublishedEvent = (
  published: PublishedBusinessEvent,
): BusinessEventDetail => ({
  event: published.event,
  brand: {
    id: published.brand.id,
    slug: published.brand.slug,
    displayName: published.brand.displayName,
    address: null,
    coverHue: published.event.coverHue,
    role: "owner",
    stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
  } as Brand,
  tickets: published.tickets,
});

const writePublishedEventCaches = (
  queryClient: QueryClient,
  published: PublishedBusinessEvent,
  brandId: string,
): void => {
  queryClient.setQueryData(
    businessEventKeys.detail(published.event.id),
    detailForPublishedEvent(published),
  );
  queryClient.setQueryData<LiveEvent[]>(
    businessEventKeys.list(brandId),
    (prev) => {
      const next = (prev ?? []).filter((event) => event.id !== published.event.id);
      return [published.event, ...next];
    },
  );
  // ORCH-0862 / F-4 (Symptom A real root cause): do NOT invalidate the
  // `detail(eventId)` key after just writing it via setQueryData above. On
  // screens with an active subscriber to that key (the event-detail screen
  // via useManagedEventRoute → useBusinessEventById), the invalidate would
  // trigger a refetch that races with the cache write and cascades through
  // every other useEffect on the screen — observed live as a 4-second
  // 82-concurrent-HTTP-request storm followed by JS bridge stall (sim
  // syslog evidence /tmp/orch0862-rework-symptomA-syslog.txt timestamps
  // 14:46:22–26 on 2026-05-17). setQueryData ABOVE already wrote
  // authoritative data from the mutation's return value — refetching the
  // same row is redundant. The list-key invalidate below still fires
  // because hub-list/home-list consumers may benefit from a fresh sort
  // order if a new event landed; that key write is shape-only (filter +
  // prepend) and the refetch is the safety net.
  queryClient.invalidateQueries({ queryKey: businessEventKeys.list(brandId) });
  // ORCH-0965 — home composite-upcoming cache.
  queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
  queryClient.invalidateQueries({ queryKey: publicEventKeys.detailById(published.event.id) });
  queryClient.invalidateQueries({
    queryKey: publicEventKeys.detailBySlug(
      published.event.brandSlug,
      published.event.eventSlug,
    ),
  });
  queryClient.invalidateQueries({
    queryKey: publicEventKeys.brandBySlug(published.event.brandSlug),
  });
};

export const businessEventKeys = {
  all: ["business-events"] as const,
  lists: (): readonly ["business-events", "list"] =>
    [...businessEventKeys.all, "list"] as const,
  list: (brandId: string): readonly ["business-events", "list", string] =>
    [...businessEventKeys.lists(), brandId] as const,
  details: (): readonly ["business-events", "detail"] =>
    [...businessEventKeys.all, "detail"] as const,
  detail: (eventId: string): readonly ["business-events", "detail", string] =>
    [...businessEventKeys.details(), eventId] as const,
};

export const useBusinessEventsForBrand = (
  brandId: string | null,
): UseQueryResult<LiveEvent[]> => {
  // ORCH-1004 — reads `business_management_events_view` (security_invoker=true)
  // + RLS-scoped `events`. Anon firing returns 200 + [] (cached as success),
  // so gate on auth readiness. The PUBLIC buyer feed is usePublicEvents.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery<LiveEvent[]>({
    queryKey:
      enabled && brandId !== null ? businessEventKeys.list(brandId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<LiveEvent[]> => {
      if (!enabled || brandId === null) return [];
      return fetchBusinessEventsForBrand(brandId);
    },
  });
};

export const useBusinessEventById = (
  eventId: string | null,
): UseQueryResult<BusinessEventDetail | null> => {
  // ORCH-1004 — management detail reads the security_invoker view + RLS
  // `events`; gate on auth readiness (public detail is usePublicEvents).
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && eventId !== null;
  return useQuery<BusinessEventDetail | null>({
    queryKey:
      enabled && eventId !== null ? businessEventKeys.detail(eventId) : DISABLED_KEY,
    enabled,
    // ORCH-1172 R5 — fetch FRESH on every mount. This hook feeds ONLY managed-
    // event surfaces (the edit-published editor via /rsvp|/event[id]/edit, the
    // event/rsvp dashboards + scanner/orders/guests/door/recon sub-screens via
    // useManagedEventRoute) — never the hot brand-list feed (that is
    // useBusinessEventsForBrand). On those surfaces you ALWAYS want current DB
    // state. R4 made the editor hold its Loading shell until this query SETTLES
    // (serverEventSettled = isAuthReady && !isLoading && !isFetching) before
    // seeding editState from the server event. But with the previous 30s
    // staleTime + default refetchOnMount, a mount within 30s of viewing the
    // event resolved INSTANTLY from STALE cache → R4 seeded stale → a
    // full-state/diff save could still clobber a field that diverged on the
    // server (the rsvp_discoverable revert edge). staleTime:0 +
    // refetchOnMount:"always" force a network fetch on each mount; combined with
    // R4's !isFetching gate the editor waits for the FRESH row, then seeds from
    // it — killing the last stale-cache clobber.
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<BusinessEventDetail | null> => {
      if (!enabled || eventId === null) return null;
      return fetchBusinessEventById(eventId);
    },
  });
};

export const mergeServerAndLegacyLiveEvents = (
  serverEvents: LiveEvent[],
  legacyEvents: LiveEvent[],
): LiveEvent[] => {
  const serverIds = new Set(serverEvents.map((event) => event.id));
  const serverEventIds = new Set(
    serverEvents
      .map((event) => event.serverEventId)
      .filter((id): id is string => id !== null),
  );
  const legacyOnly = legacyEvents.filter((event) => {
    if (serverIds.has(event.id)) return false;
    if (event.serverEventId !== null && serverEventIds.has(event.serverEventId)) {
      return false;
    }
    return true;
  });
  return [...serverEvents, ...legacyOnly];
};

export const usePublishBusinessEventDraft = (): {
  publishDraft: (draft: DraftEvent) => Promise<PublishedBusinessEvent>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const mutation = useMutation<PublishedBusinessEvent, Error, DraftEvent>({
    mutationFn: (draft) =>
      publishBusinessEventDraft(draft, draft.clientRevision ?? 0),
    onSuccess: (published, draft) => {
      deleteDraft(draft.id);
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.setQueryData<DraftEvent[]>(
        eventDraftKeys.list(draft.brandId),
        (prev) => (prev ?? []).filter((d) => d.id !== draft.id),
      );
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
      writePublishedEventCaches(queryClient, published, draft.brandId);
      // META-ORCH-1187 — offering-published conversion (SC-6).
      postHogService.capture("offering_published", {
        offering_type: "event",
        brand_id: draft.brandId,
        surface: "business_app",
      });
    },
    onError: (error) => {
      logMutationError("usePublishBusinessEventDraft", error);
    },
  });

  return {
    publishDraft: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

export const useCancelBusinessEvent = (): {
  cancelEvent: (input: { eventId: string; brandId: string }) => Promise<PublishedBusinessEvent>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    PublishedBusinessEvent,
    Error,
    { eventId: string; brandId: string }
  >({
    mutationFn: ({ eventId }) => cancelBusinessEvent(eventId),
    onSuccess: (published, input) => {
      writePublishedEventCaches(queryClient, published, input.brandId);
    },
    onError: (error) => {
      logMutationError("useCancelBusinessEvent", error);
    },
  });

  return {
    cancelEvent: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

export const useEndBusinessEventTicketSales = (): {
  endTicketSales: (input: {
    eventId: string;
    brandId: string;
  }) => Promise<PublishedBusinessEvent>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    PublishedBusinessEvent,
    Error,
    { eventId: string; brandId: string }
  >({
    mutationFn: ({ eventId }) => endBusinessEventTicketSales(eventId),
    onSuccess: (published, input) => {
      writePublishedEventCaches(queryClient, published, input.brandId);
    },
    onError: (error) => {
      logMutationError("useEndBusinessEventTicketSales", error);
    },
  });

  return {
    endTicketSales: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};
