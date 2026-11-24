/**
 * #4490 P5-2 — the live floor in Reservations › Floor (`fl-live`, `fl-seat`,
 * `ph-floor`).
 *
 * A space's floor at a moment of the chosen day: who is seated, booked or not
 * confirmed on each table (always as a word), when it frees up, and what is
 * next. A booking with no table is the one red line ("1 booking has no
 * table") with "Give a table": the tables that fit are outlined, the rest
 * step back, with "Best fit" and "Or join" from the server. A table opens a
 * card (a sheet on a phone): Seat, Clear table, Move, Open booking. Phones get
 * a list of every table under the map, so nothing is map-only.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useTransitionReservation } from "../../../../hooks/useVenueReservations";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useTouchFloor } from "../../../../hooks/useTouchFloor";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useAssignTable, useTableSuggestions, useVenueFloorPlan } from "../../../../hooks/useVenueTables";
import type { FloorUnassigned, VenueFloorTable } from "../../../../services/venueFloorService";
import { localWallClockToUtcInstant } from "../../../../utils/eventDateMath";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/Pill";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import { formatCurrency } from "../../../../utils/currency";
import { FloorLegend, FloorMap, type FloorMapTable, type FloorTableTone } from "./FloorMap";
import {
  defaultTableSize,
  floorErrorCopy,
  LIVE_STATE_WORD,
  liveTableLine,
  liveTableState,
  pairName,
  parseRoom,
  seatsLine,
  SHAPE_LABEL,
  type LiveTableState,
} from "./floorModel";

const WIDE = 1024;

export interface VenueFloorLiveProps {
  brandId: string | null;
  venueId: string | null;
  /** The venue-local day (YYYY-MM-DD). */
  dayKey: string;
  isToday: boolean;
  timeZone: string;
  onOpenReservation: (reservationId: string) => void;
  onEditLayout?: (spaceId: string) => void;
}

function clockIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function minuteNow(timeZone: string): number {
  const hhmm = clockIn(new Date().toISOString(), timeZone);
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const pad = (n: number): string => String(n).padStart(2, "0");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + offset));
  return at.toISOString().slice(0, 10);
}
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}
const label = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

const TONE: Readonly<Record<LiveTableState, FloorTableTone>> = {
  free: "free",
  next: "next",
  booked: "booked",
  seated: "seated",
  not_confirmed: "pending",
};

