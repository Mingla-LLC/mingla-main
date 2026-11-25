/**
 * #4490 P2 — the state behind buying entry: the offer's public detail, the
 * days on sale (one read for the strip, one per price option for its weekday
 * and busy-time answers), the chosen day and counts, and a live server quote.
 *
 * Shared by the venue page's Entry tab and the checkout page, so both show
 * the same days, the same rules and the same total. Anonymous: no `useAuth`.
 * The server computes every total; the quote is re-asked (debounced) whenever
 * the day or a count changes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  countsForDay,
  entryDayTiles,
  entryOptionRows,
  entrySelectionProblem,
  entrySessionsFor,
  nextOpenDate,
  pickEntrySession,
  quoteLinesFor,
  totalGuests,
  venueToday,
  type EntryCounts,
  type EntryDayRow,
  type EntryDayTile,
  type EntryOfferDetail,
  type EntrySessionChip,
  type EntryOptionRow,
  type EntryQuote,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import {
  VenueOfferGuestError,
  venueOfferGuestService,
} from "../../../services/venueOfferGuestService";
import { randomId } from "../../../utils/randomId";
import { parseMemberQuote, type MemberQuoteBlock } from "./memberGuestModel";

/** How many days the strip offers (the availability read allows 62). */
export const ENTRY_STRIP_DAYS = 60;
const QUOTE_DEBOUNCE_MS = 450;

export const venueOfferQueryKeys = {
  offer: (brandSlug: string, venueSlug: string, offeringId: string) =>
    ["venue-offer", "detail", brandSlug, venueSlug, offeringId] as const,
  days: (offeringId: string, from: string, optionId: string | null) =>
    ["venue-offer", "days", offeringId, from, optionId ?? "all"] as const,
};

export type EntryQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: EntryQuote }
  | { status: "error"; code: string; remaining: number | null };

export interface EntrySelection {
  offer: EntryOfferDetail | null;
  offerState: "loading" | "ready" | "error";
  offerError: string | null;
  retryOffer: () => void;
  daysState: "loading" | "ready" | "error";
  retryDays: () => void;
  tiles: EntryDayTile[];
  selectedDate: string | null;
  selectedTile: EntryDayTile | null;
  selectDate: (date: string) => void;
  /** #4490 fix 2 (N85) — the day's timed sessions (empty when the day has one window). */
  sessions: EntrySessionChip[];
  /** The session being quoted (null when the day has one window). */
  selectedSession: EntrySessionChip | null;
  selectSession: (windowId: string) => void;
  nextOpen: string | null;
  optionRows: EntryOptionRow[];
  counts: EntryCounts;
  setCount: (optionId: string, next: number) => void;
  guests: number;
  /** Why the guest cannot go on, in plain words; null when they can. */
  problem: string | null;
  quote: EntryQuoteState;
  retryQuote: () => void;
  /** Ask for a fresh quote now (used right before holding). */
  refreshQuote: () => Promise<EntryQuote | null>;
  /** #4490 P6 — the member's price block of the current quote (null when not quoting as a member). */
  member: MemberQuoteBlock | null;
}

