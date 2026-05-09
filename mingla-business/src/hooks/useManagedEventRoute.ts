import { useMemo } from "react";

import { useBrandList, type Brand } from "../store/currentBrandStore";
import { useLiveEventStore, type LiveEvent } from "../store/liveEventStore";
import { useBusinessEventById } from "./useBusinessEvents";

export interface ManagedEventRouteState {
  event: LiveEvent | null;
  brand: Brand | null;
  localEvent: LiveEvent | null;
  isServerBacked: boolean;
  isLoading: boolean;
  replacementEventId: string | null;
}

export const useManagedEventRoute = (
  eventId: string | null,
): ManagedEventRouteState => {
  const localEvent = useLiveEventStore((s) =>
    eventId === null ? null : s.events.find((e) => e.id === eventId) ?? null,
  );
  const replacementEventId =
    localEvent !== null &&
    localEvent.id.startsWith("le_") &&
    typeof localEvent.serverEventId === "string" &&
    localEvent.serverEventId.length > 0
      ? localEvent.serverEventId
      : null;
  const serverQueryId = replacementEventId ?? eventId;
  const businessEventQuery = useBusinessEventById(serverQueryId);
  const serverDetail = businessEventQuery.data ?? null;
  const brands = useBrandList();

  const brand = useMemo<Brand | null>(() => {
    if (serverDetail?.brand !== undefined) return serverDetail.brand;
    if (localEvent === null) return null;
    return brands.find((b) => b.id === localEvent.brandId) ?? null;
  }, [brands, localEvent, serverDetail?.brand]);

  return {
    event: serverDetail?.event ?? localEvent,
    brand,
    localEvent,
    isServerBacked: serverDetail?.event !== undefined,
    isLoading: businessEventQuery.isLoading || businessEventQuery.isFetching,
    replacementEventId,
  };
};
