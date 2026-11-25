/**
 * #4490 P3-3 — the state behind booking a group package: the package's
 * public detail, its days and start times (one availability row per start),
 * the chosen day, time, group size, answers and extras, the pay mode, and a
 * live server quote (re-asked, debounced, on every change).
 *
 * Shared by the venue page's Groups pane and the package checkout, so both
 * show the same days, rules and totals. Anonymous: no `useAuth`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, venueToday, type EntryDayRow, type EntryDayTile } from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  answersPayload,
  groupRange,
  missingAnswer,
  optionForGuests,
  packageDayTiles,
  startChipsFor,
  type PackageChoice,
  type PackageOfferDetail,
  type PackageQuote,
  type StartChip,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
import { randomId } from "../../../utils/randomId";
import { venueOfferQueryKeys } from "./useEntrySelection";

export const PACKAGE_STRIP_DAYS = 60;
const QUOTE_DEBOUNCE_MS = 450;

export type PackageQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: PackageQuote }
  | { status: "error"; code: string; remaining: number | null };

export interface PackageSelection {
  offer: PackageOfferDetail | null;
  offerState: "loading" | "ready" | "error";
  offerError: string | null;
  retryOffer: () => void;
  daysState: "loading" | "ready" | "error";
  retryDays: () => void;
  rows: EntryDayRow[];
  tiles: EntryDayTile[];
  selectedDate: string | null;
  selectedTile: EntryDayTile | null;
  selectDate: (date: string) => void;
  chips: StartChip[];
  windowId: string | null;
  selectWindow: (windowId: string) => void;
  guests: number;
  setGuests: (n: number) => void;
  range: { min: number; max: number };
  answers: Record<number, number>;
  setAnswer: (question: number, option: number) => void;
  extras: string[];
  toggleExtra: (id: string) => void;
  payMode: "deposit" | "full";
  setPayMode: (mode: "deposit" | "full") => void;
  /** Why the guest can't go on, in plain words; null when they can. */
  problem: string | null;
  quote: PackageQuoteState;
  retryQuote: () => void;
  refreshQuote: () => Promise<PackageQuote | null>;
  choice: PackageChoice | null;
}

