/**
 * #4490 Explorer W4 — the checkout sheet's choose step, one body per kind
 * (spec 06 W4 "Steps per kind"):
 *
 *   Entry         date chips [availability] → session chips with places left
 *                 (timed entry) → price-option steppers (multi-day passes say
 *                 their rule)
 *   Group package date [availability] → start time → package option → guests
 *                 (bounded by the option's server min and max) → extras → answers
 *   Private hire  date → session [availability] → space [hire_options] →
 *                 layout (when the offer lists layouts) → guests → extras →
 *                 occasion and a note
 *   By the hour   day [hour_day] → start chips → length chips
 *   Plan          plan → start date
 *
 * Every option, place and "left" number is the server's. #4490 06-W4 fix 1
 * (W4-N1): a price next to an option is the server's price for the chosen
 * day and session (each option's own `availability` read: the quote's
 * resolver `issue_4490_option_price_at`, busy-time rules applied), never the
 * list price; before a day is chosen, or while those prices load, a row shows
 * no amount. Hire rows are `hire_options` for the chosen session; extras are
 * the offer's own fixed amounts (the quote charges exactly those). The total
 * is ONLY the quote (Review). Each body reports its choice (or null) and the
 * first thing still missing, in words, to the sheet.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { VenueFeaturePlanView } from "@mingla/brand-rendering/venueFeaturePage";
import {
  addDays,
  entryDateLabel,
  entryDayNotice,
  entryDayTiles,
  entryOptionName,
  entryOptionRows,
  entrySelectionProblem,
  optionUnavailableLine,
  entrySessionsFor,
  parseEntryDayRows,
  pickEntrySession,
  quoteLinesFor,
  stepCount,
  venueClock,
  venueToday,
  type EntryCounts,
  type EntryDayRow,
  type EntryOfferDetail,
  type EntryOptionRow,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  answersPayload,
  missingAnswer,
  packageDayNotice,
  packageDayTiles,
  startChipsFor,
  type PackageOfferDetail,
} from "@mingla/brand-rendering/venueOffers/packageModel";
import {
  hireDayTiles,
  hireGuestRange,
  hourLengthsFor,
  hourLengthWords,
  OCCASIONS,
  parseHireDayRows,
  parseHireHourDay,
  parseHirePlaces,
  placeFitsLine,
  placeListFor,
  sessionChipsFor,
  type HireOfferDetail,
} from "@mingla/brand-rendering/venueOffers/hireModel";
import { venueLayoutLabel, type VenueLayout } from "@mingla/brand-rendering/venueOffers/layoutModel";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";
import { venueOfferCheckoutService } from "../../services/venueOfferCheckoutService";
import { VenuePurchaseError } from "../../services/venuePurchaseService";
import { PURCHASE_SHEET_COLORS as C } from "../purchases/purchaseSheetTheme";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { VenueCheckoutWhenLine } from "./VenueCheckoutWhenLine";
import type { VenueCheckoutChoice } from "./venueCheckoutModel";

/** One factory for the sheet's reads (Constitution rule 4); never persisted (queryPersistence). */
export const venueOfferCheckoutKeys = {
  all: ["venueOfferCheckout"] as const,
  offer: (offeringId: string) => [...venueOfferCheckoutKeys.all, "offer", offeringId] as const,
  days: (offeringId: string, from: string, to: string) => [...venueOfferCheckoutKeys.all, "days", offeringId, from, to] as const,
  /** #4490 06-W4 fix 1: each price option's own days (its price per window). */
  optionDays: (offeringId: string, from: string, to: string, optionIds: string) =>
    [...venueOfferCheckoutKeys.all, "optionDays", offeringId, from, to, optionIds] as const,
  hirePlaces: (offeringId: string, windowId: string, guests: number) =>
    [...venueOfferCheckoutKeys.all, "hirePlaces", offeringId, windowId, guests] as const,
  hourDay: (offeringId: string, date: string) => [...venueOfferCheckoutKeys.all, "hourDay", offeringId, date] as const,
};

/** How far ahead the date chips look (the panes' own window). */
export const CHECKOUT_DAYS = 14;

export interface ChooseReport {
  choice: VenueCheckoutChoice | null;
  /** The first thing still missing, in words; null when the choice is complete. */
  problem: string | null;
}

interface WhenLineVenue {
  lat: number | null;
  lng: number | null;
  category: string | null;
}

const readRetry = (count: number, error: unknown): boolean =>
  count < 1 && !(error instanceof VenuePurchaseError && (error.code === "offline" || error.code === "venue_unreachable"));

const readFailureLine = (error: unknown): string =>
  error instanceof VenuePurchaseError && error.code === "offline"
    ? "You're offline. Check your connection and try again."
    : "Something went wrong. Try again.";

// ─── shared pieces ────────────────────────────────────────────────────────

export function Label({ children }: { children: string }): React.ReactElement {
  return <Text style={styles.label}>{children}</Text>;
}

