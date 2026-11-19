/**
 * #4490 P4-3 — the state behind asking for a private hire: the hire's public
 * detail, the group size, the days (one availability row per session window,
 * 60 days at a time), the chosen day and session, the places for that session
 * (`hire_options`: free / on hold / taken / too small / too big) and the
 * chosen place.
 *
 * Shared by the venue page's Private hire tab and the request page, so both
 * show the same days and places. Anonymous: no `useAuth`.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, venueToday } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  hireDayTiles,
  hireGuestRange,
  placeListFor,
  sessionChipsFor,
  type HireChoice,
  type HireDayRow,
  type HireDayTile,
  type HireOfferDetail,
  type HirePlaceOption,
  type HireSessionChip,
  type PlaceListView,
} from "@mingla/brand-rendering/venueOffers/hireModel";

import { VenueOfferGuestError, venueOfferGuestService, type HireSpaceMedia } from "../../../services/venueOfferGuestService";

export const HIRE_STRIP_DAYS = 60;

export interface HireSelection {
  offer: HireOfferDetail | null;
  offerState: "loading" | "ready" | "error";
  offerError: string | null;
  retryOffer: () => void;
  media: HireSpaceMedia[];
  guests: number;
  setGuests: (n: number) => void;
  range: { min: number; max: number };
  stripFrom: string;
  today: string;
  canGoEarlier: boolean;
  earlier: () => void;
  later: () => void;
  daysState: "loading" | "ready" | "error";
  retryDays: () => void;
  rows: HireDayRow[];
  tiles: HireDayTile[];
  selectedDate: string | null;
  selectDate: (date: string) => void;
  sessions: HireSessionChip[];
  windowId: string | null;
  selectWindow: (windowId: string) => void;
  placesState: "idle" | "loading" | "ready" | "error";
  retryPlaces: () => void;
  places: PlaceListView;
  allPlaces: HirePlaceOption[];
  optionId: string | null;
  selectOption: (id: string) => void;
  selectedPlace: HirePlaceOption | null;
  /** Why the guest can't go on, in plain words; null when they can. */
  problem: string | null;
  choice: HireChoice | null;
}