export function VenueFloorLive({
  brandId,
  venueId,
  dayKey,
  isToday,
  timeZone,
  onOpenReservation,
  onEditLayout,
}: VenueFloorLiveProps): React.ReactElement {
  // The brand currency is read here, inside the lazily loaded floor, so the
  // reservations screen never loads the brand list (and its auth context) at
  // module scope.
  const currency = useBrandCurrency(brandId);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const touch = useTouchFloor();
  const access = useVenueEditAccess(brandId, venueId);
  const [minute, setMinute] = useState<number | null>(null);
  // The floor keeps its own day (the module's day to start with): Previous / Next day.
  const [dayOffset, setDayOffset] = useState(0);
  const day = shiftDay(dayKey, dayOffset);
  const dayIsToday = isToday && dayOffset === 0;
  const effectiveMinute = minute ?? (dayIsToday ? Math.floor(minuteNow(timeZone) / 15) * 15 : 19 * 60);
  const at = localWallClockToUtcInstant(`${day}T${label(effectiveMinute)}:00`, timeZone);
  const floor = useVenueFloorPlan(brandId, venueId, at, { refetchMs: dayIsToday && minute === null ? 60_000 : false });
  const plan = floor.data ?? null;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seating, setSeating] = useState<FloorUnassigned | null>(null);
  const [moving, setMoving] = useState<{ reservationId: string; guestName: string | null; partySize: number; reservedFor: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const assign = useAssignTable(brandId, venueId);
  const transition = useTransitionReservation(brandId, venueId);

  const spaces = plan?.spaces.filter((s) => s.tables.length > 0) ?? [];
  // Start on the first space with tables drawn on its floor.
  const current =
    spaces.find((s) => s.id === spaceId) ??
    spaces.find((s) => s.tables.some((t) => t.planX !== null && t.planY !== null)) ??
    spaces[0] ??
    null;
  const allTables = useMemo(() => (plan?.spaces ?? []).flatMap((s) => s.tables), [plan?.spaces]);
  const target = seating ?? moving;
  const suggestions = useTableSuggestions(
    brandId,
    venueId,
    target === null ? null : { reservationId: target.reservationId, reservedFor: target.reservedFor, partySize: target.partySize },
  );
  const fitIds = new Set((suggestions.data?.options ?? []).filter((o) => o.free && o.kind === "table").flatMap((o) => o.tableIds));
  const money = (minor: number): string => (currency === null ? String(minor / 100) : formatCurrency(minor, currency, true).replace(/\.00$/, ""));

  const mapTables: FloorMapTable[] =
    current === null
      ? []
      : current.tables
          .filter((t) => t.planX !== null && t.planY !== null)
          .map((t) => {
            const size = defaultTableSize(t.shape, t.capacity);
            const facts = { now: t.now, next: t.next === null ? null : { status: t.next.status, reservedFor: t.next.reservedFor } };
            const state = liveTableState(facts);
            const seatingMode = target !== null;
            const fits = fitIds.has(t.id);
            const tone: FloorTableTone = seatingMode ? (fits ? "fit" : "dim") : TONE[state];
            const word = seatingMode
              ? fits
                ? `Fits ${t.capacity}`
                : t.now !== null
                  ? "Taken"
                  : `Seats ${t.capacity}`
              : t.now !== null
                ? `${LIVE_STATE_WORD[state]} · ${t.now.partySize}`
                : t.next !== null
                  ? `Next ${clockIn(t.next.reservedFor, timeZone)}`
                  : "Free";
            return {
              id: t.id,
              name: t.name,
              shape: t.shape,
              box: { x: t.planX ?? 0, y: t.planY ?? 0, w: t.planW ?? size.w, h: t.planH ?? size.h, rotation: t.rotation },
              seats: t.capacity,
              word,
              tone,
              accessibilityLabel: `${t.name}, ${seatsLine(t.capacity, t.minParty)}, ${seatingMode ? (fits ? "fits this party" : "doesn't fit or is taken") : liveTableLine(facts, (iso) => clockIn(iso, timeZone))}`,
            };
          });
  const unplacedHere = current?.tables.filter((t) => t.planX === null || t.planY === null) ?? [];
  const selected: VenueFloorTable | null = allTables.find((t) => t.id === selectedId) ?? null;

  const counts = useMemo(() => {
    let seated = 0;
    let arriving = 0;
    let free = 0;
    for (const t of allTables) {
      if (t.now?.status === "seated") seated += t.now.partySize;
      else if (t.now !== null) arriving += 1;
      else free += 1;
    }
    return { seated, arriving, free };
  }, [allTables]);

  const give = (tableIds: string[]): void => {
    if (target === null) return;
    setActionError(null);
    assign.mutate(
      { reservationId: target.reservationId, tableIds, expectedVersion: seating !== null ? seating.version : null },
      {
        onSuccess: () => {
          const names = tableIds.map((id) => allTables.find((t) => t.id === id)?.name ?? "").filter(Boolean);
          setNotice(`${target.guestName ?? "Guest"} is on ${pairName(names)}`);
          setSeating(null);
          setMoving(null);
        },
        onError: (e) => setActionError(floorErrorCopy(e.code)),
      },
    );
  };

  const onSelectTable = (id: string): void => {
    if (target !== null) {
      if (fitIds.has(id)) give([id]);
      else setActionError("That table doesn't fit this party or is taken then. Pick an outlined one.");
      return;
    }
    setSelectedId(id);
    setActionError(null);
  };

  const runTransition = (reservationId: string, toStatus: "seated" | "completed", done: string): void => {
    setActionError(null);
    transition.mutate(
      { reservationId, toStatus },
      {
        onSuccess: () => {
          setNotice(done);
          void floor.refetch();
        },
        onError: () => setActionError("That didn't go through. Check the booking and try again."),
      },
    );
  };

  const tableCard =
    selected !== null ? (
      <View style={styles.card} testID="floor-live-card">
        <Text style={styles.cardTitle}>{selected.name}</Text>
        <Text style={styles.meta}>{`${SHAPE_LABEL[selected.shape]} · ${seatsLine(selected.capacity, selected.minParty)}`}</Text>
        {selected.minSpendMinor > 0 ? <Text style={styles.meta}>{`Minimum spend ${money(selected.minSpendMinor)}`}</Text> : null}
        {selected.now !== null ? (
          <>
            <Text style={styles.line}>{`${clockIn(selected.now.reservedFor, timeZone)} · ${selected.now.guestName ?? "Guest"} · ${selected.now.partySize}${selected.now.joined ? " · joined tables" : ""}`}</Text>
            <Text style={styles.stateWord}>{LIVE_STATE_WORD[liveTableState({ now: selected.now, next: null })]}</Text>
            {selected.now.freeAround !== null ? <Text style={styles.meta}>{`Free around ${clockIn(selected.now.freeAround, timeZone)}`}</Text> : null}
            {selected.now.minSpendMinor > 0 ? <Text style={styles.meta}>{`They spend at least ${money(selected.now.minSpendMinor)}`}</Text> : null}
            <View style={styles.actions}>
              <Button label="Open booking" variant="secondary" size="sm" onPress={() => onOpenReservation(selected.now?.reservationId ?? "")} testID="floor-live-open" />
              {access.canManageTables ? (
                <Button
                  label="Move"
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    if (selected.now !== null) {
                      setMoving({ reservationId: selected.now.reservationId, guestName: selected.now.guestName, partySize: selected.now.partySize, reservedFor: selected.now.reservedFor });
                    }
                  }}
                  testID="floor-live-move"
                />
              ) : null}
            </View>
            {access.canManageTables ? (
              selected.now.status === "seated" ? (
                <Button label="Clear table" variant="primary" size="md" onPress={() => runTransition(selected.now?.reservationId ?? "", "completed", `${selected.name} is free`)} loading={transition.isPending} testID="floor-live-clear" />
              ) : selected.now.status === "confirmed" ? (
                <Button label="Seat them" variant="primary" size="md" onPress={() => runTransition(selected.now?.reservationId ?? "", "seated", `${selected.now?.guestName ?? "Guest"} seated`)} loading={transition.isPending} testID="floor-live-seat" />
              ) : null
            ) : null}
          </>
        ) : (
          <Text style={styles.stateWord}>Free</Text>
        )}
        {selected.next !== null ? (
          <View style={styles.nextRow}>
            <Text style={styles.meta}>{`Next: ${clockIn(selected.next.reservedFor, timeZone)} · ${selected.next.guestName ?? "Guest"} · ${selected.next.partySize}`}</Text>
            <Button label="Open" variant="ghost" size="sm" onPress={() => onOpenReservation(selected.next?.reservationId ?? "")} accessibilityLabel="Open the next booking" testID="floor-live-open-next" />
          </View>
        ) : null}
      </View>
    ) : null;

  const seatPanel =
    target !== null ? (
      <View style={styles.card} testID="floor-live-seat-panel">
        <Text style={styles.cardTitle}>{`${moving !== null ? "Move" : "Give a table to"} ${target.guestName ?? "Guest"} · party of ${target.partySize}`}</Text>
        <Text style={styles.meta}>{clockIn(target.reservedFor, timeZone)}</Text>
        {suggestions.isLoading ? (
          <ActivityIndicator />
        ) : suggestions.isError ? (
          <Text style={styles.error}>Couldn't load the tables that fit. Try again.</Text>
        ) : (
          <>
            {suggestions.data?.bestFit != null ? (
              <Button
                label={`Seat at ${pairName(suggestions.data.bestFit.names)} · seats ${suggestions.data.bestFit.capacity}`}
                variant="primary"
                size="md"
                onPress={() => give(suggestions.data?.bestFit?.tableIds ?? [])}
                loading={assign.isPending}
                testID="floor-live-best-fit"
              />
            ) : null}
            {suggestions.data?.orJoin != null ? (
              <Button
                label={`Join ${pairName(suggestions.data.orJoin.names)} · seats ${suggestions.data.orJoin.capacity}`}
                variant="secondary"
                size="md"
                onPress={() => give(suggestions.data?.orJoin?.tableIds ?? [])}
                loading={assign.isPending}
                testID="floor-live-or-join"
              />
            ) : null}
            {suggestions.data?.bestFit == null && suggestions.data?.orJoin == null ? (
              <Text style={styles.meta}>No free table fits this party at that time. Clear a table first, or move another booking.</Text>
            ) : (
              <Text style={styles.meta}>Or pick an outlined table on the floor.</Text>
            )}
          </>
        )}
        <Button label="Cancel" variant="ghost" size="sm" onPress={() => { setSeating(null); setMoving(null); }} testID="floor-live-seat-cancel" />
      </View>
    ) : null;

  if (floor.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
        <Text style={styles.meta}>Loading the floor…</Text>
      </View>
    );
  }
  if (floor.isError || plan === null) {
    return (
      <View style={styles.card} testID="floor-live-error">
        <Text style={styles.cardTitle}>Couldn't load the floor</Text>
        <Text style={styles.meta}>Check your connection and try again.</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={() => void floor.refetch()} />
      </View>
    );
  }

  const timeBar = (
    <View style={styles.timeBar}>
      <Button label="Previous day" variant="secondary" size="sm" onPress={() => { setDayOffset((d) => d - 1); setMinute(null); }} testID="floor-live-prev-day" />
      <Text style={styles.dayLabel} testID="floor-live-day">{dayLabel(day)}</Text>
      <Button label="Next day" variant="secondary" size="sm" onPress={() => { setDayOffset((d) => d + 1); setMinute(null); }} testID="floor-live-next-day" />
      <Button label="Earlier" variant="secondary" size="sm" onPress={() => setMinute(Math.max(0, effectiveMinute - 30))} accessibilityLabel="30 minutes earlier" testID="floor-live-earlier" />
      <Text style={styles.time} accessibilityLiveRegion="polite" testID="floor-live-time">{label(effectiveMinute)}</Text>
      <Button label="Later" variant="secondary" size="sm" onPress={() => setMinute(Math.min(23 * 60 + 30, effectiveMinute + 30))} accessibilityLabel="30 minutes later" testID="floor-live-later" />
      {dayIsToday ? <Button label="Now" variant="ghost" size="sm" onPress={() => setMinute(null)} testID="floor-live-now" /> : null}
      <View style={styles.grow} />
      <Text style={styles.meta}>{`${counts.seated} seated · ${counts.arriving} booked · ${counts.free} free`}</Text>
    </View>
  );

  if (spaces.length === 0 || current === null) {
    return (
      <View style={styles.card} testID="floor-live-empty">
        <Text style={styles.cardTitle}>No tables on a floor yet</Text>
        <Text style={styles.meta}>Draw the room once and see who is on each table during service.</Text>
        {onEditLayout !== undefined && (plan.spaces[0] ?? null) !== null ? (
          <Button label="Draw the floor" variant="primary" size="md" onPress={() => onEditLayout(plan.spaces[0]?.id ?? "")} testID="floor-live-draw" />
        ) : null}
      </View>
    );
  }

  const listAlternative = (
    <View style={styles.card} testID="floor-live-list">
      <Text style={styles.cardTitle}>{`Tables in ${current.name}`}</Text>
      {current.tables.map((t) => {
        const facts = { now: t.now, next: t.next === null ? null : { status: t.next.status, reservedFor: t.next.reservedFor } };
        return (
          <View key={t.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{t.name}</Text>
              <Text style={styles.meta}>{liveTableLine(facts, (iso) => clockIn(iso, timeZone))}</Text>
            </View>
            <Button
              label={target !== null ? (fitIds.has(t.id) ? "Seat here" : "Taken") : "Open"}
              variant="secondary"
              size="sm"
              disabled={target !== null && !fitIds.has(t.id)}
              onPress={() => onSelectTable(t.id)}
              accessibilityLabel={`${t.name}, ${liveTableLine(facts, (iso) => clockIn(iso, timeZone))}`}
              testID={`floor-live-row-${t.id}`}
            />
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.host} testID="floor-live">
      <View style={styles.chips}>
        {spaces.map((s) => (
          <Chip
            key={s.id}
            label={s.name}
            selected={s.id === current.id}
            onPress={() => {
              setSpaceId(s.id);
              setSelectedId(null);
            }}
            style={touch > 0 ? { minHeight: touch } : undefined}
            testID={`floor-live-space-${s.id}`}
          />
        ))}
        <View style={styles.grow} />
        {onEditLayout !== undefined && access.canManageTables ? (
          <Button label="Edit layout" variant="secondary" size="sm" leadingIcon="edit" onPress={() => onEditLayout(current.id)} testID="floor-live-edit-layout" />
        ) : null}
      </View>
      {timeBar}
      {plan.unassigned.length > 0 && target === null ? (
        <Banner
          tone="danger"
          title={`${plan.unassigned.length} ${plan.unassigned.length === 1 ? "booking has" : "bookings have"} no table`}
          body={plan.unassigned
            .slice(0, 3)
            .map((u) => `${u.guestName ?? "Guest"} · party of ${u.partySize} · ${clockIn(u.reservedFor, timeZone)}`)
            .join("\n")}
          action={access.canManageTables ? { label: "Give a table", onPress: () => setSeating(plan.unassigned[0] ?? null), testID: "floor-live-give" } : undefined}
          testID="floor-live-unassigned"
        />
      ) : null}
      {notice !== null ? <Text style={styles.notice} accessibilityLiveRegion="polite" testID="floor-live-notice">{notice}</Text> : null}
      {actionError !== null ? <Text style={styles.error} accessibilityRole="alert">{actionError}</Text> : null}
      {unplacedHere.length > 0 ? (
        <Text style={styles.meta}>{`Not on the floor yet: ${unplacedHere.map((t) => t.name).join(", ")}. Place them in Edit layout.`}</Text>
      ) : null}
      {wide ? (
        <View style={styles.twoCol}>
          <View style={styles.mapCol}>
            <FloorMap room={parseRoom(current.planShape)} tables={mapTables} selectedId={selectedId} onSelect={onSelectTable} testID="floor-live-map" />
            <FloorLegend
              items={[
                { tone: "free", label: "Free" },
                { tone: "booked", label: "Booked" },
                { tone: "pending", label: "Not confirmed" },
                { tone: "seated", label: "Seated" },
                ...(target !== null ? [{ tone: "fit" as const, label: "Fits" }, { tone: "dim" as const, label: "Taken or too small" }] : []),
              ]}
            />
          </View>
          <View style={styles.sideCol}>
            {seatPanel ?? tableCard ?? <Text style={styles.meta}>Pick a table to see who is on it.</Text>}
          </View>
        </View>
      ) : (
        <>
          <FloorMap room={parseRoom(current.planShape)} tables={mapTables} selectedId={selectedId} onSelect={onSelectTable} testID="floor-live-map" />
          <FloorLegend
            items={[
              { tone: "free", label: "Free" },
              { tone: "booked", label: "Booked" },
              { tone: "pending", label: "Not confirmed" },
              { tone: "seated", label: "Seated" },
            ]}
          />
          {seatPanel}
          {listAlternative}
          <Sheet
            visible={selected !== null && target === null}
            onClose={() => setSelectedId(null)}
            snapPoint={0.5}
            testID="floor-live-sheet"
          >
            <View style={styles.sheetBody}>
              <PickerSheetHead title={selected?.name ?? ""} onClose={() => setSelectedId(null)} />
              <ScrollView style={styles.sheetScrollBox} contentContainerStyle={styles.sheetScroll}>{tableCard}</ScrollView>
            </View>
          </Sheet>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[3] },
  loading: { flexDirection: "row", alignItems: "center", gap: space[2], padding: space[4] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" },
  grow: { flexGrow: 1 },
  timeBar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  dayLabel: { ...type.row, color: color.text1, minWidth: 96, textAlign: "center" },
  time: { ...type.h2, color: color.text1, minWidth: 64, textAlign: "center", fontVariant: ["tabular-nums"] },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[5] },
  mapCol: { flex: 1, minWidth: 0, gap: space[3] },
  sideCol: { width: 320, gap: space[3] },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  cardTitle: { ...type.row, color: color.text1 },
  meta: { ...type.caption, color: color.text2 },
  line: { ...type.small, color: color.text1 },
  stateWord: { ...type.label, color: color.text1 },
  nextRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  error: { ...type.small, color: color.errorText },
  notice: { ...type.small, color: color.successText },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 52 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...type.row, color: color.text1 },
  sheetBody: { flex: 1, paddingHorizontal: space[4] },
  sheetScrollBox: { flex: 1 },
  sheetScroll: { gap: space[3], paddingBottom: space[8] },
});