export function Chip({
  title,
  note,
  selected,
  disabled,
  onPress,
  accessibilityLabel,
  testID,
}: {
  title: string;
  note?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, note].filter(Boolean).join(", ")}
      accessibilityState={{ selected, disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipOn,
        disabled === true && styles.chipOff,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Text style={[styles.chipTitle, selected && styles.chipTitleOn, disabled === true && styles.struck]}>{title}</Text>
      {note ? <Text style={[styles.chipNote, selected && styles.chipTitleOn]}>{note}</Text> : null}
    </Pressable>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  name,
  testID,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  name: string;
  testID: string;
}): React.ReactElement {
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={name}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment" && value < max) onChange(value + 1);
        if (e.nativeEvent.actionName === "decrement" && value > min) onChange(value - 1);
      }}
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fewer, ${name}`}
        disabled={value <= min}
        onPress={() => onChange(value - 1)}
        style={({ pressed }) => [styles.stepBtn, value <= min && styles.chipOff, pressed && styles.pressed]}
        testID={`${testID}-minus`}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More, ${name}`}
        disabled={value >= max}
        onPress={() => onChange(value + 1)}
        style={({ pressed }) => [styles.stepBtn, value >= max && styles.chipOff, pressed && styles.pressed]}
        testID={`${testID}-plus`}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

function RadioRow({
  title,
  line,
  selected,
  disabled,
  onPress,
  testID,
}: {
  title: string;
  line: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[title, line].filter(Boolean).join(", ")}
      accessibilityState={{ selected, disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.item, selected && styles.chipOn, disabled === true && styles.chipOff, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={styles.itemText}>
        <Text style={styles.itemName}>{title}</Text>
        {line !== null ? <Text style={styles.itemLine}>{line}</Text> : null}
      </View>
    </Pressable>
  );
}

function Toggle({ title, line, on, onPress, testID }: { title: string; line: string | null; on: boolean; onPress: () => void; testID: string }): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={[title, line].filter(Boolean).join(", ")}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, on && styles.chipOn, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={[styles.box, on && styles.radioOn]} />
      <Text style={[styles.itemName, styles.itemText]}>{title}</Text>
      {line !== null ? <Text style={styles.itemLine}>{line}</Text> : null}
    </Pressable>
  );
}

