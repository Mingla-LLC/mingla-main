/**
 * #4490 P4-2 — Calendar (`cal`, `cal-conflict`): spaces down, days across
 * (`issue_4490_venue_calendar`).
 *
 * Views: Day (phone default), Week (wide web default) and Month. The first
 * row is entry: how full each day is, and the lower limit on a hire day. Each
 * space row shows its hires (booked), holds (on hold until a time), events,
 * blocks and, on a combination, "Blocked by <part>"; a part inside a combined
 * hire says so. Setup and cleanup show in each block's times. Requests still
 * to answer show quietly (nothing is held yet). Tapping a hire opens the
 * booking, a hold or request opens it in Requests, a block can be lifted, and
 * "Block a space" takes a space or combination out of use for a while.
 */
import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useSpaceBlock, useVenueCalendar } from "../../../../hooks/useVenueHire";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { VenueStaffError } from "../../../../services/venueOffersService";
import type { VenueCalendar } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { DayDateField } from "../../../ui/DayDateField";
import { GlassCard } from "../../../ui/GlassCard";
import { IconChrome } from "../../../ui/IconChrome";
import { Input } from "../../../ui/Input";
import { Meter } from "../../../ui/Meter";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { TimeField } from "../../../ui/TimeField";
import { VenueBookingSheet } from "../bookings/VenueBookingSheet";
import { dateIn, shortDay } from "../bookings/bookingModel";
import { staffErrorCopy } from "../requests/requestsModel";
import { venueScrollBottomPad } from "../../venueShellScroll";
import {
  blockIssue,
  blocksFor,
  calendarRows,
  daySummary,
  daysIn,
  entryFill,
  rangeFor,
  rangeTitle,
  requestsFor,
  shiftAnchor,
  zonedIso,
  calendarEventRoute,
  type BlockDraft,
  type CalendarBlock,
  type CalendarRow,
  type CalendarView,
} from "./calendarModel";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});
const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

const LABEL_COL = 144;
const DAY_COL_MIN = 88;
// #4490 N120 — the week opens by itself only when the window leaves room for
// all seven days beside the app's two sidebars; narrower (1024) it opens on the
// day list, and Week stays one tap away.
export const WEEK_DEFAULT_MIN_WIDTH = 1280;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface VenueCalendarModuleProps {
  brandId: string | null;
  venueId: string | null;
  /** Open a request (or a hold) in Requests. */
  onOpenRequest?: (groupId: string) => void;
}

