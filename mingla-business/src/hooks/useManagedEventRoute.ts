import { useMemo } from "react";

import { useBrandList, type Brand } from "../store/currentBrandStore";
import { useLiveEventStore, type LiveEvent } from "../store/liveEventStore";
import { useBusinessEventById } from "./useBusinessEvents";
import { useTrip } from "./useTrips";
import { tripToLiveEvent } from "../utils/tripToLiveEvent";

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

  // META-ORCH-1059 Pass 2 — TRIP fallback. The event-only detail read
  // (fetchBusinessEventById) deliberately rejects trip rows (ORCH-0859), so
  // the shared event sub-screens (scanner/scanners/orders/guests/recon) can't
  // resolve a trip id through that path. When neither the local store nor the
  // server event detail produced a row, try the trip read and adapt it into
  // the minimal LiveEvent the sub-screens consume. Event/experience routes are
  // untouched (this only activates once the primary paths return null), so the
  // event dashboard is unaffected and the locked trip-rejection probe stays.
  const eventResolvedFromPrimary =
    serverDetail?.event !== undefined || localEvent !== null;
  const tripQuery = useTrip(
    eventResolvedFromPrimary ? null : (eventId ?? null),
  );
  const tripFallbackEvent = useMemo<LiveEvent | null>(
    () =>
      eventResolvedFromPrimary
        ? null
        : tripToLiveEvent(tripQuery.data ?? null),
    [eventResolvedFromPrimary, tripQuery.data],
  );

  const brand = useMemo<Brand | null>(() => {
    if (serverDetail?.brand !== undefined) return serverDetail.brand;
    const brandIdToMatch =
      localEvent?.brandId ?? tripFallbackEvent?.brandId ?? null;
    if (brandIdToMatch === null) return null;
    return brands.find((b) => b.id === brandIdToMatch) ?? null;
  }, [brands, localEvent, serverDetail?.brand, tripFallbackEvent]);

  const resolvedEvent =
    serverDetail?.event ?? localEvent ?? tripFallbackEvent;

  return {
    event: resolvedEvent,
    brand,
    localEvent,
    isServerBacked:
      serverDetail?.event !== undefined || tripFallbackEvent !== null,
    isLoading:
      businessEventQuery.isLoading ||
      businessEventQuery.isFetching ||
      (!eventResolvedFromPrimary && tripQuery.isLoading),
    replacementEventId,
  };
};