export function useEntrySelection(input: {
  brandSlug: string;
  venueSlug: string;
  offeringId: string;
  cartKey: string;
  initialDate?: string | null;
  /** #4490 fix 2 (N85) — the session picked on the venue page. */
  initialWindowId?: string | null;
  initialCounts?: EntryCounts | null;
  /** The checkout keeps quoting; the venue pane quotes too, for its total. */
  enabled?: boolean;
  /** #4490 P6 — quote at this member's price (their free entry and guest passes first). */
  membership?: { subscriptionId: string; token: string } | null;
}): EntrySelection {
  const { brandSlug, venueSlug, offeringId, cartKey } = input;
  const enabled = input.enabled !== false;

  const offerQuery = useQuery({
    queryKey: venueOfferQueryKeys.offer(brandSlug, venueSlug, offeringId),
    enabled,
    retry: 1,
    staleTime: 60_000,
    queryFn: () => venueOfferGuestService.offer({ brandSlug, venueSlug, offeringId }),
  });
  const offer = offerQuery.data ?? null;
  const from = useMemo(
    () => venueToday(new Date(), offer?.venue.timezone ?? null),
    [offer?.venue.timezone],
  );
  const to = addDays(from, ENTRY_STRIP_DAYS - 1);

  const daysQuery = useQuery({
    queryKey: venueOfferQueryKeys.days(offeringId, from, null),
    enabled: enabled && offer !== null,
    retry: 1,
    staleTime: 30_000,
    queryFn: () => venueOfferGuestService.availability({ offeringId, from, to }),
  });
  const optionIds = useMemo(() => (offer?.options ?? []).map((o) => o.id), [offer]);
  const perOptionQuery = useQuery({
    queryKey: ["venue-offer", "days-per-option", offeringId, from, optionIds.join(",")],
    enabled: enabled && offer !== null && optionIds.length > 0,
    retry: 1,
    staleTime: 30_000,
    queryFn: async (): Promise<Array<[string, EntryDayRow[]]>> =>
      Promise.all(
        optionIds.map(async (id): Promise<[string, EntryDayRow[]]> => [
          id,
          await venueOfferGuestService.availability({ offeringId, from, to, priceOptionId: id }),
        ]),
      ),
  });
  const perOption = useMemo(
    () => new Map<string, EntryDayRow[]>(perOptionQuery.data ?? []),
    [perOptionQuery.data],
  );

  const rows = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);
  const [selectedDate, setSelectedDate] = useState<string | null>(input.initialDate ?? null);
  const [counts, setCounts] = useState<Record<string, number>>(() => ({ ...(input.initialCounts ?? {}) }));

  // The tiles: a day the guest picked outside today's strip still shows.
  const tiles = useMemo(() => entryDayTiles(rows, from, ENTRY_STRIP_DAYS), [rows, from]);

  // First open day when nothing (or a past day) is chosen.
  useEffect(() => {
    if (!daysQuery.isSuccess) return;
    if (selectedDate !== null && tiles.some((t) => t.date === selectedDate)) return;
    const firstOpen = tiles.find((t) => t.soldOnline)?.date ?? tiles[0]?.date ?? null;
    setSelectedDate(firstOpen);
  }, [daysQuery.isSuccess, selectedDate, tiles]);

  const dayTile = useMemo(
    () => tiles.find((t) => t.date === selectedDate) ?? null,
    [tiles, selectedDate],
  );
  // #4490 fix 2 (N85): a day with several windows is sold by session. The
  // guest picks a time chip; the quote, the places-left check and the
  // checkout use that session's window.
  const [pickedWindowId, setPickedWindowId] = useState<string | null>(input.initialWindowId ?? null);
  const allSessions = useMemo(
    () => entrySessionsFor(rows, selectedDate, offer?.venue.timezone ?? null),
    [rows, selectedDate, offer?.venue.timezone],
  );
  const sessions = allSessions.length > 1 || offer?.entryStyle === "timed_session" ? allSessions : [];
  const selectedSession = sessions.length > 0 ? pickEntrySession(sessions, pickedWindowId) : null;
  const selectedTile = useMemo((): EntryDayTile | null => {
    if (dayTile === null || sessions.length === 0) return dayTile;
    const sessionRow = rows.find((r) => r.windowId === selectedSession?.windowId) ?? dayTile.row;
    return { ...dayTile, row: sessionRow };
  }, [dayTile, sessions.length, rows, selectedSession?.windowId]);
  const optionRows = useMemo(
    // #4490 06-W4 fix 1 (W4-N1): priced for the chosen session's window.
    () => entryOptionRows(offer?.options ?? [], selectedDate, perOption, selectedTile?.row?.windowId ?? null),
    [offer, selectedDate, perOption, selectedTile?.row?.windowId],
  );

  // A first visit with nothing chosen starts with one guest on the first price.
  const seeded = useRef(input.initialCounts != null && Object.keys(input.initialCounts).length > 0);
  useEffect(() => {
    if (seeded.current || optionRows.length === 0 || !perOptionQuery.isSuccess) return;
    const first = optionRows.find((row) => row.usable);
    if (first === undefined) return;
    seeded.current = true;
    setCounts({ [first.option.id]: first.option.guestMin });
  }, [optionRows, perOptionQuery.isSuccess]);

  // Changing the day drops prices that do not apply that day.
  const lastDate = useRef<string | null>(selectedDate);
  useEffect(() => {
    if (lastDate.current === selectedDate || !perOptionQuery.isSuccess) return;
    lastDate.current = selectedDate;
    setCounts((current) => countsForDay(optionRows, current));
  }, [selectedDate, optionRows, perOptionQuery.isSuccess]);

  const guests = totalGuests(counts);
  const problem =
    daysQuery.isSuccess && perOptionQuery.isSuccess ? entrySelectionProblem(selectedTile, counts) : null;

  // ── the live quote ──────────────────────────────────────────────────────
  const [quote, setQuote] = useState<EntryQuoteState>({ status: "idle" });
  const [quoteNonce, setQuoteNonce] = useState(0);
  const lines = useMemo(() => quoteLinesFor(optionRows, counts), [optionRows, counts]);
  const windowId = selectedTile?.row?.windowId ?? null;
  const membership = input.membership ?? null;
  const [member, setMember] = useState<MemberQuoteBlock | null>(null);
  const quoteKey = `${windowId ?? ""}|${JSON.stringify(lines)}|${quoteNonce}|${membership?.subscriptionId ?? ""}`;
  const latest = useRef(quoteKey);
  latest.current = quoteKey;

  const askQuote = async (): Promise<EntryQuote | null> => {
    if (!enabled || problem !== null || windowId === null || lines.length === 0) {
      setQuote({ status: "idle" });
      return null;
    }
    const asked = latest.current;
    setQuote({ status: "loading" });
    try {
      if (membership !== null) {
        const priced = await venueOfferGuestService.memberQuote({
          offeringId,
          windowId,
          lines,
          cartKey,
          idempotencyKey: `venue-offer:quote:${randomId()}`,
          membership,
        });
        if (latest.current === asked) {
          setQuote({ status: "ready", quote: priced.quote });
          setMember(parseMemberQuote(priced.raw));
        }
        return priced.quote;
      }
      const next = await venueOfferGuestService.quote({
        offeringId,
        windowId,
        lines,
        cartKey,
        idempotencyKey: `venue-offer:quote:${randomId()}`,
      });
      if (latest.current === asked) {
        setQuote({ status: "ready", quote: next });
        setMember(null);
      }
      return next;
    } catch (caught) {
      const error =
        caught instanceof VenueOfferGuestError ? caught : new VenueOfferGuestError("offer_request_failed", null);
      if (latest.current === asked) {
        setQuote({ status: "error", code: error.code, remaining: error.remaining });
      }
      return null;
    }
  };

  useEffect(() => {
    if (!enabled || problem !== null || windowId === null || lines.length === 0) {
      setQuote({ status: "idle" });
      return undefined;
    }
    setQuote({ status: "loading" });
    const timer = setTimeout(() => {
      void askQuote();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, problem, enabled]);

  return {
    offer,
    offerState: offerQuery.isLoading ? "loading" : offerQuery.isError || offer === null ? "error" : "ready",
    offerError:
      offerQuery.error instanceof VenueOfferGuestError
        ? offerQuery.error.code
        : offerQuery.isError
          ? "offer_request_failed"
          : null,
    retryOffer: () => void offerQuery.refetch(),
    daysState:
      daysQuery.isLoading || perOptionQuery.isLoading || offer === null
        ? "loading"
        : daysQuery.isError || perOptionQuery.isError
          ? "error"
          : "ready",
    retryDays: () => {
      void daysQuery.refetch();
      void perOptionQuery.refetch();
    },
    tiles,
    selectedDate,
    selectedTile,
    selectDate: setSelectedDate,
    sessions,
    selectedSession,
    selectSession: setPickedWindowId,
    nextOpen: selectedDate === null ? null : nextOpenDate(rows, selectedDate),
    optionRows,
    counts,
    setCount: (optionId, next) => setCounts((current) => ({ ...current, [optionId]: Math.max(0, next) })),
    guests,
    problem,
    quote,
    retryQuote: () => setQuoteNonce((n) => n + 1),
    refreshQuote: askQuote,
    member: membership !== null ? member : null,
  };
}