export function usePackageSelection(input: {
  brandSlug: string;
  venueSlug: string;
  offeringId: string;
  cartKey: string;
  initial?: PackageChoice | null;
  enabled?: boolean;
}): PackageSelection {
  const { brandSlug, venueSlug, offeringId, cartKey } = input;
  const enabled = input.enabled !== false;

  const offerQuery = useQuery({
    queryKey: [...venueOfferQueryKeys.offer(brandSlug, venueSlug, offeringId), "package"],
    enabled,
    retry: 1,
    staleTime: 60_000,
    queryFn: () => venueOfferGuestService.packageOffer({ brandSlug, venueSlug, offeringId }),
  });
  const offer = offerQuery.data ?? null;
  const from = useMemo(() => venueToday(new Date(), offer?.venue.timezone ?? null), [offer?.venue.timezone]);
  const to = addDays(from, PACKAGE_STRIP_DAYS - 1);
  const daysQuery = useQuery({
    queryKey: venueOfferQueryKeys.days(offeringId, from, null),
    enabled: enabled && offer !== null,
    retry: 1,
    staleTime: 30_000,
    queryFn: () => venueOfferGuestService.availability({ offeringId, from, to }),
  });
  const rows = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);
  const tiles = useMemo(() => packageDayTiles(rows, from, PACKAGE_STRIP_DAYS), [rows, from]);
  const range = useMemo(() => groupRange(offer?.options ?? []), [offer?.options]);

  const [selectedDate, setSelectedDate] = useState<string | null>(input.initial?.date ?? null);
  const [windowId, setWindowId] = useState<string | null>(input.initial?.windowId ?? null);
  const [guests, setGuestsRaw] = useState<number>(input.initial?.guests ?? 0);
  const [answers, setAnswers] = useState<Record<number, number>>(input.initial?.answers ?? {});
  const [extras, setExtras] = useState<string[]>(input.initial?.extras ?? []);
  const [payMode, setPayMode] = useState<"deposit" | "full">(input.initial?.payMode ?? "deposit");

  // Start at the smallest group once the package is known.
  useEffect(() => {
    if (offer === null) return;
    setGuestsRaw((g) => (g === 0 ? range.min : Math.min(range.max, Math.max(range.min, g))));
    if (!offer.payModes.includes("deposit")) setPayMode("full");
  }, [offer, range.max, range.min]);

  // First bookable day when nothing (or a day outside the strip) is chosen.
  useEffect(() => {
    if (!daysQuery.isSuccess) return;
    if (selectedDate !== null && tiles.some((t) => t.date === selectedDate)) return;
    setSelectedDate(tiles.find((t) => t.soldOnline)?.date ?? tiles[0]?.date ?? null);
  }, [daysQuery.isSuccess, selectedDate, tiles]);

  const selectedTile = useMemo(() => tiles.find((t) => t.date === selectedDate) ?? null, [tiles, selectedDate]);
  const chips = useMemo(
    () => startChipsFor(rows, selectedDate, guests, offer?.venue.timezone ?? null),
    [rows, selectedDate, guests, offer?.venue.timezone],
  );
  // A time that no longer fits (another day, or not enough room) is dropped.
  useEffect(() => {
    if (!daysQuery.isSuccess || windowId === null) return;
    const current = chips.find((c) => c.windowId === windowId);
    if (current === undefined || !current.usable) setWindowId(null);
  }, [chips, daysQuery.isSuccess, windowId]);

  const option = offer === null ? null : optionForGuests(offer.options, guests);
  const unanswered = offer === null ? null : missingAnswer(offer, answers);
  const problem: string | null =
    offer === null || !daysQuery.isSuccess
      ? null
      : !offer.canCollectOnline
        ? "Group bookings are taken at the venue only right now."
        : selectedTile === null || !selectedTile.soldOnline
          ? "Pick a day that's open for groups."
          : windowId === null
            ? "Pick a start time."
            : option === null
              ? `Groups are ${range.min} to ${range.max} guests.`
              : unanswered !== null
                ? `Choose: ${unanswered}.`
                : null;

  // ── the live quote ──────────────────────────────────────────────────────
  const [quote, setQuote] = useState<PackageQuoteState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const answerMap = useMemo(() => (offer === null ? {} : answersPayload(offer, answers)), [offer, answers]);
  const quoteKey = `${windowId ?? ""}|${option?.id ?? ""}|${guests}|${extras.join(",")}|${JSON.stringify(answerMap)}|${nonce}`;
  const latest = useRef(quoteKey);
  latest.current = quoteKey;

  const askQuote = async (): Promise<PackageQuote | null> => {
    if (!enabled || problem !== null || windowId === null || option === null) {
      setQuote({ status: "idle" });
      return null;
    }
    const asked = latest.current;
    setQuote({ status: "loading" });
    try {
      const next = await venueOfferGuestService.packageQuote({
        offeringId,
        windowId,
        lines: [{ priceOptionId: option.id, guests }],
        extras: extras.map((id) => ({ id })),
        answers: answerMap,
        cartKey,
        idempotencyKey: `venue-offer:quote:${randomId()}`,
      });
      if (latest.current === asked) setQuote({ status: "ready", quote: next });
      return next;
    } catch (caught) {
      const error = caught instanceof VenueOfferGuestError ? caught : new VenueOfferGuestError("offer_request_failed", null);
      if (latest.current === asked) setQuote({ status: "error", code: error.code, remaining: error.remaining });
      return null;
    }
  };

  useEffect(() => {
    if (!enabled || problem !== null || windowId === null || option === null) {
      setQuote({ status: "idle" });
      return undefined;
    }
    setQuote({ status: "loading" });
    const timer = setTimeout(() => void askQuote(), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, problem, enabled]);

  return {
    offer,
    offerState: offerQuery.isLoading ? "loading" : offerQuery.isError || offer === null ? "error" : "ready",
    offerError:
      offerQuery.error instanceof VenueOfferGuestError ? offerQuery.error.code : offerQuery.isError ? "offer_request_failed" : null,
    retryOffer: () => void offerQuery.refetch(),
    daysState: daysQuery.isLoading || offer === null ? "loading" : daysQuery.isError ? "error" : "ready",
    retryDays: () => void daysQuery.refetch(),
    rows,
    tiles,
    selectedDate,
    selectedTile,
    selectDate: (date) => {
      setSelectedDate(date);
      setWindowId(null);
    },
    chips,
    windowId,
    selectWindow: setWindowId,
    guests,
    setGuests: (n) => setGuestsRaw(Math.min(range.max, Math.max(range.min, n))),
    range,
    answers,
    setAnswer: (q, o) => setAnswers((cur) => ({ ...cur, [q]: o })),
    extras,
    toggleExtra: (id) => setExtras((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
    payMode,
    setPayMode,
    problem,
    quote,
    retryQuote: () => setNonce((n) => n + 1),
    refreshQuote: askQuote,
    choice:
      selectedDate !== null && windowId !== null && guests > 0
        ? { date: selectedDate, windowId, guests, extras, answers, payMode }
        : null,
  };
}
