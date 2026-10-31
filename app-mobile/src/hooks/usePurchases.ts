import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { fetchMyReservations } from "./useMyReservations";
import { purchaseKeys } from "./queryKeys";
import {
  fetchMyHeldTickets,
  fetchMyOrders,
  fetchMyRsvps,
  fetchMyVenueOrders,
} from "../services/purchasesService";
import {
  buildPurchaseTimeline,
  type PurchaseKind,
  type PurchaseReservationSource,
  type PurchaseTimelineItem,
  type PurchaseTimeline,
  type PurchaseVenueOrderSource,
} from "../utils/purchaseTimeline";
import type { PurchaseOrderRecord } from "../services/purchasesService";

export interface PurchasesQueryResult {
  timeline: PurchaseTimeline;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isPartialError: boolean;
  errors: unknown[];
  refetch: () => Promise<void>;
}
function mapReservations(
  reservations: Awaited<ReturnType<typeof fetchMyReservations>>,
): PurchaseReservationSource[] {
  return reservations.map((reservation) => ({
    id: reservation.id,
    title: reservation.brand_name ?? "Booking",
    coverMediaUrl:
      reservation.brand_cover_url ?? reservation.brand_photo_url ?? null,
    coverMediaType:
      reservation.brand_cover_type === "image" ||
      reservation.brand_cover_type === "video" ||
      reservation.brand_cover_type === "gif"
        ? reservation.brand_cover_type
        : reservation.brand_photo_url
          ? "image"
          : null,
    startAt: reservation.reserved_for,
    timezone: "UTC",
    venueLine: reservation.brand_address ?? reservation.brand_city ?? null,
    status: reservation.status,
    partySize: reservation.party_size,
    feeCents: reservation.fee_cents ?? 0,
    currency: reservation.fee_currency ?? "USD",
    refundedAmountCents: reservation.refund?.amount_cents ?? 0,
    raw: reservation,
  }));
}

function findTimelineItem(
  timeline: PurchaseTimeline,
  kind: PurchaseKind,
  id: string,
): PurchaseTimelineItem | null {
  return [...timeline.upcoming, ...timeline.past]
    .flatMap((group) => group.items)
    .find((item) => item.kind === kind && item.id === id) ?? null;
}

async function fetchPurchaseDetail(
  userId: string,
  kind: PurchaseKind,
  id: string,
): Promise<PurchaseTimelineItem | null> {
  const empty = { orders: [], rsvps: [], reservations: [], venueOrders: [] };
  if (kind === "order") {
    const [orders, held] = await Promise.all([
      fetchMyOrders(userId),
      fetchMyHeldTickets(userId),
    ]);
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, orders: [...orders, ...held] }, new Date()),
      kind,
      id,
    );
  }
  if (kind === "rsvp") {
    const rsvps = await fetchMyRsvps(userId);
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, rsvps }, new Date()),
      kind,
      id,
    );
  }
  if (kind === "reservation") {
    const reservations = mapReservations(await fetchMyReservations(userId));
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, reservations }, new Date()),
      kind,
      id,
    );
  }
  const venueOrders = await fetchMyVenueOrders();
  return findTimelineItem(
    buildPurchaseTimeline({ ...empty, venueOrders }, new Date()),
    kind,
    id,
  );
}

function orderTicketsMissing(item: PurchaseTimelineItem | null | undefined): boolean {
  if (item?.kind !== "order" || item.status !== "paid") return false;
  return (item.raw as PurchaseOrderRecord).tickets.length === 0;
}

export function usePurchaseDetail(
  userId: string | null | undefined,
  kind: PurchaseKind | null,
  id: string | null,
) {
  const [pollGeneration, setPollGeneration] = useState(0);
  const pollDeadlineRef = useRef(Date.now() + 15_000);
  useEffect(() => {
    pollDeadlineRef.current = Date.now() + 15_000;
  }, [id, kind, pollGeneration, userId]);

  const enabled = Boolean(userId && kind && id);
  const query = useQuery({
    queryKey: enabled
      ? purchaseKeys.detail(userId as string, kind as PurchaseKind, id as string)
      : [...purchaseKeys.all, "detail", "disabled"],
    enabled,
    queryFn: () => fetchPurchaseDetail(
      userId as string,
      kind as PurchaseKind,
      id as string,
    ),
    retry: false,
    staleTime: 0,
    refetchInterval: (current) => {
      if (kind !== "order" || Date.now() >= pollDeadlineRef.current) return false;
      return current.state.data == null || orderTicketsMissing(current.state.data)
        ? 1_500
        : false;
    },
  });

  const awaitingTickets = kind === "order" && (
    query.data == null || orderTicketsMissing(query.data)
  );
  return {
    ...query,
    awaitingTickets,
    ticketPollingExpired: awaitingTickets && Date.now() >= pollDeadlineRef.current,
    retryTicketLoad: async () => {
      pollDeadlineRef.current = Date.now() + 15_000;
      setPollGeneration((value) => value + 1);
      await query.refetch();
    },
  };
}
export function usePurchases(
  userId: string | null | undefined,
): PurchasesQueryResult {
  const safeUserId = userId ?? "none";
  const queries = useQueries({
    queries: [
      {
        queryKey: [...purchaseKeys.list(safeUserId), "orders"],
        queryFn: async () => {
          const [orders, held] = await Promise.all([
            fetchMyOrders(userId as string),
            fetchMyHeldTickets(userId as string),
          ]);
          return [...orders, ...held];
        },
        enabled: !!userId,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "rsvps"],
        queryFn: () => fetchMyRsvps(userId as string),
        enabled: !!userId,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "reservations"],
        queryFn: () => fetchMyReservations(userId as string),
        enabled: !!userId,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "venueOrders"],
        queryFn: fetchMyVenueOrders,
        enabled: !!userId,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
    ],
  });

  const [ordersQuery, rsvpsQuery, reservationsQuery, venueOrdersQuery] = queries;
  const reservations = mapReservations(reservationsQuery.data ?? []);
  const venueOrders = (venueOrdersQuery.data ?? []) as PurchaseVenueOrderSource[];
  const timeline = buildPurchaseTimeline(
    {
      orders: ordersQuery.data ?? [],
      rsvps: rsvpsQuery.data ?? [],
      reservations,
      venueOrders,
    },
    new Date(),
  );
  const errors = queries.flatMap((query) =>
    query.error == null ? [] : [query.error],
  );
  const successCount = queries.filter((query) => query.isSuccess).length;

  return {
    timeline,
    isLoading: queries.some((query) => query.isLoading),
    isFetching: queries.some((query) => query.isFetching),
    isError: errors.length === queries.length && queries.length > 0,
    isPartialError: errors.length > 0 && successCount > 0,
    errors,
    refetch: async () => {
      await Promise.all(queries.map((query) => query.refetch()));
    },
  };
}
