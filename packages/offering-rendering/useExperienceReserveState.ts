// issue #4420 — the React state both experience pickers share (the Reserve
// sheet and the inline "Book a time" picker). Every rule lives in the pure
// experienceReserveModel.ts; this hook only holds the choices, derives the
// time grid / caps / total, and fetches live per-start spots through a
// fetcher the APP injects (the package never imports a data client,
// I-MOR-0827-PACKAGE-ISOLATION).

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExperienceOfferingTicket } from "./experienceOfferingTypes";
import {
  experienceBlockChoicesThatFit,
  experienceTimeChoices,
} from "./experienceTimeZone";
import {
  EXPERIENCE_DEFAULT_PARTY,
  buildExperienceReserveSelection,
  experienceActiveUnitCents,
  experienceNoticeOrDefault,
  experienceOptionShape,
  experiencePartyMax,
  experienceReserveTotal,
  experienceSpacingOrDefault,
  slotRemainingByWallMinute,
  type ExperienceReserveDate,
  type ExperienceReserveMode,
  type ExperienceReserveSelection,
} from "./experienceReserveModel";

/** Live spots per start time, fetched by the app (null = unknown). */
export type ExperienceSlotFetcher = (args: {
  eventId: string;
  eventDateId: string;
  ticketTypeId: string | null;
}) => Promise<ReadonlyArray<{ startAt: string; remaining: number | null }> | null>;

export interface UseExperienceReserveStateArgs {
  mode: ExperienceReserveMode;
  dates: ReadonlyArray<ExperienceReserveDate>;
  timezone: string;
  eventRemaining: number | null;
  unitAllInCents?: number | null;
  currency?: string | null;
  options?: ReadonlyArray<ExperienceOfferingTicket>;
  spacingMinutes?: number | null;
  minNoticeMinutes?: number | null;
  eventId?: string | null;
  capacityScope?: "total" | "per_day" | "per_start" | null;
  fetchSlotAvailability?: ExperienceSlotFetcher;
  /**
   * When the live spots should be fetched for the chosen date. The sheet
   * fetches on its time and party steps; the inline picker as soon as a date
   * is chosen. false clears them.
   */
  slotFetchEnabled: boolean;
}

export interface ExperienceReserveState {
  optionList: ReadonlyArray<ExperienceOfferingTicket>;
  selectedOption: ExperienceOfferingTicket | null;
  selectedDateId: string | null;
  selectedDate: ExperienceReserveDate | null;
  selectedMinute: number | null;
  selectedBlocks: number | null;
  party: number;
  spacingMinutes: number;
  timeChoices: number[];
  slotRemainingByMinute: Map<number, number | null>;
  isBlockOption: boolean;
  isGroupOption: boolean;
  blockMinutes: number;
  blockChoices: number[];
  partyMax: number;
  activeUnitCents: number | null;
  /** The formatted all-in total of the current pick, or null (unknown price). */
  total: string | null;
  canConfirm: boolean;
  /** The checkout hand-off for the current pick, or null when incomplete. */
  selection: ExperienceReserveSelection | null;
  selectOption: (ticketTypeId: string) => void;
  /** Choose an occurrence (null clears the date, time and length). */
  selectDate: (dateId: string | null) => void;
  selectMinute: (minute: number | null) => void;
  selectBlocks: (blocks: number) => void;
  setParty: (next: number | ((prev: number) => number)) => void;
  /** Back to a clean pick (default option, no date, party 2). */
  reset: () => void;
}