export function Notice({ text, tone = "warn", testID }: { text: string; tone?: "warn" | "error" | "info"; testID?: string }): React.ReactElement {
  return (
    <View
      style={[styles.notice, tone === "error" ? styles.noticeError : tone === "info" ? styles.noticeInfo : styles.noticeWarn]}
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === "error" ? "alert" : undefined}
      testID={testID}
    >
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function ReadState({ loading, error, onRetry, testID }: { loading: boolean; error: unknown; onRetry: () => void; testID: string }): React.ReactElement | null {
  if (loading) {
    return (
      <View style={styles.readState} testID={`${testID}-loading`}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  if (error === null || error === undefined) return null;
  return (
    <View style={styles.readState} testID={`${testID}-error`}>
      <Text style={styles.itemLine}>{readFailureLine(error)}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]} testID={`${testID}-retry`}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function useDays(offeringId: string, from: string): {
  raw: unknown;
  loading: boolean;
  error: unknown;
  retry: () => void;
} {
  const to = addDays(from, CHECKOUT_DAYS - 1);
  const q = useQuery({
    queryKey: venueOfferCheckoutKeys.days(offeringId, from, to),
    queryFn: () => venueOfferCheckoutService.availability({ offeringId, from, to }),
    staleTime: 30_000,
    retry: readRetry,
  });
  return { raw: q.data ?? null, loading: q.isLoading, error: q.error, retry: () => void q.refetch() };
}

/**
 * #4490 06-W4 fix 1 (W4-N1) — each price option's own days, as buyer web reads
 * them (`useEntrySelection`): one `availability` read per option, whose rows
 * carry that option's price for each window (busy-time rules applied by the
 * server, the same resolver the quote charges with).
 */
function useOptionDays(
  offeringId: string,
  from: string,
  optionIds: readonly string[],
): { byOption: ReadonlyMap<string, readonly EntryDayRow[]>; loading: boolean; error: unknown; retry: () => void } {
  const to = addDays(from, CHECKOUT_DAYS - 1);
  const ids = optionIds.join(",");
  const q = useQuery({
    queryKey: venueOfferCheckoutKeys.optionDays(offeringId, from, to, ids),
    queryFn: async (): Promise<[string, EntryDayRow[]][]> =>
      Promise.all(
        optionIds.map(async (id): Promise<[string, EntryDayRow[]]> => [
          id,
          parseEntryDayRows(await venueOfferCheckoutService.availability({ offeringId, from, to, priceOptionId: id })),
        ]),
      ),
    enabled: optionIds.length > 0,
    staleTime: 30_000,
    retry: readRetry,
  });
  const byOption = useMemo(() => new Map<string, readonly EntryDayRow[]>(q.data ?? []), [q.data]);
  return { byOption, loading: q.isLoading && optionIds.length > 0, error: q.error, retry: () => void q.refetch() };
}

/** The server's price of one option for one window; null while unknown (no amount is shown). */
export function optionPriceAt(
  byOption: ReadonlyMap<string, readonly EntryDayRow[]>,
  optionId: string,
  windowId: string | null,
): number | null {
  if (windowId === null) return null;
  return byOption.get(optionId)?.find((r) => r.windowId === windowId)?.priceMinor ?? null;
}

const dayChipTitle = (date: string, today: string): string => (date === today ? "Today" : entryDateLabel(date).split(" ")[0]);
const dayChipNote = (date: string): string => entryDateLabel(date).split(" ").slice(1).join(" ");

// ─── Entry ────────────────────────────────────────────────────────────────

export function EntryChoose({
  offer,
  today,
  money,
  venue,
  onReport,
  initial = null,
}: {
  offer: EntryOfferDetail;
  today: string;
  money: (minor: number) => string;
  venue: WhenLineVenue;
  onReport: (r: ChooseReport) => void;
  /** #4490 06-W4 fix 1 (W4-N4): the picks kept across a sign-in. */
  initial?: Extract<VenueCheckoutChoice, { kind: "entry" }> | null;
}): React.ReactElement {
  const tz = offer.venue.timezone;
  const days = useDays(offer.id, today);
  const rows = useMemo(() => parseEntryDayRows(days.raw), [days.raw]);
  const tiles = useMemo(() => entryDayTiles(rows, today, CHECKOUT_DAYS), [rows, today]);
  const [date, setDate] = useState<string | null>(initial?.day ?? null);
  const [windowId, setWindowId] = useState<string | null>(initial?.windowId ?? null);
  const [counts, setCounts] = useState<EntryCounts>(() =>
    Object.fromEntries((initial?.lines ?? []).map((l) => [l.priceOptionId, l.guests])),
  );
  useEffect(() => {
    if (date === null && tiles.length > 0) setDate(tiles.find((t) => t.soldOnline)?.date ?? null);
  }, [date, tiles]);
  const tile = tiles.find((t) => t.date === date) ?? null;
  const timed = offer.entryStyle === "timed_session";
  const sessions = useMemo(() => (timed ? entrySessionsFor(rows, date, tz) : []), [date, rows, timed, tz]);
  const session = timed ? pickEntrySession(sessions, windowId) : null;
  const chosenWindow = timed ? session?.windowId ?? null : tile?.row?.windowId ?? null;
  const optionIds = useMemo(() => offer.options.map((o) => o.id), [offer.options]);
  const prices = useOptionDays(offer.id, today, optionIds);
  const optionRows = useMemo(
    () => entryOptionRows(offer.options, date, prices.byOption, chosenWindow),
    [chosenWindow, date, offer.options, prices.byOption],
  );
  const lines = quoteLinesFor(optionRows, counts);
  const problem =
    days.loading || prices.loading
      ? "Checking what's left…"
      : timed && tile !== null && tile.soldOnline && session === null
        ? "Choose a time."
        : entrySelectionProblem(tile, counts);
  const time = timed ? session?.label ?? null : tile?.row?.startsAt ? venueClock(tile.row.startsAt, tz) : null;

  useEffect(() => {
    onReport({
      choice:
        problem === null && chosenWindow !== null && date !== null && lines.length > 0
          ? { kind: "entry", offeringId: offer.id, windowId: chosenWindow, lines, day: date, time }
          : null,
      problem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, chosenWindow, date, JSON.stringify(lines), time]);

  return (
    <View testID="venue-checkout-choose-entry">
      <Label>Date</Label>
      <ReadState loading={days.loading} error={days.error} onRetry={days.retry} testID="venue-checkout-days" />
      <View style={styles.chipRow}>
        {tiles.map((t) => (
          <Chip
            key={t.date}
            title={dayChipTitle(t.date, today)}
            note={t.bottom || dayChipNote(t.date)}
            selected={t.date === date}
            disabled={!t.soldOnline}
            onPress={() => {
              setDate(t.date);
              setWindowId(null);
            }}
            testID={`venue-checkout-day-${t.date}`}
          />
        ))}
      </View>
      {tile !== null && !tile.soldOnline ? <Notice text={entryDayNotice(tile) ?? ""} /> : null}
      {timed && sessions.length > 0 ? (
        <>
          <Label>Time</Label>
          <View style={styles.chipRow}>
            {sessions.map((s) => (
              <Chip
                key={s.windowId}
                title={s.label}
                note={s.usable ? s.note : s.state === "full" ? "Sold out" : s.note}
                selected={s.windowId === session?.windowId}
                disabled={!s.usable}
                onPress={() => setWindowId(s.windowId)}
                accessibilityLabel={s.usable ? `${s.label}, ${s.note}` : `${s.label}, sold out`}
                testID={`venue-checkout-session-${s.windowId}`}
              />
            ))}
          </View>
        </>
      ) : null}
      {date !== null && time !== null ? (
        <VenueCheckoutWhenLine lat={venue.lat} lng={venue.lng} category={venue.category} day={date} time={time} />
      ) : null}
      <Label>Tickets</Label>
      <ReadState loading={false} error={prices.error} onRetry={prices.retry} testID="venue-checkout-option-prices" />
      {optionRows.map((row) => (
        <View key={row.option.id} style={[styles.item, !row.usable && styles.chipOff]} testID={`venue-checkout-option-${row.option.id}`}>
          <View style={styles.itemText}>
            <Text style={styles.itemName}>{entryOptionName(row.option)}</Text>
            {entryRowLine(row, date, money) !== null ? (
              <Text style={styles.itemLine} testID={`venue-checkout-option-price-${row.option.id}`}>
                {entryRowLine(row, date, money)}
              </Text>
            ) : null}
          </View>
          <Stepper
            value={counts[row.option.id] ?? 0}
            min={0}
            max={row.usable ? row.option.guestMax : 0}
            name={entryOptionName(row.option)}
            onChange={(next) => {
              const cur = counts[row.option.id] ?? 0;
              setCounts({ ...counts, [row.option.id]: stepCount(row.option, cur, next > cur ? 1 : -1) });
            }}
            testID={`venue-checkout-count-${row.option.id}`}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * An entry option row's line: the server's price for the chosen day and
 * session ("₦6,000 each"); the server's reason when it is not sold that day;
 * nothing while the day's price is not known yet (never the list price).
 */
export function entryRowLine(
  row: EntryOptionRow,
  date: string | null,
  money: (minor: number) => string,
): string | null {
  if (!row.usable) return date !== null ? optionUnavailableLine(row, date) : row.rule;
  if (!row.dayPriced) return row.rule;
  return [`${money(row.priceMinor)} each`, row.rule].filter(Boolean).join(" · ");
}

// ─── Group package ────────────────────────────────────────────────────────

export function GroupChoose({
  offer,
  today,
  money,
  venue,
  onReport,
  initial = null,
}: {
  offer: PackageOfferDetail;
  today: string;
  money: (minor: number) => string;
  venue: WhenLineVenue;
  onReport: (r: ChooseReport) => void;
  /** #4490 06-W4 fix 1 (W4-N4): the picks kept across a sign-in. */
  initial?: Extract<VenueCheckoutChoice, { kind: "group_package" }> | null;
}): React.ReactElement {
  const tz = offer.venue.timezone;
  const days = useDays(offer.id, today);
  const rows = useMemo(() => parseEntryDayRows(days.raw), [days.raw]);
  const tiles = useMemo(() => packageDayTiles(rows, today, CHECKOUT_DAYS), [rows, today]);
  const [optionId, setOptionId] = useState<string | null>(initial?.priceOptionId ?? offer.options[0]?.id ?? null);
  const option = offer.options.find((o) => o.id === optionId) ?? null;
  const [guests, setGuests] = useState<number>(initial?.guests ?? offer.options[0]?.guestMin ?? 1);
  const [date, setDate] = useState<string | null>(initial?.day ?? null);
  const [windowId, setWindowId] = useState<string | null>(initial?.windowId ?? null);
  const [extras, setExtras] = useState<readonly string[]>(initial?.extraIds ?? []);
  const [answers, setAnswers] = useState<Record<number, number>>(() => {
    const kept: Record<number, number> = {};
    offer.inclusions
      .filter((i) => i.kind === "choice")
      .forEach((c, i) => {
        const j = initial !== null ? c.options.indexOf(initial.answers[c.label] ?? "") : -1;
        if (j >= 0) kept[i] = j;
      });
    return kept;
  });
  useEffect(() => {
    if (date === null && tiles.length > 0) setDate(tiles.find((t) => t.soldOnline)?.date ?? null);
  }, [date, tiles]);
  useEffect(() => {
    if (option !== null) setGuests((g) => Math.min(Math.max(g, option.guestMin), option.guestMax));
  }, [option]);
  const tile = tiles.find((t) => t.date === date) ?? null;
  const starts = useMemo(() => startChipsFor(rows, date, guests, tz), [date, guests, rows, tz]);
  const start = starts.find((s) => s.windowId === windowId && s.usable) ?? starts.find((s) => s.usable) ?? null;
  const missing = missingAnswer(offer, answers);
  const optionIds = useMemo(() => offer.options.map((o) => o.id), [offer.options]);
  const prices = useOptionDays(offer.id, today, optionIds);
  const startWindow = start?.windowId ?? null;
  const problem = days.loading || prices.loading
    ? "Checking what's left…"
    : option === null
      ? "Choose a package."
      : tile === null
        ? "Choose a day."
        : !tile.soldOnline
          ? packageDayNotice(tile, offer.minNoticeMinutes)
          : start === null
            ? "Choose a start time."
            : missing !== null
              ? `Choose an option for "${missing}".`
              : null;

  useEffect(() => {
    onReport({
      choice:
        problem === null && option !== null && start !== null && date !== null
          ? {
              kind: "group_package",
              offeringId: offer.id,
              windowId: start.windowId,
              priceOptionId: option.id,
              guests,
              extraIds: extras,
              answers: answersPayload(offer, answers),
              day: date,
              time: start.time,
            }
          : null,
      problem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, option?.id, start?.windowId, guests, date, extras.join(","), JSON.stringify(answers)]);

  const choices = offer.inclusions.filter((i) => i.kind === "choice");
  return (
    <View testID="venue-checkout-choose-group">
      <Label>Package</Label>
      <ReadState loading={false} error={prices.error} onRetry={prices.retry} testID="venue-checkout-option-prices" />
      {offer.options.map((o) => (
        <RadioRow
          key={o.id}
          title={o.name}
          line={packageRowLine(o, optionPriceAt(prices.byOption, o.id, startWindow), money)}
          selected={o.id === optionId}
          onPress={() => setOptionId(o.id)}
          testID={`venue-checkout-package-${o.id}`}
        />
      ))}
      <Label>Date</Label>
      <ReadState loading={days.loading} error={days.error} onRetry={days.retry} testID="venue-checkout-days" />
      <View style={styles.chipRow}>
        {tiles.map((t) => (
          <Chip
            key={t.date}
            title={dayChipTitle(t.date, today)}
            note={t.bottom || dayChipNote(t.date)}
            selected={t.date === date}
            disabled={!t.soldOnline}
            onPress={() => {
              setDate(t.date);
              setWindowId(null);
            }}
            testID={`venue-checkout-day-${t.date}`}
          />
        ))}
      </View>
      {tile !== null && !tile.soldOnline ? <Notice text={packageDayNotice(tile, offer.minNoticeMinutes) ?? ""} /> : null}
      {starts.length > 0 ? (
        <>
          <Label>Start</Label>
          <View style={styles.chipRow}>
            {starts.map((s) => (
              <Chip
                key={s.windowId}
                title={s.time}
                note={s.note}
                selected={s.windowId === start?.windowId}
                disabled={!s.usable}
                onPress={() => setWindowId(s.windowId)}
                testID={`venue-checkout-start-${s.windowId}`}
              />
            ))}
          </View>
        </>
      ) : null}
      {date !== null && start !== null ? (
        <VenueCheckoutWhenLine lat={venue.lat} lng={venue.lng} category={venue.category} day={date} time={start.time} />
      ) : null}
      {option !== null ? (
        <>
          <Label>Guests</Label>
          <Stepper value={guests} min={option.guestMin} max={option.guestMax} onChange={setGuests} name="Guests" testID="venue-checkout-guests" />
          <Text style={styles.itemLine}>{`${option.guestMin} to ${option.guestMax} guests for this package.`}</Text>
        </>
      ) : null}
      {offer.extras.length > 0 ? <Label>Extras</Label> : null}
      {offer.extras.map((x) => (
        <Toggle
          key={x.id}
          title={x.name}
          line={extraRowLine(x, money)}
          on={extras.includes(x.id)}
          onPress={() => setExtras(extras.includes(x.id) ? extras.filter((id) => id !== x.id) : [...extras, x.id])}
          testID={`venue-checkout-extra-${x.id}`}
        />
      ))}
      {choices.map((c, i) => (
        <View key={c.label}>
          <Label>{c.label}</Label>
          <View style={styles.chipRow}>
            {c.options.map((label, j) => (
              <Chip
                key={label}
                title={label}
                selected={answers[i] === j}
                onPress={() => setAnswers({ ...answers, [i]: j })}
                testID={`venue-checkout-answer-${i}-${j}`}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A package row: the server's price for the chosen start ("₦10,000 a guest ·
 * 10 to 20 guests"), or only the guest range while no start is chosen or its
 * price is loading (never the list price).
 */
export function packageRowLine(
  o: { unit?: "guest" | "booking"; guestMin: number; guestMax: number },
  priceMinor: number | null,
  money: (minor: number) => string,
): string {
  const range = `${o.guestMin} to ${o.guestMax} guests`;
  return priceMinor === null ? range : `${money(priceMinor)} ${o.unit === "booking" ? "for the group" : "a guest"} · ${range}`;
}

/** An extra's line, in the buyer-web words (`ExtrasList`): its fixed amount per booking or per guest. */
export const extraRowLine = (x: { priceMinor: number; per: string }, money: (minor: number) => string): string =>
  `${money(x.priceMinor)} ${x.per === "guest" ? "a guest" : "a booking"}`;

/** A hire place's line, in the buyer-web words (`HireForm`): its `hire_options` price for the chosen session, per its unit. */
export function hirePlaceLine(
  p: { unit?: string | null; priceMinor: number },
  fits: string,
  money: (minor: number) => string,
): string {
  const price = p.unit === "guest" ? `${money(p.priceMinor)} a guest` : p.unit === "hour" ? `${money(p.priceMinor)} an hour` : money(p.priceMinor);
  return `${fits} · ${price}`;
}

// ─── Private hire ─────────────────────────────────────────────────────────

export function HireChoose({
  offer,
  today,
  money,
  onReport,
  initial = null,
}: {
  offer: HireOfferDetail;
  today: string;
  money: (minor: number) => string;
  onReport: (r: ChooseReport) => void;
  /** #4490 06-W4 fix 1 (W4-N4): the picks kept across a sign-in. */
  initial?: Extract<VenueCheckoutChoice, { kind: "private_hire" }> | null;
}): React.ReactElement {
  const tz = offer.venue.timezone;
  const days = useDays(offer.id, today);
  const rows = useMemo(() => parseHireDayRows(days.raw), [days.raw]);
  const tiles = useMemo(() => hireDayTiles(rows, today, CHECKOUT_DAYS), [rows, today]);
  const range = useMemo(() => hireGuestRange(offer), [offer]);
  const [date, setDate] = useState<string | null>(initial?.day ?? null);
  const [windowId, setWindowId] = useState<string | null>(initial?.windowId ?? null);
  const [guests, setGuests] = useState<number>(initial?.guests ?? range.min);
  const [placeId, setPlaceId] = useState<string | null>(initial?.priceOptionId ?? null);
  const [layout, setLayout] = useState<VenueLayout | null>((initial?.layout as VenueLayout | null | undefined) ?? null);
  const [extras, setExtras] = useState<readonly string[]>(initial?.extraIds ?? []);
  const [occasion, setOccasion] = useState<string | null>(
    typeof initial?.answers.occasion === "string" ? initial.answers.occasion : null,
  );
  const [note, setNote] = useState(typeof initial?.answers.note === "string" ? initial.answers.note : "");
  useEffect(() => {
    if (date === null && tiles.length > 0) setDate(tiles.find((t) => t.state === "free")?.date ?? null);
  }, [date, tiles]);
  const sessions = useMemo(() => sessionChipsFor(rows, date, offer.sessions, tz, true), [date, offer.sessions, rows, tz]);
  const session = sessions.find((s) => s.windowId === windowId && s.usable) ?? sessions.find((s) => s.usable && s.note === null) ?? null;
  const places = useQuery({
    queryKey: venueOfferCheckoutKeys.hirePlaces(offer.id, session?.windowId ?? "", guests),
    queryFn: () => venueOfferCheckoutService.hireOptions({ offeringId: offer.id, windowId: session?.windowId as string, guests }),
    enabled: session !== null,
    staleTime: 30_000,
    retry: readRetry,
  });
  const placeList = useMemo(() => placeListFor(parseHirePlaces(places.data ?? null), guests), [guests, places.data]);
  const place = placeList.shown.find((p) => p.priceOptionId === placeId && p.status === "available") ?? null;
  const row = offer.rows.find((r) => r.optionId === place?.priceOptionId) ?? null;
  const layouts = useMemo(
    () => offer.layouts.filter((key) => row?.layoutCapacities[key] !== undefined),
    [offer.layouts, row],
  );
  useEffect(() => {
    // The spaces are still loading: keep a layout kept across a sign-in until they are known.
    if (places.isLoading) return;
    if (layout !== null && layouts.includes(layout)) return;
    setLayout(layouts.length === 1 ? layouts[0] : null);
  }, [layout, layouts, places.isLoading]);
  const answers = useMemo((): Record<string, string | boolean> => {
    const out: Record<string, string | boolean> = {};
    if (occasion !== null) out.occasion = occasion;
    if (note.trim().length > 0) out.note = note.trim().slice(0, 500);
    return out;
  }, [note, occasion]);
  const problem = days.loading
    ? "Checking what's free…"
    : date === null
      ? "Choose a day."
      : session === null
        ? "Choose a time."
        : places.isLoading
          ? "Checking the spaces…"
          : place === null
            ? "Choose a space."
            : layouts.length > 0 && layout === null
              ? "Choose a layout."
              : null;

  useEffect(() => {
    onReport({
      choice:
        problem === null && session !== null && place !== null && date !== null
          ? {
              kind: "private_hire",
              offeringId: offer.id,
              windowId: session.windowId,
              priceOptionId: place.priceOptionId,
              guests,
              layout,
              extraIds: extras,
              answers,
              day: date,
            }
          : null,
      problem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, session?.windowId, place?.priceOptionId, guests, layout, date, extras.join(","), JSON.stringify(answers)]);

  return (
    <View testID="venue-checkout-choose-hire">
      <Label>Date</Label>
      <ReadState loading={days.loading} error={days.error} onRetry={days.retry} testID="venue-checkout-days" />
      <View style={styles.chipRow}>
        {tiles.map((t) => (
          <Chip
            key={t.date}
            title={dayChipTitle(t.date, today)}
            note={t.word || dayChipNote(t.date)}
            selected={t.date === date}
            disabled={t.state !== "free"}
            onPress={() => {
              setDate(t.date);
              setWindowId(null);
              setPlaceId(null);
            }}
            testID={`venue-checkout-day-${t.date}`}
          />
        ))}
      </View>
      {sessions.length > 0 ? (
        <>
          <Label>Time</Label>
          <View style={styles.chipRow}>
            {sessions.map((s) => (
              <Chip
                key={s.windowId}
                title={s.label}
                note={s.note ?? s.times}
                selected={s.windowId === session?.windowId}
                disabled={!s.usable}
                onPress={() => {
                  setWindowId(s.windowId);
                  setPlaceId(null);
                }}
                testID={`venue-checkout-hire-session-${s.windowId}`}
              />
            ))}
          </View>
        </>
      ) : null}
      <Label>Guests</Label>
      <Stepper value={guests} min={range.min} max={range.max} onChange={setGuests} name="Guests" testID="venue-checkout-guests" />
      {session !== null ? (
        <>
          <Label>Space</Label>
          <ReadState loading={places.isLoading} error={places.error} onRetry={() => void places.refetch()} testID="venue-checkout-places" />
          {placeList.shown.map((p) => (
            <RadioRow
              key={p.priceOptionId}
              title={p.placeName}
              line={
                p.status === "available"
                  ? hirePlaceLine(p, placeFitsLine(p), money)
                  : p.status === "held"
                    ? "On hold"
                    : "Taken"
              }
              selected={p.priceOptionId === place?.priceOptionId}
              disabled={p.status !== "available"}
              onPress={() => setPlaceId(p.priceOptionId)}
              testID={`venue-checkout-place-${p.priceOptionId}`}
            />
          ))}
          {placeList.hiddenLine !== null ? <Text style={styles.itemLine}>{placeList.hiddenLine}</Text> : null}
        </>
      ) : null}
      {layouts.length > 0 ? (
        <>
          <Label>Layout</Label>
          <View style={styles.chipRow}>
            {layouts.map((key) => (
              <Chip
                key={key}
                title={venueLayoutLabel(key)}
                note={row?.layoutCapacities[key] !== undefined ? `Up to ${row.layoutCapacities[key]}` : null}
                selected={layout === key}
                onPress={() => setLayout(key)}
                testID={`venue-checkout-layout-${key}`}
              />
            ))}
          </View>
        </>
      ) : null}
      {offer.extras.length > 0 ? <Label>Extras</Label> : null}
      {offer.extras.map((x) => (
        <Toggle
          key={x.id}
          title={x.name}
          line={extraRowLine(x, money)}
          on={extras.includes(x.id)}
          onPress={() => setExtras(extras.includes(x.id) ? extras.filter((id) => id !== x.id) : [...extras, x.id])}
          testID={`venue-checkout-extra-${x.id}`}
        />
      ))}
      <Label>Occasion</Label>
      <View style={styles.chipRow}>
        {OCCASIONS.map((o) => (
          <Chip key={o} title={o} selected={occasion === o} onPress={() => setOccasion(occasion === o ? null : o)} testID={`venue-checkout-occasion-${o}`} />
        ))}
      </View>
      <Label>{`Tell ${offer.venue.name} about your event`}</Label>
      <BottomSheetTextInput
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={500}
        placeholderTextColor={C.placeholder}
        style={styles.textArea}
        accessibilityLabel={`Tell ${offer.venue.name} about your event`}
        testID="venue-checkout-hire-note"
      />
    </View>
  );
}

// ─── By the hour ──────────────────────────────────────────────────────────

export function HourChoose({
  offer,
  today,
  venue,
  onReport,
  initial = null,
}: {
  offer: EntryOfferDetail;
  today: string;
  venue: WhenLineVenue;
  onReport: (r: ChooseReport) => void;
  /** #4490 06-W4 fix 1 (W4-N4): the picks kept across a sign-in. */
  initial?: Extract<VenueCheckoutChoice, { kind: "by_the_hour" }> | null;
}): React.ReactElement {
  const tz = offer.venue.timezone;
  const dates = useMemo(() => Array.from({ length: CHECKOUT_DAYS }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState<string>(initial?.day ?? today);
  const [startsAt, setStartsAt] = useState<string | null>(initial?.startsAt ?? null);
  const [minutes, setMinutes] = useState<number | null>(initial?.minutes ?? null);
  const priceOption = offer.options[0] ?? null;
  const guestMin = priceOption?.guestMin ?? 1;
  const guestMax = priceOption?.guestMax ?? guestMin;
  const [guests, setGuests] = useState<number>(initial?.guests ?? guestMin);
  const dayQuery = useQuery({
    queryKey: venueOfferCheckoutKeys.hourDay(offer.id, date),
    queryFn: () => venueOfferCheckoutService.hourDay({ offeringId: offer.id, date, guests: null }),
    staleTime: 30_000,
    retry: readRetry,
  });
  const day = useMemo(() => parseHireHourDay(dayQuery.data ?? null), [dayQuery.data]);
  const starts = day?.status === "open" ? day.starts : [];
  const start = starts.find((s) => s.startsAt === startsAt) ?? null;
  const lengths = day !== null && start !== null ? hourLengthsFor(day, start.startsAt) : [];
  const length = minutes !== null && lengths.includes(minutes) ? minutes : lengths[0] ?? null;
  const time = start !== null ? venueClock(start.startsAt, tz) : null;
  const problem = dayQuery.isLoading
    ? "Checking what's free…"
    : day === null || day.status !== "open" || starts.length === 0
      ? `Nothing free on ${entryDateLabel(date)}. Pick another day.`
      : start === null
        ? "Choose a start time."
        : length === null
          ? "Choose how long."
          : null;

  useEffect(() => {
    onReport({
      choice:
        problem === null && start !== null && length !== null
          ? {
              kind: "by_the_hour",
              offeringId: offer.id,
              startsAt: start.startsAt,
              minutes: length,
              guests,
              priceOptionId: priceOption?.id ?? null,
              day: date,
              time,
            }
          : null,
      problem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, start?.startsAt, length, guests, date, time]);

  return (
    <View testID="venue-checkout-choose-hour">
      <Label>Day</Label>
      <View style={styles.chipRow}>
        {dates.map((d) => (
          <Chip
            key={d}
            title={dayChipTitle(d, today)}
            note={dayChipNote(d)}
            selected={d === date}
            onPress={() => {
              setDate(d);
              setStartsAt(null);
              setMinutes(null);
            }}
            testID={`venue-checkout-day-${d}`}
          />
        ))}
      </View>
      <Label>Start</Label>
      <ReadState loading={dayQuery.isLoading} error={dayQuery.error} onRetry={() => void dayQuery.refetch()} testID="venue-checkout-hour-day" />
      {!dayQuery.isLoading && dayQuery.error === null && starts.length === 0 ? (
        <Notice text={`Nothing free on ${entryDateLabel(date)}. Pick another day.`} />
      ) : null}
      <View style={styles.chipRow}>
        {starts.map((s) => {
          const label = venueClock(s.startsAt, tz) ?? "";
          return (
            <Chip
              key={s.startsAt}
              title={label}
              selected={s.startsAt === start?.startsAt}
              disabled={s.places < 1}
              onPress={() => setStartsAt(s.startsAt)}
              accessibilityLabel={s.places < 1 ? `${label}, taken` : label}
              testID={`venue-checkout-hour-start-${label}`}
            />
          );
        })}
      </View>
      {time !== null ? <VenueCheckoutWhenLine lat={venue.lat} lng={venue.lng} category={venue.category} day={date} time={time} /> : null}
      {lengths.length > 0 ? (
        <>
          <Label>How long</Label>
          <View style={styles.chipRow}>
            {lengths.map((m) => (
              <Chip key={m} title={hourLengthWords(m)} selected={m === length} onPress={() => setMinutes(m)} testID={`venue-checkout-length-${m}`} />
            ))}
          </View>
        </>
      ) : null}
      {guestMax > guestMin ? (
        <>
          <Label>Guests</Label>
          <Stepper value={guests} min={guestMin} max={guestMax} onChange={setGuests} name="Guests" testID="venue-checkout-guests" />
        </>
      ) : null}
    </View>
  );
}

// ─── Plan ─────────────────────────────────────────────────────────────────

export function PlanChoose({
  plans,
  initialPlanId,
  initialStartOn = null,
  today,
  money,
  onReport,
}: {
  plans: readonly VenueFeaturePlanView[];
  initialPlanId: string | null;
  /** #4490 06-W4 fix 1 (W4-N4): the start day kept across a sign-in. */
  initialStartOn?: string | null;
  today: string;
  money: (minor: number) => string;
  onReport: (r: ChooseReport) => void;
}): React.ReactElement {
  const [planId, setPlanId] = useState<string | null>(initialPlanId ?? plans.find((p) => !p.full)?.id ?? null);
  const [startOn, setStartOn] = useState<string>(initialStartOn ?? today);
  const plan = plans.find((p) => p.id === planId) ?? null;
  const dates = useMemo(() => Array.from({ length: CHECKOUT_DAYS }, (_, i) => addDays(today, i)), [today]);
  const problem = plan === null ? "Choose a plan." : plan.full ? "This plan is full right now." : null;
  useEffect(() => {
    onReport({
      choice: problem === null && plan !== null ? { kind: "plan", planId: plan.id, startOn: startOn === today ? null : startOn } : null,
      problem,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, plan?.id, startOn, today]);
  return (
    <View testID="venue-checkout-choose-plan">
      <Label>Plan</Label>
      {plans.map((p) => (
        <RadioRow
          key={p.id}
          title={p.name}
          line={`${money(p.priceMinor)} ${p.period === "year" ? "a year" : "a month"}${p.full ? " · Full" : ""}${p.summary ? ` · ${p.summary}` : ""}`}
          selected={p.id === planId}
          disabled={p.full}
          onPress={() => setPlanId(p.id)}
          testID={`venue-checkout-plan-${p.id}`}
        />
      ))}
      <Label>Start</Label>
      <View style={styles.chipRow}>
        {dates.map((d) => (
          <Chip
            key={d}
            title={dayChipTitle(d, today)}
            note={dayChipNote(d)}
            selected={d === startOn}
            onPress={() => setStartOn(d)}
            testID={`venue-checkout-plan-start-${d}`}
          />
        ))}
      </View>
      {plan !== null && plan.joinMode === "request" ? (
        <Text style={styles.itemLine}>{"The venue looks at each request first. Nothing to pay until they say yes."}</Text>
      ) : null}
    </View>
  );
}

/** Today in the venue's zone (the panes' rule), "YYYY-MM-DD". */
export const checkoutToday = (now: Date, timeZone: string | null): string => venueToday(now, timeZone);

const styles = StyleSheet.create({
  label: { ...typography.xs, fontWeight: fontWeights.semibold, color: C.textLabel, marginTop: spacing.md, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 44,
    minWidth: 60,
    paddingHorizontal: spacing.md - spacing.xxs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { borderColor: C.accent, backgroundColor: C.accentTint },
  chipOff: { opacity: 0.42 },
  chipTitle: { ...typography.sm, fontWeight: fontWeights.semibold, color: C.textSecondary },
  chipTitleOn: { color: C.text },
  chipNote: { ...typography.xs, color: C.textMeta },
  struck: { textDecorationLine: "line-through" },
  pressed: { opacity: 0.72 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md - spacing.xs,
    padding: spacing.md - spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    marginBottom: spacing.sm,
    minHeight: 52,
  },
  itemText: { flex: 1, gap: spacing.xxs },
  itemName: { ...typography.md, fontWeight: fontWeights.bold, color: C.text },
  itemLine: { ...typography.sm, color: C.textSecondary },
  radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 2, borderColor: C.borderStrong },
  box: { width: 22, height: 22, borderRadius: radius.sm - spacing.xxs, borderWidth: 2, borderColor: C.borderStrong },
  radioOn: { borderColor: C.accent, backgroundColor: C.accent },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.tabSelected,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { ...typography.lg, fontWeight: fontWeights.bold, color: C.text },
  stepValue: { ...typography.lg, fontWeight: fontWeights.bold, color: C.text, minWidth: 28, textAlign: "center" },
  notice: { padding: spacing.md - spacing.xs, borderRadius: radius.md, marginVertical: spacing.sm, borderWidth: 1 },
  noticeWarn: { backgroundColor: C.accentTint, borderColor: C.accent },
  noticeError: { backgroundColor: C.accentTint, borderColor: C.error },
  noticeInfo: { backgroundColor: C.infoFill, borderColor: C.infoBorder },
  noticeText: { ...typography.sm, fontWeight: fontWeights.semibold, color: C.text },
  readState: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  retry: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: C.borderStrong, justifyContent: "center" },
  retryText: { ...typography.sm, fontWeight: fontWeights.semibold, color: C.text },
  textArea: {
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.field,
    color: C.text,
    padding: spacing.md - spacing.xs,
    textAlignVertical: "top",
    ...typography.sm,
  },
});
