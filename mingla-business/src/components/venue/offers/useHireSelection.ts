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
  hourLengthsFor,
  hourPlaceFree,
  venueClockRange,
  placeListFor,
  sessionChipsFor,
  type HireChoice,
  type HireDayRow,
  type HireDayTile,
  type HireHourDay,
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
  /** #4490 P4 follow-up: "Hours you set" for the chosen day (null when the venue doesn't offer it that day). */
  hourDay: HireHourDay | null;
  /** The chosen session is "Your own hours". */
  isFlex: boolean;
  startsAt: string | null;
  selectStart: (iso: string) => void;
  minutes: number | null;
  selectMinutes: (m: number) => void;
  lengths: number[];
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

  // #4490 P4 follow-up: "Hours you set" — the day's opening hours, start times and busy places.
  const hourQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireHourDay", offeringId, selectedDate, guests],
    enabled: enabled && offer !== null && selectedDate !== null && guests > 0,
    retry: 0,
    staleTime: 15_000,
    queryFn: () => venueOfferGuestService.hireHourDay({ offeringId, date: selectedDate as string, guests }),
  });
  const hourDay = hourQuery.data !== undefined && hourQuery.data !== null && hourQuery.data.status === "open" && hourQuery.data.windowId !== null ? hourQuery.data : null;
  const flexWindowId = hourDay?.windowId ?? null;
  const sessions = useMemo(() => {
    const tz = offer?.venue.timezone ?? null;
    const list = sessionChipsFor(rows.filter((r) => r.windowId !== flexWindowId), selectedDate, offer?.sessions ?? [], tz, true);
    if (hourDay === null || flexWindowId === null) return list;
    return [
      ...list,
      {
        windowId: flexWindowId,
        label: "Your own hours",
        times: venueClockRange(hourDay.opensAt, hourDay.closesAt, tz),
        usable: hourDay.starts.length > 0,
        note: hourDay.starts.length > 0 ? null : "Fully booked",
      },
    ];
  }, [rows, selectedDate, offer?.sessions, offer?.venue.timezone, hourDay, flexWindowId]);
  const isFlexChosen = (id: string | null): boolean => id !== null && id === flexWindowId;
  // One session that day: pick it; a session that left the day is dropped.
  // Named sessions first; "Your own hours" only when it's the one thing open.
  useEffect(() => {
    if (!daysQuery.isSuccess || hourQuery.isFetching) return;
    const usable = sessions.filter((s) => s.usable);
    if (windowId !== null && sessions.some((s) => s.windowId === windowId)) return;
    setWindowId(usable.length >= 1 ? usable[0].windowId : null);
  }, [daysQuery.isSuccess, hourQuery.isFetching, sessions, windowId]);

  const isFlex = isFlexChosen(windowId);
  const [startsAt, setStartsAt] = useState<string | null>(input.initial?.startsAt ?? null);
  const [minutes, setMinutes] = useState<number | null>(input.initial?.minutes ?? null);
  const lengths = useMemo(() => (hourDay === null ? [] : hourLengthsFor(hourDay, startsAt)), [hourDay, startsAt]);
  // A start that left the day is dropped; a length that no longer fits snaps to the longest that does.
  useEffect(() => {
    if (!isFlex || hourDay === null) return;
    if (startsAt !== null && !hourDay.starts.some((x) => x.startsAt === startsAt)) setStartsAt(null);
  }, [isFlex, hourDay, startsAt]);
  useEffect(() => {
    if (!isFlex) return;
    if (lengths.length === 0) {
      if (minutes !== null && startsAt === null) setMinutes(null);
      return;
    }
    if (minutes === null || !lengths.includes(minutes)) setMinutes(lengths[0]);
  }, [isFlex, lengths, minutes, startsAt]);

  const placesQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireOptions", offeringId, windowId, guests],
    enabled: enabled && windowId !== null && guests > 0 && !isFlex,
    retry: 1,
    staleTime: 15_000,
    queryFn: () => venueOfferGuestService.hireOptions({ offeringId, windowId: windowId as string, guests }),
  });
  const flexPlaces = useMemo<HirePlaceOption[]>(() => {
    if (!isFlex || hourDay === null || offer === null) return [];
    return hourDay.places.map((p) => {
      const row = offer.rows.find((r) => r.optionId === p.priceOptionId);
      const free = startsAt !== null && minutes !== null && hourPlaceFree(p, startsAt, minutes, hourDay.setupMinutes, hourDay.cleanupMinutes);
      return {
        priceOptionId: p.priceOptionId,
        name: row?.name ?? p.name,
        spaceId: row?.spaceId ?? null,
        combinationId: row?.combinationId ?? null,
        placeName: row?.placeName ?? p.name,
        setting: null,
        capacity: row?.capacity ?? null,
        guestMin: row?.guestMin ?? 1,
        guestMax: row?.guestMax ?? guests,
        unit: row?.unit ?? "booking",
        priceMinor: row?.priceMinor ?? 0,
        status: startsAt === null || minutes === null || free ? "available" : "taken",
        reason: null,
        blockedBy: null,
      };
    });
  }, [isFlex, hourDay, offer, startsAt, minutes, guests]);
  const allPlaces = useMemo(() => (isFlex ? flexPlaces : placesQuery.data ?? []), [isFlex, flexPlaces, placesQuery.data]);
  const places = useMemo(() => placeListFor(allPlaces, guests), [allPlaces, guests]);
  // A place that isn't free for this group any more is dropped; one free place is picked.
  useEffect(() => {
    if (!placesQuery.isSuccess && !isFlex) return;
    if (isFlex && (startsAt === null || minutes === null)) return;
    const free = places.shown.filter((p) => p.status === "available");
    if (optionId !== null && free.some((p) => p.priceOptionId === optionId)) return;
    setOptionId(free.length === 1 ? free[0].priceOptionId : null);
  }, [placesQuery.isSuccess, places, optionId, isFlex, startsAt, minutes]);

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
            : isFlex && startsAt === null
              ? "Pick a start time."
              : isFlex && minutes === null
                ? "Pick how long."
            : !isFlex && placesQuery.isLoading
              ? "Checking which spaces are free…"
              : places.shown.length === 0
                ? `No space fits ${guests} that session. Change the number of guests or the day.`
                : selectedPlace === null
                  ? places.shown.some((p) => p.status === "available")
                    ? "Pick a space."
                    : isFlex
                      ? "No space is free for that time. Pick another start or length."
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
      setStartsAt(null);
    },
    sessions,
    windowId,
    selectWindow: (id) => {
      setWindowId(id);
      setOptionId(null);
    },
    placesState: windowId === null ? "idle" : isFlex ? (startsAt === null ? "idle" : "ready") : placesQuery.isLoading ? "loading" : placesQuery.isError ? "error" : "ready",
    retryPlaces: () => void placesQuery.refetch(),
    places,
    allPlaces,
    optionId,
    selectOption: setOptionId,
    selectedPlace,
    hourDay,
    isFlex,
    startsAt,
    selectStart: (iso) => {
      setStartsAt(iso);
      setOptionId(null);
    },
    minutes,
    selectMinutes: (m) => {
      setMinutes(m);
      setOptionId(null);
    },
    lengths,
    problem,
    choice:
      selectedDate !== null && windowId !== null && optionId !== null && guests > 0
        ? isFlex
          ? startsAt !== null && minutes !== null
            ? { date: selectedDate, windowId, guests, priceOptionId: optionId, startsAt, minutes }
            : null
          : { date: selectedDate, windowId, guests, priceOptionId: optionId }
        : null,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