export function VenueCalendarModule({ brandId, venueId, onOpenRequest }: VenueCalendarModuleProps): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottomPad = venueScrollBottomPad(insets.bottom);
  const offersQuery = useVenueOffers(brandId, venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const featuresData = useVenueFeatures(brandId, venueId).data;
  const hireOn = featuresData?.features.private_hire.enabled !== false;
  // #4490 fix 2 (N76) — with Events here on, start an event at this venue.
  const eventsOn = featuresData?.features.events_here?.enabled === true;
  const timezone = offersQuery.data?.settings?.timezone ?? "Africa/Lagos";
  const today = dateIn(new Date().toISOString(), timezone) ?? new Date().toISOString().slice(0, 10);
  const [pickedView, setView] = useState<CalendarView | null>(null);
  const view: CalendarView = pickedView ?? (isWideDesktop && width >= WEEK_DEFAULT_MIN_WIDTH ? "week" : "day");
  const [anchor, setAnchor] = useState<string | null>(null);
  const at = anchor ?? today;
  const range = rangeFor(view, at);
  const query = useVenueCalendar(brandId, venueId, range.from, range.to);
  const [bookingOpen, setBookingOpen] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblock, setUnblock] = useState<{ claimId: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const blockMutation = useSpaceBlock(brandId, venueId);

  const cal = query.data;
  const rows = useMemo(() => (cal === undefined ? [] : calendarRows(cal)), [cal]);
  const days = daysIn(range.from, range.to);

  const openBlock = (block: CalendarBlock, row: CalendarRow): void => {
    setActionError(null);
    if (block.tone === "block" && block.claimId !== null) {
      if (access.canManageBookings) setUnblock({ claimId: block.claimId, name: row.name });
      return;
    }
    if ((block.tone === "event" || block.tone === "part") && block.eventId !== null) {
      if (cal !== undefined) router.push(calendarEventRoute(cal, block.eventId) as never);
      return;
    }
    if (block.groupId === null) return;
    if ((block.tone === "hold" || block.tone === "request") && onOpenRequest !== undefined) {
      onOpenRequest(block.groupId);
      return;
    }
    setBookingOpen(block.groupId);
  };

  const head = (
    <View style={styles.head}>
      <Text style={styles.title} accessibilityRole="header">Calendar</Text>
      <View style={styles.headControls}>
        <Segmented
          options={[
            { key: "day", label: "Day" },
            { key: "week", label: "Week" },
            { key: "month", label: "Month" },
          ]}
          value={view}
          onChange={setView}
          full={false}
          accessibilityLabel="Calendar view"
          testID="venue-calendar-view"
        />
        <View style={styles.nav}>
          <IconChrome icon="chevL" size={36} accessibilityLabel={`Previous ${view}`} onPress={() => setAnchor(shiftAnchor(view, at, -1))} testID="venue-calendar-prev" />
          <Text style={styles.rangeTitle} testID="venue-calendar-range">{rangeTitle(view, range.from, range.to)}</Text>
          <IconChrome icon="chevR" size={36} accessibilityLabel={`Next ${view}`} onPress={() => setAnchor(shiftAnchor(view, at, 1))} testID="venue-calendar-next" />
        </View>
        {at !== today ? <Button label="Today" variant="ghost" size="sm" onPress={() => setAnchor(null)} testID="venue-calendar-today" /> : null}
        {access.canManageBookings && eventsOn && venueId !== null ? (
          <Button
            label="Add an event here"
            variant="secondary"
            size="sm"
            leadingIcon="plus"
            // orch-strict-grep-allow route-by-event-type — creates a new event at this venue; there is no events-table row to route by type.
            onPress={() => router.push(`/event/create?venueId=${encodeURIComponent(venueId as string)}` as never)}
            testID="venue-calendar-add-event"
          />
        ) : null}
        {access.canManageBookings && rows.length > 0 ? (
          <Button label="Block a space" variant="secondary" size="sm" leadingIcon="shield" onPress={() => setBlockOpen(true)} testID="venue-calendar-block" />
        ) : null}
      </View>
    </View>
  );

  let body: React.ReactNode;
  if (query.isLoading && cal === undefined) {
    body = (
      <View style={styles.loading} accessibilityLabel="Loading the calendar" testID="venue-calendar-loading">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={56} radius="md" />
        ))}
      </View>
    );
  } else if (query.isError || cal === undefined) {
    body = (
      <CenteredState title="Couldn't load the calendar" body="Your bookings are safe. Check your connection and try again." tone="error" testID="venue-calendar-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </CenteredState>
    );
  } else if (rows.length === 0) {
    body = (
      <GlassCard variant="base" padding={space[5]} testID="venue-calendar-empty">
        <Text style={styles.rowTitle}>No spaces yet</Text>
        <Text style={styles.meta}>The calendar shows each space down the side. Add your spaces in Spaces, and bookings that take them show here.</Text>
      </GlassCard>
    );
  } else if (view === "month") {
    body = <MonthGrid cal={cal} days={days} today={today} onPickDay={(d) => { setAnchor(d); setView("day"); }} />;
  } else if (view === "day") {
    body = <DayList cal={cal} rows={rows} date={range.from} onOpen={openBlock} />;
  } else {
    body = <WeekGrid cal={cal} rows={rows} days={days} today={today} fit={width} onOpen={openBlock} onPickDay={(d) => { setAnchor(d); setView("day"); }} />;
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.host, { paddingBottom: bottomPad }]} testID="venue-calendar">
      {head}
      {body}
      {cal !== undefined && view !== "month" ? <Legend hireOn={hireOn} /> : null}
      {actionError !== null ? <Text style={styles.error}>{actionError}</Text> : null}
      <VenueBookingSheet brandId={brandId} venueId={venueId} groupId={bookingOpen} onClose={() => setBookingOpen(null)} />
      {cal !== undefined ? (
        <BlockSheet
          visible={blockOpen}
          wide={isWideDesktop}
          cal={cal}
          rows={rows}
          today={today}
          defaultDate={view === "day" ? range.from : at}
          busy={blockMutation.isPending}
          onClose={() => setBlockOpen(false)}
          onSubmit={(draft, done) => {
            const row = rows.find((r) => r.key === draft.target);
            if (row === undefined) return;
            blockMutation.mutate(
              {
                kind: "block",
                from: zonedIso(draft.fromDate, draft.fromTime, cal.timezone),
                to: zonedIso(draft.toDate, draft.toTime, cal.timezone),
                reason: draft.reason.trim().length > 0 ? draft.reason.trim() : null,
                ...(row.kind === "space" ? { spaceIds: [row.id] } : { combinationId: row.id }),
              },
              {
                onSuccess: () => {
                  setBlockOpen(false);
                  setToast(`${row.name} is blocked ${shortDay(draft.fromDate)}${draft.toDate !== draft.fromDate ? ` to ${shortDay(draft.toDate)}` : ""}`);
                  done(null);
                },
                onError: (e) => {
                  const code = e instanceof VenueStaffError ? e.code : "staff_action_failed";
                  done(code === "offer_space_taken" ? `${row.name} is already booked or on hold then. Pick another time.` : staffErrorCopy(code));
                },
              },
            );
          }}
        />
      ) : null}
      {unblock !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            title={`Unblock ${unblock.name}?`}
            description="Guests can book it again for that time."
            confirmLabel="Unblock"
            cancelLabel="Keep it blocked"
            confirmLoading={blockMutation.isPending}
            errorMessage={actionError}
            onClose={() => {
              setUnblock(null);
              setActionError(null);
            }}
            onConfirm={() =>
              blockMutation.mutate(
                { kind: "unblock", claimId: unblock.claimId },
                {
                  onSuccess: () => {
                    setToast(`${unblock.name} is open again`);
                    setUnblock(null);
                  },
                  onError: (e) => setActionError(staffErrorCopy(e instanceof VenueStaffError ? e.code : "staff_action_failed")),
                },
              )
            }
            testID="venue-calendar-unblock"
          />
        </React.Suspense>
      ) : null}
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-calendar-toast" />
        </React.Suspense>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ views

