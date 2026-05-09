import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { DraftEvent } from "../store/draftEventStore";
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
import { eventDraftKeys } from "./useServerDraftEvents";
import { publicEventKeys } from "./usePublicEvents";

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
    kind: "popup",
    address: null,
    coverHue: published.event.coverHue,
    role: "owner",
    stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
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
  queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(published.event.id) });
  queryClient.invalidateQueries({ queryKey: businessEventKeys.list(brandId) });
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
  const enabled = brandId !== null;
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
  const enabled = eventId !== null;
  return useQuery<BusinessEventDetail | null>({
    queryKey:
      enabled && eventId !== null ? businessEventKeys.detail(eventId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
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
  const mutation = useMutation<PublishedBusinessEvent, Error, DraftEvent>({
    mutationFn: (draft) =>
      publishBusinessEventDraft(draft, draft.clientRevision ?? 0),
    onSuccess: (published, draft) => {
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
      writePublishedEventCaches(queryClient, published, draft.brandId);
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