export function useHireSelection(input: {
  brandSlug: string;
  venueSlug: string;
  offeringId: string;
  initial?: HireChoice | null;
  enabled?: boolean;
}): HireSelection {
  const { brandSlug, venueSlug, offeringId } = input;
  const enabled = input.enabled !== false;

  const offerQuery = useQuery({
    queryKey: ["venueOfferGuest", "offer", brandSlug, venueSlug, offeringId, "hire"],
    enabled,
    retry: 1,
    staleTime: 60_000,
    queryFn: () => venueOfferGuestService.hireOffer({ brandSlug, venueSlug, offeringId }),
  });
  const offer = offerQuery.data ?? null;
  const mediaQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireMedia", brandSlug, venueSlug],
    enabled: enabled && offer !== null,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: () => venueOfferGuestService.hireSpaceMedia({ brandSlug, venueSlug }),
  });
  const range = useMemo(() => (offer === null ? { min: 1, max: 1 } : hireGuestRange(offer)), [offer]);
  const today = useMemo(() => venueToday(new Date(), offer?.venue.timezone ?? null), [offer?.venue.timezone]);
  const [guests, setGuestsRaw] = useState<number>(input.initial?.guests ?? 0);
  useEffect(() => {
    if (offer === null) return;
    setGuestsRaw((g) => (g === 0 ? range.min : Math.min(range.max, Math.max(range.min, g))));
  }, [offer, range.max, range.min]);

  const initialDate = input.initial?.date ?? null;
  const [stripFrom, setStripFrom] = useState<string | null>(null);
  const from = stripFrom ?? (initialDate !== null && initialDate > today ? addDays(initialDate, -Math.min(7, Math.max(0, daysBetween(today, initialDate)))) : today);
  const to = addDays(from, HIRE_STRIP_DAYS - 1);
  const daysQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireDays", offeringId, from, guests],
    enabled: enabled && offer !== null && guests > 0,
    retry: 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => venueOfferGuestService.hireDays({ offeringId, from, to, guests }),
  });
  const rows = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);
  const tiles = useMemo(() => hireDayTiles(rows, from, HIRE_STRIP_DAYS), [rows, from]);

  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  const [windowId, setWindowId] = useState<string | null>(input.initial?.windowId ?? null);
  const [optionId, setOptionId] = useState<string | null>(input.initial?.priceOptionId ?? null);

  // First free day when nothing is chosen (or the chosen one left the strip).
  useEffect(() => {
    if (!daysQuery.isSuccess) return;
    if (selectedDate !== null && tiles.some((t) => t.date === selectedDate)) return;
    if (selectedDate !== null && stripFrom === null && initialDate !== null) return;
    setSelectedDate(tiles.find((t) => t.state === "free")?.date ?? tiles.find((t) => t.state !== "none")?.date ?? null);
  }, [daysQuery.isSuccess, selectedDate, tiles, stripFrom, initialDate]);

  const sessions = useMemo(
    () => sessionChipsFor(rows, selectedDate, offer?.sessions ?? [], offer?.venue.timezone ?? null),
    [rows, selectedDate, offer?.sessions, offer?.venue.timezone],
  );
  // One session that day: pick it; a session that left the day is dropped.
  useEffect(() => {
    if (!daysQuery.isSuccess) return;
    const usable = sessions.filter((s) => s.usable);
    if (windowId !== null && sessions.some((s) => s.windowId === windowId)) return;
    setWindowId(usable.length >= 1 ? usable[0].windowId : null);
  }, [daysQuery.isSuccess, sessions, windowId]);

  const placesQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireOptions", offeringId, windowId, guests],
    enabled: enabled && windowId !== null && guests > 0,
    retry: 1,
    staleTime: 15_000,
    queryFn: () => venueOfferGuestService.hireOptions({ offeringId, windowId: windowId as string, guests }),
  });
  const allPlaces = useMemo(() => placesQuery.data ?? [], [placesQuery.data]);
  const places = useMemo(() => placeListFor(allPlaces, guests), [allPlaces, guests]);
  // A place that isn't free for this group any more is dropped; one free place is picked.
  useEffect(() => {
    if (!placesQuery.isSuccess) return;
    const free = places.shown.filter((p) => p.status === "available");
    if (optionId !== null && free.some((p) => p.priceOptionId === optionId)) return;
    setOptionId(free.length === 1 ? free[0].priceOptionId : null);
  }, [placesQuery.isSuccess, places, optionId]);

  const selectedPlace = places.shown.find((p) => p.priceOptionId === optionId) ?? null;
  const problem: string | null =
    offer === null
      ? null
      : !offer.canCollectOnline
        ? "Private hire is booked with the venue directly right now."
        : selectedDate === null
          ? "Pick a day."
          : windowId === null
            ? sessions.length === 0
              ? "Nothing to hire that day. Pick another day."
              : "Pick a session."
            : placesQuery.isLoading
              ? "Checking which spaces are free…"
              : places.shown.length === 0
                ? `No space fits ${guests} that session. Change the number of guests or the day.`
                : selectedPlace === null
                  ? places.shown.some((p) => p.status === "available")
                    ? "Pick a space."
                    : "Every space is taken that session. Pick another day."
                  : null;

  return {
    offer,
    offerState: offerQuery.isLoading ? "loading" : offerQuery.isError || offer === null ? "error" : "ready",
    offerError:
      offerQuery.error instanceof VenueOfferGuestError ? offerQuery.error.code : offerQuery.isError ? "offer_request_failed" : null,
    retryOffer: () => void offerQuery.refetch(),
    media: mediaQuery.data ?? [],
    guests,
    setGuests: (n) => setGuestsRaw(Math.min(range.max, Math.max(range.min, n))),
    range,
    stripFrom: from,
    today,
    canGoEarlier: from > today,
    earlier: () => setStripFrom(from <= today ? today : maxDate(today, addDays(from, -HIRE_STRIP_DAYS))),
    later: () => setStripFrom(addDays(from, HIRE_STRIP_DAYS)),
    daysState: daysQuery.isLoading || offer === null ? "loading" : daysQuery.isError ? "error" : "ready",
    retryDays: () => void daysQuery.refetch(),
    rows,
    tiles,
    selectedDate,
    selectDate: (date) => {
      setSelectedDate(date);
      setWindowId(null);
      setOptionId(null);
    },
    sessions,
    windowId,
    selectWindow: (id) => {
      setWindowId(id);
      setOptionId(null);
    },
    placesState: windowId === null ? "idle" : placesQuery.isLoading ? "loading" : placesQuery.isError ? "error" : "ready",
    retryPlaces: () => void placesQuery.refetch(),
    places,
    allPlaces,
    optionId,
    selectOption: setOptionId,
    selectedPlace,
    problem,
    choice:
      selectedDate !== null && windowId !== null && optionId !== null && guests > 0
        ? { date: selectedDate, windowId, guests, priceOptionId: optionId }
        : null,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