/**
 * #4490 N115 — the full text of a cell as a hover title (web). React Native
 * Web drops a `title` prop, so the title goes on the element itself through its
 * ref; the same text is already the cell's accessible label.
 */
function hoverTitle(label: string): { ref?: (node: unknown) => void } {
  if (Platform.OS !== "web") return {};
  return {
    ref: (node: unknown): void => {
      if (node !== null && typeof node === "object" && "setAttribute" in node) {
        (node as { setAttribute: (name: string, value: string) => void }).setAttribute("title", label);
      }
    },
  };
}

function BlockChip({ block, onPress }: { block: CalendarBlock; onPress?: () => void }): React.ReactElement {
  const tone = TONE_STYLE[block.tone];
  const content = (
    <>
      <Text style={[styles.blockTitle, tone.text]} numberOfLines={2}>{block.title}</Text>
      {block.detail !== null ? <Text style={[styles.blockDetail, tone.sub]} numberOfLines={2}>{block.detail}</Text> : null}
    </>
  );
  if (onPress === undefined) {
    return (
      <View style={[styles.block, tone.box]} accessibilityLabel={block.label} testID={`venue-calendar-block-${block.key}`} {...hoverTitle(block.label)}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={block.label}
      style={({ pressed }) => [styles.block, tone.box, pressed ? styles.pressed : null]}
      testID={`venue-calendar-block-${block.key}`}
      {...hoverTitle(block.label)}
    >
      {content}
    </Pressable>
  );
}

function tappable(block: CalendarBlock): boolean {
  return block.groupId !== null || block.eventId !== null || (block.tone === "block" && block.claimId !== null);
}

function WeekGrid({
  cal,
  rows,
  days,
  today,
  fit,
  onOpen,
  onPickDay,
}: {
  cal: VenueCalendar;
  rows: CalendarRow[];
  days: string[];
  today: string;
  fit: number;
  onOpen: (block: CalendarBlock, row: CalendarRow) => void;
  onPickDay: (date: string) => void;
}): React.ReactElement {
  // Measure the grid's own box (the window is wider than the module beside the rail).
  const [boxWidth, setBoxWidth] = useState<number>(fit);
  const needsScroll = boxWidth < LABEL_COL + days.length * DAY_COL_MIN;
  const grid = (
    <View style={[styles.grid, needsScroll ? { width: LABEL_COL + days.length * DAY_COL_MIN } : null]} testID="venue-calendar-week">
      <View style={styles.gridRow}>
        <View style={[styles.labelCell, styles.headCell]} />
        {days.map((d) => (
          <Pressable
            key={d}
            onPress={() => onPickDay(d)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${shortDay(d)}`}
            style={[styles.dayCell, styles.headCell, d === today ? styles.todayHead : null]}
          >
            <Text style={[styles.dayHead, d === today ? styles.todayText : null]}>{`${WEEKDAYS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Number(d.slice(8, 10))}`}</Text>
          </Pressable>
        ))}
      </View>
      {cal.days.some((d) => d.pools.length > 0) ? (
        <View style={[styles.gridRow, styles.rowBorder]}>
          <View style={styles.labelCell}>
            <Text style={styles.rowTitle}>Entry</Text>
            <Text style={styles.meta}>{cal.days[0]?.pools[0] !== undefined ? `of ${cal.days[0].pools[0].dailyLimit} a day` : ""}</Text>
          </View>
          {days.map((d) => {
            const day = cal.days.find((x) => x.localDate === d);
            const fill = entryFill(day);
            const groups = day?.groups.length ?? 0;
            return (
              <View key={d} style={[styles.dayCell, styles.entryCell]} accessibilityLabel={`${shortDay(d)}: ${fill?.line ?? "no entry"}`} {...hoverTitle(`${shortDay(d)}: ${fill?.line ?? "no entry"}`)}>
                {fill !== null ? (
                  <>
                    <Text style={[styles.meta, fill.cut ? styles.cutText : null]} numberOfLines={3}>{fill.line}</Text>
                    <Meter value={fill.pct} max={100} tone="accent" />
                  </>
                ) : (
                  <Text style={styles.meta}>—</Text>
                )}
                {groups > 0 ? <Text style={styles.meta}>{groups} {groups === 1 ? "group" : "groups"}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {rows.map((row) => (
        <View key={row.key} style={[styles.gridRow, styles.rowBorder]} testID={`venue-calendar-row-${row.id}`}>
          <View style={styles.labelCell}>
            <Text style={styles.rowTitle} numberOfLines={2}>{row.name}</Text>
            <Text style={styles.meta}>{row.detail}</Text>
          </View>
          {days.map((d) => {
            const blocks = [...blocksFor(cal, row, d), ...requestsFor(cal, row, d)];
            return (
              <View key={d} style={styles.dayCell}>
                {blocks.map((b) => (
                  <BlockChip key={b.key} block={b} onPress={tappable(b) ? () => onOpen(b, row) : undefined} />
                ))}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
  return (
    <GlassCard variant="base" padding={0} contentStyle={styles.gridCard}>
      <View onLayout={(e) => setBoxWidth(Math.round(e.nativeEvent.layout.width))}>
      {needsScroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.hScroll}>
          {grid}
        </ScrollView>
      ) : (
        grid
      )}
      </View>
    </GlassCard>
  );
}

function DayList({
  cal,
  rows,
  date,
  onOpen,
}: {
  cal: VenueCalendar;
  rows: CalendarRow[];
  date: string;
  onOpen: (block: CalendarBlock, row: CalendarRow) => void;
}): React.ReactElement {
  const day = cal.days.find((d) => d.localDate === date);
  const fill = entryFill(day);
  return (
    <View style={styles.dayList} testID="venue-calendar-day">
      {day?.specialHours !== null && day?.specialHours !== undefined ? (
        <Text style={styles.meta}>{day.specialHours.isClosed ? "Closed (special day)" : `Special hours${day.specialHours.label !== null ? `: ${day.specialHours.label}` : ""}`}</Text>
      ) : null}
      {fill !== null ? (
        <GlassCard variant="base" padding={space[4]} contentStyle={styles.dayRow}>
          <View style={styles.dayRowHead}>
            <Text style={styles.rowTitle}>Entry</Text>
            <Text style={[styles.meta, fill.cut ? styles.cutText : null]}>{fill.line}</Text>
          </View>
          <Meter value={fill.pct} max={100} tone="accent" />
          {(day?.groups ?? []).map((g) => (
            <Text key={g.groupId} style={styles.meta}>{`${g.guestName} · ${g.offerName} · ${g.guests} guests`}</Text>
          ))}
        </GlassCard>
      ) : null}
      {rows.map((row) => {
        const blocks = [...blocksFor(cal, row, date), ...requestsFor(cal, row, date)];
        return (
          <GlassCard key={row.key} variant="base" padding={space[4]} contentStyle={styles.dayRow} testID={`venue-calendar-day-row-${row.id}`}>
            <View style={styles.dayRowHead}>
              <Text style={styles.rowTitle}>{row.name}</Text>
              <Text style={styles.meta}>{row.detail}</Text>
            </View>
            {blocks.length === 0 ? (
              <Text style={[styles.meta, styles.freeText]}>Free all day</Text>
            ) : (
              blocks.map((b) => <BlockChip key={b.key} block={b} onPress={tappable(b) ? () => onOpen(b, row) : undefined} />)
            )}
          </GlassCard>
        );
      })}
    </View>
  );
}

function MonthGrid({ cal, days, today, onPickDay }: { cal: VenueCalendar; days: string[]; today: string; onPickDay: (d: string) => void }): React.ReactElement {
  const lead = days.length > 0 ? (new Date(`${days[0]}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <GlassCard variant="base" padding={space[2]} testID="venue-calendar-month">
      <View style={styles.monthRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={[styles.monthHead, styles.meta]}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, week) => (
        <View key={week} style={styles.monthRow}>
          {cells.slice(week * 7, week * 7 + 7).map((d, i) => {
            if (d === null) return <View key={`e-${week}-${i}`} style={styles.monthCell} />;
            const s = daySummary(cal, d);
            const fill = entryFill(cal.days.find((x) => x.localDate === d));
            const words = [
              s.hires > 0 ? `${s.hires} booked` : null,
              s.holds > 0 ? `${s.holds} on hold` : null,
              s.events > 0 ? `${s.events} ${s.events === 1 ? "event" : "events"}` : null,
              s.blocks > 0 ? "blocked" : null,
              s.requests > 0 ? `${s.requests} asked` : null,
            ].filter((x): x is string => x !== null);
            return (
              <Pressable
                key={d}
                onPress={() => onPickDay(d)}
                accessibilityRole="button"
                accessibilityLabel={`${shortDay(d)}${words.length > 0 ? `: ${words.join(", ")}` : ", nothing booked"}`}
                style={({ pressed }) => [styles.monthCell, d === today ? styles.todayCell : null, pressed ? styles.pressed : null]}
                testID={`venue-calendar-month-${d}`}
              >
                <Text style={[styles.monthDay, d === today ? styles.todayText : null]}>{Number(d.slice(8, 10))}</Text>
                {words.slice(0, 3).map((w) => (
                  <Text key={w} style={styles.monthWord} numberOfLines={1}>{w}</Text>
                ))}
                {fill !== null && fill.cut ? <Text style={[styles.monthWord, styles.cutText]} numberOfLines={1}>entry cut</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </GlassCard>
  );
}

function Legend({ hireOn }: { hireOn: boolean }): React.ReactElement {
  // #4490 N57: hire words only when the venue has Private hire on.
  const items: Array<{ tone: keyof typeof TONE_STYLE; label: string }> = [
    ...(hireOn ? [{ tone: "hire" as const, label: "Private hire" }] : []),
    { tone: "hold", label: "On hold" },
    { tone: "event", label: "Event" },
    ...(hireOn ? [{ tone: "inside" as const, label: "Blocked by a bigger hire" }] : []),
    { tone: "part", label: "Part in use (shared event)" },
    { tone: "block", label: "Blocked" },
    { tone: "request", label: "Asked, not held" },
  ];
  return (
    <View style={styles.legend} accessibilityLabel="Calendar key">
      {items.map((it) => (
        <View key={it.tone} style={styles.legendItem}>
          <View style={[styles.legendSwatch, TONE_STYLE[it.tone].box]} />
          <Text style={styles.meta}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ block sheet

function BlockSheet({
  visible,
  wide,
  cal,
  rows,
  today,
  defaultDate,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  wide: boolean;
  cal: VenueCalendar;
  rows: CalendarRow[];
  today: string;
  defaultDate: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: BlockDraft, done: (error: string | null) => void) => void;
}): React.ReactElement {
  const start = defaultDate < today ? today : defaultDate;
  const [draft, setDraft] = useState<BlockDraft>({ target: rows[0]?.key ?? null, fromDate: start, fromTime: "09:00", toDate: start, toTime: "18:00", reason: "" });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => {
    if (!visible) return;
    setDraft({ target: rows[0]?.key ?? null, fromDate: start, fromTime: "09:00", toDate: start, toTime: "18:00", reason: "" });
    setTouched(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const issue = blockIssue(draft, cal.timezone);
  const set = (next: Partial<BlockDraft>): void => setDraft((d) => ({ ...d, ...next }));
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.85} presentation={wide ? "panel" : undefined} testID="venue-calendar-block-sheet">
      <PickerSheetHead title="Block a space" onClose={onClose} plain={wide} />
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        <SelectSheet
          label="Space"
          value={draft.target}
          options={rows.map((r) => ({ value: r.key, label: r.kind === "combination" ? `${r.name} (together)` : r.name }))}
          onChange={(target) => set({ target })}
          testID="venue-calendar-block-space"
        />
        <View style={styles.inlineRow}>
          <View style={styles.dateCol}>
            <DayDateField
              label="From"
              value={draft.fromDate}
              onChangeValue={(fromDate) => set({ fromDate, toDate: draft.toDate < fromDate ? fromDate : draft.toDate })}
              accessibilityLabel="Block from date"
              min={today}
              today={today}
              testID="venue-calendar-block-from-date"
            />
          </View>
          <View style={styles.timeCol}>
            <TimeField label="At" value={draft.fromTime} onChangeValue={(fromTime) => set({ fromTime })} accessibilityLabel="Block from time" testID="venue-calendar-block-from-time" />
          </View>
        </View>
        <View style={styles.inlineRow}>
          <View style={styles.dateCol}>
            <DayDateField
              label="Until"
              value={draft.toDate}
              onChangeValue={(toDate) => set({ toDate })}
              accessibilityLabel="Block until date"
              min={draft.fromDate}
              today={today}
              testID="venue-calendar-block-to-date"
            />
          </View>
          <View style={styles.timeCol}>
            <TimeField label="At" value={draft.toTime} onChangeValue={(toTime) => set({ toTime })} accessibilityLabel="Block until time" testID="venue-calendar-block-to-time" />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Why (only your team sees this)</Text>
          <Input value={draft.reason} onChangeText={(reason) => set({ reason: reason.slice(0, 200) })} placeholder="e.g. Repainting, staff training" accessibilityLabel="Why it's blocked" testID="venue-calendar-block-reason" />
        </View>
        <Text style={styles.meta}>Nobody can book or hire it then. Bookings already made stay as they are; a clash is refused.</Text>
        {touched && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
        {error !== null ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Button label="Cancel" variant="secondary" size="md" onPress={onClose} disabled={busy} />
        <Button
          label="Block it"
          variant="primary"
          size="md"
          loading={busy}
          onPress={() => {
            setTouched(true);
            setError(null);
            if (issue !== null) return;
            onSubmit(draft, (e) => setError(e));
          }}
          testID="venue-calendar-block-confirm"
        />
      </View>
    </Sheet>
  );
}

// ------------------------------------------------------------------ styles

const TONE_STYLE = {
  hire: StyleSheet.create({ box: { backgroundColor: color.paper, borderColor: color.paper }, text: { color: color.ink }, sub: { color: color.ink } }),
  hold: StyleSheet.create({ box: { backgroundColor: color.warningTint, borderColor: color.warning }, text: { color: color.warningText }, sub: { color: color.text2 } }),
  event: StyleSheet.create({ box: { backgroundColor: color.infoTint, borderColor: color.info }, text: { color: color.infoText }, sub: { color: color.text2 } }),
  block: StyleSheet.create({ box: { backgroundColor: color.fill.tile, borderColor: color.line, borderStyle: "dashed" }, text: { color: color.text1 }, sub: { color: color.text3 } }),
  inside: StyleSheet.create({ box: { backgroundColor: color.fill.tile, borderColor: color.line, borderStyle: "dashed" }, text: { color: color.text2 }, sub: { color: color.text3 } }),
  part: StyleSheet.create({ box: { backgroundColor: color.fill.quiet, borderColor: color.info, borderStyle: "dashed" }, text: { color: color.infoText }, sub: { color: color.text3 } }),
  group: StyleSheet.create({ box: { backgroundColor: color.fill.tile, borderColor: color.line }, text: { color: color.text1 }, sub: { color: color.text3 } }),
  request: StyleSheet.create({ box: { backgroundColor: color.fill.quiet, borderColor: color.line, borderStyle: "dotted" }, text: { color: color.text2 }, sub: { color: color.text3 } }),
};

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  head: { gap: space[3] },
  headControls: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  nav: { flexDirection: "row", alignItems: "center", gap: space[1] },
  title: { ...type.h1, color: color.text1 },
  rangeTitle: { ...type.row, color: color.text1, minWidth: 110, textAlign: "center", fontVariant: ["tabular-nums"] },
  meta: { ...type.caption, color: color.text3 },
  error: { ...type.small, color: color.errorText },
  loading: { gap: space[2] },
  rowTitle: { ...type.row, color: color.text1 },
  gridCard: { overflow: "hidden" },
  hScroll: { flexGrow: 0 },
  grid: { width: "100%" },
  gridRow: { flexDirection: "row", alignItems: "stretch" },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  labelCell: { width: LABEL_COL, padding: space[3], gap: 2, borderRightWidth: 1, borderRightColor: color.line },
  headCell: { backgroundColor: color.fill.tableHead, minHeight: 40, justifyContent: "center" },
  dayCell: { flex: 1, minWidth: DAY_COL_MIN, padding: space[1], gap: space[1], borderRightWidth: 1, borderRightColor: color.line, minHeight: 64 },
  entryCell: { justifyContent: "center", paddingHorizontal: space[2] },
  dayHead: { ...type.small, color: color.text2, textAlign: "center" },
  todayHead: { backgroundColor: color.fill.tabOn },
  todayText: { color: color.text1, fontWeight: "700" },
  cutText: { color: color.warningText },
  block: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: space[2], paddingVertical: space[1], minHeight: 44, justifyContent: "center", gap: 1 },
  blockTitle: { ...type.small, fontWeight: "600" },
  blockDetail: { ...type.caption },
  pressed: { opacity: 0.8 },
  dayList: { gap: space[3] },
  dayRow: { gap: space[2] },
  dayRowHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  freeText: { color: color.successText },
  monthRow: { flexDirection: "row" },
  monthHead: { flex: 1, textAlign: "center", paddingVertical: space[1] },
  monthCell: { flex: 1, minHeight: 76, padding: space[1], borderRadius: radius.sm, gap: 1, minWidth: 0 },
  todayCell: { backgroundColor: color.fill.tabOn },
  monthDay: { ...type.small, color: color.text2 },
  monthWord: { ...type.caption, color: color.text2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space[1] },
  legendSwatch: { width: 14, height: 14, borderRadius: radius.sm, borderWidth: 1 },
  sheetScroll: { flex: 1 },
  sheetBody: { gap: space[3], padding: space[4], paddingBottom: space[6] },
  sheetFooter: { flexDirection: "row", justifyContent: "flex-end", gap: space[2], padding: space[4], borderTopWidth: 1, borderTopColor: color.line },
  inlineRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap", alignItems: "flex-end" },
  grow: { flex: 1, minWidth: 140 },
  dateCol: { flex: 1.7, minWidth: 190 },
  timeCol: { flex: 1, minWidth: 110 },
  field: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
});