export function useExperienceReserveState(
  args: UseExperienceReserveStateArgs,
): ExperienceReserveState {
  const {
    mode,
    dates,
    timezone,
    eventRemaining,
    unitAllInCents = null,
    currency = null,
    options,
    eventId = null,
    capacityScope = null,
    fetchSlotAvailability,
    slotFetchEnabled,
  } = args;
  const optionList = useMemo(
    () => (Array.isArray(options) ? options : []),
    [options],
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(
    () => optionList[0]?.ticketTypeId ?? null,
  );
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<number | null>(null);
  const [party, setPartyState] = useState<number>(EXPERIENCE_DEFAULT_PARTY);

  const reset = useCallback((): void => {
    setSelectedOptionId(optionList[0]?.ticketTypeId ?? null);
    setSelectedDateId(null);
    setSelectedMinute(null);
    setSelectedBlocks(null);
    setPartyState(EXPERIENCE_DEFAULT_PARTY);
  }, [optionList]);

  const selectedOption = useMemo(() => {
    if (optionList.length === 0) return null;
    return (
      optionList.find((o) => o.ticketTypeId === selectedOptionId) ??
      optionList[0] ??
      null
    );
  }, [optionList, selectedOptionId]);

  const selectedDate = useMemo(
    () => dates.find((d) => d.id === selectedDateId) ?? null,
    [dates, selectedDateId],
  );

  const spacingMinutes = experienceSpacingOrDefault(args.spacingMinutes);
  const noticeMinutes = experienceNoticeOrDefault(args.minNoticeMinutes);
  const timeChoices = useMemo<number[]>(() => {
    if (mode !== "open-daily" || selectedDate === null) return [];
    const nowMs = Date.now() + noticeMinutes * 60_000;
    return experienceTimeChoices(
      selectedDate.startAt,
      selectedDate.endAt,
      timezone,
      spacingMinutes,
      nowMs,
    );
  }, [mode, selectedDate, timezone, spacingMinutes, noticeMinutes]);

  // issue #3281 R3 — per-start (and per-day) remaining from the slot RPC.
  const [slotRemainingByMinute, setSlotRemainingByMinute] = useState<
    Map<number, number | null>
  >(() => new Map());
  const optionTicketTypeId = selectedOption?.ticketTypeId ?? null;
  useEffect(() => {
    if (
      !slotFetchEnabled ||
      mode !== "open-daily" ||
      selectedDate === null ||
      fetchSlotAvailability === undefined ||
      typeof eventId !== "string" ||
      eventId.length === 0 ||
      (capacityScope !== "per_start" && capacityScope !== "per_day")
    ) {
      setSlotRemainingByMinute(new Map());
      return undefined;
    }
    let cancelled = false;
    void fetchSlotAvailability({
      eventId,
      eventDateId: selectedDate.id,
      ticketTypeId: optionTicketTypeId,
    })
      .then((slots) => {
        if (cancelled || slots === null) return;
        setSlotRemainingByMinute(slotRemainingByWallMinute(slots, timezone));
      })
      .catch(() => {
        // Unknown spots stay unknown: no "N left" is shown, the server
        // still enforces capacity at checkout.
      });
    return () => {
      cancelled = true;
    };
  }, [
    slotFetchEnabled,
    mode,
    selectedDate,
    fetchSlotAvailability,
    eventId,
    capacityScope,
    optionTicketTypeId,
    timezone,
  ]);

  const shape = experienceOptionShape(selectedOption);
  const blockChoices = useMemo<number[]>(() => {
    if (
      !shape.isBlock ||
      mode !== "open-daily" ||
      selectedDate === null ||
      selectedMinute === null
    ) {
      return [];
    }
    return experienceBlockChoicesThatFit(
      selectedDate.startAt,
      selectedDate.endAt,
      timezone,
      selectedMinute,
      shape.blockMinutes,
      shape.minBlocks,
      shape.maxBlocks,
      spacingMinutes,
    );
  }, [
    shape.isBlock,
    shape.blockMinutes,
    shape.minBlocks,
    shape.maxBlocks,
    mode,
    selectedDate,
    selectedMinute,
    timezone,
    spacingMinutes,
  ]);

  useEffect(() => {
    if (selectedMinute === null || !shape.isBlock || blockChoices.length === 0) {
      setSelectedBlocks(null);
      return;
    }
    setSelectedBlocks((prev) =>
      prev !== null && blockChoices.includes(prev) ? prev : blockChoices[0],
    );
  }, [selectedMinute, shape.isBlock, blockChoices]);

  const slotRemainingForSelection =
    selectedMinute !== null && slotRemainingByMinute.has(selectedMinute)
      ? slotRemainingByMinute.get(selectedMinute) ?? null
      : null;
  const partyMax = experiencePartyMax({
    option: selectedOption,
    eventRemaining,
    slotRemaining: slotRemainingForSelection,
  });

  useEffect(() => {
    setPartyState((p) => Math.min(Math.max(1, p), partyMax));
  }, [partyMax]);

  const activeUnitCents = experienceActiveUnitCents(selectedOption, unitAllInCents);
  const total = experienceReserveTotal({
    unitCents: activeUnitCents,
    currency: selectedOption?.currency ?? currency,
    isBlock: shape.isBlock,
    isGroup: shape.isGroup,
    blocks: selectedBlocks,
    party,
  });

  const selection = useMemo(
    () =>
      buildExperienceReserveSelection({
        mode,
        date: selectedDate,
        timezone,
        spacingMinutes,
        minute: selectedMinute,
        blocks: selectedBlocks,
        party,
        option: selectedOption,
      }),
    [
      mode,
      selectedDate,
      timezone,
      spacingMinutes,
      selectedMinute,
      selectedBlocks,
      party,
      selectedOption,
    ],
  );

  const canConfirm =
    mode === "slots"
      ? selectedDate !== null &&
        (selectedDate.ticketsRemaining === null || selectedDate.ticketsRemaining > 0)
      : selectedDate !== null &&
        selectedMinute !== null &&
        (!shape.isBlock || selectedBlocks !== null);

  const selectOption = useCallback((ticketTypeId: string): void => {
    setSelectedOptionId(ticketTypeId);
    setSelectedMinute(null);
    setSelectedBlocks(null);
    setPartyState(EXPERIENCE_DEFAULT_PARTY);
  }, []);
  const selectDate = useCallback((dateId: string | null): void => {
    setSelectedDateId(dateId);
    setSelectedMinute(null);
    setSelectedBlocks(null);
  }, []);
  const selectMinute = useCallback((minute: number | null): void => {
    setSelectedMinute(minute);
  }, []);
  const selectBlocks = useCallback((blocks: number): void => {
    setSelectedBlocks(blocks);
  }, []);
  const setParty = useCallback(
    (next: number | ((prev: number) => number)): void => {
      setPartyState((prev) => {
        const raw = typeof next === "function" ? next(prev) : next;
        return Math.min(Math.max(1, raw), partyMax);
      });
    },
    [partyMax],
  );

  return {
    optionList,
    selectedOption,
    selectedDateId,
    selectedDate,
    selectedMinute,
    selectedBlocks,
    party,
    spacingMinutes,
    timeChoices,
    slotRemainingByMinute,
    isBlockOption: shape.isBlock,
    isGroupOption: shape.isGroup,
    blockMinutes: shape.blockMinutes,
    blockChoices,
    partyMax,
    activeUnitCents,
    total,
    canConfirm,
    selection,
    selectOption,
    selectDate,
    selectMinute,
    selectBlocks,
    setParty,
    reset,
  };
}
