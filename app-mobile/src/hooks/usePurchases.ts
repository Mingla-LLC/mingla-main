import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { fetchMyReservations } from "./useMyReservations";
import { purchaseKeys } from "./queryKeys";
import {
  fetchMyHeldTickets,
  fetchMyOrders,
  fetchMyMemberships,
  fetchMyRsvps,
  fetchMyVenueBookings,
  fetchMyVenueOrders,
  fetchMyWaitlistEntries,
} from "../services/purchasesService";
import {
  buildPurchaseTimeline,
  type PurchaseKind,
  type PurchaseReservationSource,
  type PurchaseTimelineItem,
  type PurchaseTimeline,
  type PurchaseVenueBookingSource,
  type PurchaseVenueMembershipSource,
  type PurchaseVenueOrderSource,
  type PurchaseVenueWaitlistSource,
} from "../utils/purchaseTimeline";
import type { PurchaseOrderRecord } from "../services/purchasesService";
import {
  fetchMyPurchaseShareFlags,
  fetchMySharedPurchases,
  sharedPurchaseSources,
  type SharedPurchase,
} from "../services/sharedPurchasesService";
import type { PurchaseSources } from "../utils/purchaseTimeline";

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

/**
 * #4473 — owned purchases first; a shared copy of something this account
 * already owns is dropped, so nothing shows twice.
 */
export function mergeSharedSources(
  owned: PurchaseSources,
  shared: readonly SharedPurchase[],
): PurchaseSources {
  const extra = sharedPurchaseSources(shared);
  const ownedIds = (items: readonly { id: string }[]) =>
    new Set(items.map((item) => item.id));
  const orderIds = ownedIds(owned.orders);
  const rsvpIds = ownedIds(owned.rsvps);
  const reservationIds = ownedIds(owned.reservations);
  const venueOrderIds = ownedIds(owned.venueOrders);
  return {
    orders: [...owned.orders, ...extra.orders.filter((item) => !orderIds.has(item.id))],
    rsvps: [...owned.rsvps, ...extra.rsvps.filter((item) => !rsvpIds.has(item.id))],
    reservations: [
      ...owned.reservations,
      ...extra.reservations.filter((item) => !reservationIds.has(item.id)),
    ],
    venueOrders: [
      ...owned.venueOrders,
      ...extra.venueOrders.filter((item) => !venueOrderIds.has(item.id)),
    ],
    stays: [...(owned.stays ?? []), ...(extra.stays ?? [])],
    // #4490 Explorer W2 — venue items are never shared (decision 4).
    venueBookings: owned.venueBookings ?? [],
    venueMemberships: owned.venueMemberships ?? [],
    venueWaitlist: owned.venueWaitlist ?? [],
  };
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
  const owned = await fetchOwnedPurchaseDetail(userId, kind, id);
  if (owned) return owned;
  // #4490 W2-N16: venue items are never shared (decision 4), so a venue id
  // that is not this account's is a not-found, not a second read that can fail.
  if (kind === "venue_booking" || kind === "venue_membership" || kind === "venue_waitlist") return null;
  // #4473 — not this account's own purchase: it may be shared with it.
  const shared = sharedPurchaseSources(await fetchMySharedPurchases());
  return findTimelineItem(buildPurchaseTimeline(shared, new Date()), kind, id);
}

async function fetchOwnedPurchaseDetail(
  userId: string,
  kind: PurchaseKind,
  id: string,
): Promise<PurchaseTimelineItem | null> {
  // Owned stays open on /stay; only shared ones are Purchases items.
  if (kind === "stay") return null;
  const empty = { orders: [], rsvps: [], reservations: [], venueOrders: [] };
  // #4490 Explorer W2 — the signed-in guest's venue bookings, plans and places.
  if (kind === "venue_booking") {
    const venueBookings = await fetchMyVenueBookings();
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, venueBookings }, new Date()),
      kind,
      id,
    );
  }
  if (kind === "venue_membership") {
    const venueMemberships = await fetchMyMemberships();
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, venueMemberships }, new Date()),
      kind,
      id,
    );
  }
  if (kind === "venue_waitlist") {
    const venueWaitlist = await fetchMyWaitlistEntries();
    return findTimelineItem(
      buildPurchaseTimeline({ ...empty, venueWaitlist }, new Date()),
      kind,
      id,
    );
  }
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
  options?: { staleTime?: number },
): PurchasesQueryResult {
  const safeUserId = userId ?? "none";
  // #4265: the Purchases screen keeps 60 s; the Profile card passes a longer
  // window so a tab revisit does not refetch all four lists (checkout, claim and
  // calendar flows invalidate purchaseKeys.all whenever a purchase changes).
  const staleTime = options?.staleTime ?? 60_000;
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
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "rsvps"],
        queryFn: () => fetchMyRsvps(userId as string),
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "reservations"],
        queryFn: () => fetchMyReservations(userId as string),
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "venueOrders"],
        queryFn: fetchMyVenueOrders,
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        // #4473 — purchases shared with this account by a proven contact.
        queryKey: [...purchaseKeys.list(safeUserId), "shared"],
        queryFn: fetchMySharedPurchases,
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        // #4490 Explorer W2 — venue bookings (passes), incl. paid at the venue.
        queryKey: [...purchaseKeys.list(safeUserId), "venueBookings"],
        queryFn: fetchMyVenueBookings,
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "venueMemberships"],
        queryFn: fetchMyMemberships,
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
      {
        queryKey: [...purchaseKeys.list(safeUserId), "venueWaitlist"],
        queryFn: fetchMyWaitlistEntries,
        enabled: !!userId,
        staleTime,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        retry: false,
      },
    ],
  });

  const [
    ordersQuery,
    rsvpsQuery,
    reservationsQuery,
    venueOrdersQuery,
    sharedQuery,
    venueBookingsQuery,
    venueMembershipsQuery,
    venueWaitlistQuery,
  ] = queries;
  const reservations = mapReservations(reservationsQuery.data ?? []);
  const venueOrders = (venueOrdersQuery.data ?? []) as PurchaseVenueOrderSource[];
  const timeline = buildPurchaseTimeline(
    mergeSharedSources(
      {
        orders: (ordersQuery.data ?? []) as PurchaseOrderRecord[],
        rsvps: rsvpsQuery.data ?? [],
        reservations,
        venueOrders,
        venueBookings: (venueBookingsQuery.data ?? []) as PurchaseVenueBookingSource[],
        venueMemberships: (venueMembershipsQuery.data ?? []) as PurchaseVenueMembershipSource[],
        venueWaitlist: (venueWaitlistQuery.data ?? []) as PurchaseVenueWaitlistSource[],
      },
      (sharedQuery.data ?? []) as SharedPurchase[],
    ),
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

/** #4473 — purchases shown to this account as shared (Calendar reads these). */
export function useSharedPurchases(userId: string | null | undefined) {
  return useQuery({
    queryKey: [...purchaseKeys.list(userId ?? "none"), "shared"],
    queryFn: fetchMySharedPurchases,
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });
}

/** #4473 — this account's own purchases that also show on another account. */
export function usePurchaseShareFlags(userId: string | null | undefined) {
  return useQuery({
    queryKey: [...purchaseKeys.all, "shareFlags", userId ?? "none"],
    queryFn: fetchMyPurchaseShareFlags,
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });
}
