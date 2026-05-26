import { type QueryClient } from "@tanstack/react-query";

import {
  fetchBusinessEventById,
  type BusinessEventDetail,
} from "../services/businessEvents";
import { businessEventKeys } from "../hooks/useBusinessEvents";
import type { LiveEvent } from "../store/liveEventStore";

export interface RefreshPublishedEventWhenInput {
  queryClient: QueryClient;
  eventId: string;
  brandId: string;
  fetchDetail?: (eventId: string) => Promise<BusinessEventDetail | null>;
}

export const refreshPublishedEventWhenAfterSave = async ({
  queryClient,
  eventId,
  brandId,
  fetchDetail = fetchBusinessEventById,
}: RefreshPublishedEventWhenInput): Promise<BusinessEventDetail> => {
  const detail = await fetchDetail(eventId);
  if (detail === null) {
    throw new Error("patch_event_when_refresh_failed");
  }

  queryClient.setQueryData<BusinessEventDetail | null>(
    businessEventKeys.detail(eventId),
    detail,
  );
  queryClient.setQueryData<LiveEvent[]>(
    businessEventKeys.list(brandId),
    (prev) => {
      if (prev === undefined) return prev;
      const nextEvent = detail.event;
      let replaced = false;
      const next = prev.map((event) => {
        if (event.id !== nextEvent.id) return event;
        replaced = true;
        return nextEvent;
      });
      return replaced ? next : [nextEvent, ...next];
    },
  );

  return detail;
};
