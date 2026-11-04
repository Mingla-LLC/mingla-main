// @ts-nocheck — Deno-runtime suite (deno2-discovered lane); app-mobile's tsc sweep has no Deno globals.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
/**
 * Issue #4265 — Likes → Calendar redesign. Implementor happy-path suite.
 *
 *   deno test --allow-read --no-check \
 *     app-mobile/src/components/activity/__tests__/issue_4265_calendar_agenda.implementor.test.ts
 *
 * The pure agenda model (row building, dedupe, grouping, day strip, week and
 * month grids, view preference) runs for real. Dates are built with the local
 * `new Date(y, m, d, h)` constructor so nothing depends on the machine's TZ.
 * The RN wiring that cannot mount here is pinned as source structure, the way
 * the #1636 / ORCH-1189 suites beside it are.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  addDays,
  buildDayStrip,
  buildMonthGrid,
  buildUnifiedRows,
  buildWeekStrip,
  CALENDAR_VIEWS,
  calendarViewStorageKey,
  dayKeyOf,
  dayLabelFor,
  dayVisual,
  daysInMonth,
  dedupeUnifiedRows,
  DEFAULT_CALENDAR_VIEW,
  groupByDay,
  isTypeFilterActive,
  upcomingCountsByType,
  matchesTypeFilter,
  parseCalendarView,
  rowsInWeek,
  shiftMonth,
  sortPast,
  sortUpcoming,
  startOfWeek,
  tagsByDay,
  ticketRowKey,
  toggleSelectedDay,
  weekRange,
  weekStartForLocale,
} from "../calendarAgendaModel.ts";

const appRoot = new URL("../../../../", import.meta.url);
const read = (rel: string): Promise<string> => Deno.readTextFile(new URL(rel, appRoot));
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const iso = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m, d, h, min).toISOString();

const NOW = new Date(2026, 10, 4, 10, 0).getTime(); // Wed 4 Nov 2026, 10:00 local
const TODAY = new Date(2026, 10, 4);

function ticket(overrides = {}) {
  return {
    orderId: "order-1",
    eventDateId: null,
    eventTitle: "Comedy night",
    brandName: "Terra",
    coverMediaUrl: "https://x/cover.jpg",
    coverMediaType: "image",
    masterDateUtc: iso(2026, 10, 4, 20),
    masterDateEndUtc: iso(2026, 10, 4, 23),
    paymentStatus: "paid",
    ticketCount: 2,
    ticketCountValid: 2,
    tickets: [{ id: "t1", status: "valid" }, { id: "t2", status: "valid" }],
    venue: { locationText: "Terra Kulture" },
    ...overrides,
  };
}

const empty = { calendarEntries: [], ticketOrders: [], reservations: [], stays: [], rsvps: [] };

// ── 1. Duplicate rows: a two-day order is two rows with two keys ────────────

Deno.test("#4265 a two-day ticket order renders as two distinct rows, never one shared key", () => {
  // The live order b0c1ab83… : one order, two event_dates, two passes per day.
  // #2160 emits one BusinessEventCalendarRow per day, both carrying the SAME
  // orderId. Keying by orderId alone is the "two children with the same key"
  // warning; collapsing them would hide day 1 (the #2160 bug).
  const day1 = ticket({ orderId: "b0c1ab83", eventDateId: "day-1", masterDateUtc: iso(2026, 10, 6, 18), masterDateEndUtc: iso(2026, 10, 6, 23) });
  const day2 = ticket({ orderId: "b0c1ab83", eventDateId: "day-2", masterDateUtc: iso(2026, 10, 7, 18), masterDateEndUtc: iso(2026, 10, 7, 23) });
  const rows = buildUnifiedRows({ ...empty, ticketOrders: [day1, day2] }, NOW);
  assertEquals(rows.length, 2, "both days survive");
  const keys = rows.map((r) => r.key);
  assertEquals(new Set(keys).size, 2, `keys must be unique: ${keys.join(", ")}`);
  assertEquals(keys, ["ticket:b0c1ab83:day-1", "ticket:b0c1ab83:day-2"]);
});

Deno.test("#4265 the same ticket row arriving twice collapses to one, keeping the richer copy", () => {
  const thin = ticket({ eventDateId: "d1", coverMediaUrl: null, tickets: [] });
  const rich = ticket({ eventDateId: "d1" });
  const rows = buildUnifiedRows({ ...empty, ticketOrders: [thin, rich] }, NOW);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].kind, "ticket");
  assertEquals(rows[0].row.tickets.length, 2, "the copy with passes wins");
  // Deterministic on a tie: first seen wins.
  const a = ticket({ eventDateId: "d1", eventTitle: "A" });
  const b = ticket({ eventDateId: "d1", eventTitle: "B" });
  assertEquals(buildUnifiedRows({ ...empty, ticketOrders: [a, b] }, NOW)[0].title, "A");
  // An order with no day set keys by its start, so one-row orders still dedupe.
  assertEquals(ticketRowKey({ orderId: "o", eventDateId: null, masterDateUtc: "2026-11-04T20:00:00.000Z" }), "ticket:o:2026-11-04T20:00:00.000Z");
});

Deno.test("#4265 dedupe preserves order and leaves distinct entities alone", () => {
  const rows = buildUnifiedRows({
    ...empty,
    calendarEntries: [{ id: "c1", title: "Walk", scheduled_at: iso(2026, 10, 5) }, { id: "c1", title: "Walk", scheduled_at: iso(2026, 10, 5) }],
    reservations: [{ id: "r1", reserved_for: iso(2026, 10, 4, 21), status: "confirmed", party_size: 2, brand_name: "Nok" }],
  }, NOW);
  assertEquals(rows.map((r) => r.key), ["calendar:c1", "reservation:r1"]);
  assertEquals(dedupeUnifiedRows([]).length, 0);
});

// ── 2. Row building: dates parsed once, end-not-start bucketing ────────────

Deno.test("#4265 rows bucket on the effective END, not the start", () => {
  const rows = buildUnifiedRows({
    calendarEntries: [
      // Started 9:00, 120-minute default → ends 11:00, still upcoming at 10:00.
      { id: "inprog", title: "Brunch", scheduled_at: iso(2026, 10, 4, 9) },
      { id: "done", title: "Old", scheduled_at: iso(2026, 10, 1, 9) },
      { id: "undated", title: "Someday" },
    ],
    ticketOrders: [
      ticket({ orderId: "past", masterDateUtc: iso(2026, 10, 1, 20), masterDateEndUtc: iso(2026, 10, 1, 23) }),
      ticket({ orderId: "pending", paymentStatus: "pending", masterDateUtc: iso(2026, 10, 1, 20), masterDateEndUtc: null }),
    ],
    reservations: [
      { id: "cancelled", reserved_for: iso(2026, 10, 9, 20), status: "cancelled_by_guest", party_size: 2, brand_name: "Nok" },
      { id: "soon", reserved_for: iso(2026, 10, 4, 21), status: "requested", party_size: 4, brand_name: "Nok" },
    ],
    stays: [
      { groupId: "s1", state: "confirmed", venueName: "Eko Hotel", brandName: "Eko", lines: [{ roomCheckIn: iso(2026, 10, 9, 14), roomCheckOut: iso(2026, 10, 11, 11), placeStartsAt: null, placeEndsAt: null }] },
    ],
    rsvps: [
      { rsvpId: "v1", guestId: null, eventTitle: "Gallery", brandName: "G", coverMediaUrl: null, masterDateUtc: iso(2026, 10, 5, 18), masterDateEndUtc: null, approvalStatus: "pending", venue: { locationText: null } },
    ],
  }, NOW);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assertEquals(byKey["calendar:inprog"].isPast, false);
  assertEquals(byKey["calendar:done"].isPast, true);
  assertEquals(byKey["calendar:undated"].isPast, false);
  assertEquals(byKey["calendar:undated"].dayKey, null);
  assertEquals(byKey["ticket:past:" + iso(2026, 10, 1, 20)].isPast, true);
  const pending = rows.find((r) => r.key.startsWith("ticket:pending"));
  assertEquals(pending.isPast, false, "pending payment stays upcoming");
  assertEquals(pending.hasTicket, false, "no Ticket button while finalizing");
  assertEquals(pending.statusNote, "finalizing");
  assertEquals(byKey["reservation:cancelled"].isPast, true);
  assertEquals(byKey["reservation:soon"].statusNote, "requested");
  assertEquals(byKey["reservation:soon"].partySize, 4);
  assertEquals(byKey["stay:s1"].dayKey, "2026-11-09");
  assertEquals(byKey["stay:s1"].tag, "stay");
  assertEquals(byKey["rsvp:v1:primary"].tag, "ticket");
  assertEquals(byKey["rsvp:v1:primary"].hasTicket, false, "pending approval has no pass yet");
  assertEquals(byKey["calendar:inprog"].dayKey, "2026-11-04");
  assertEquals(byKey["calendar:inprog"].tag, "plan");
});

Deno.test("#4265 filter menu counts upcoming plans per type; the button lights up only for a type", () => {
  const rows = [
    { tag: "ticket", isPast: false },
    { tag: "ticket", isPast: false },
    { tag: "ticket", isPast: true },
    { tag: "reservation", isPast: false },
    { tag: "plan", isPast: false },
    { tag: "plan", isPast: true },
    { tag: "stay", isPast: true },
  ];
  assertEquals(upcomingCountsByType(rows), { all: 4, tickets: 2, reservations: 1, plans: 1, stays: 0 });
  assertEquals(upcomingCountsByType([]), { all: 0, tickets: 0, reservations: 0, plans: 0, stays: 0 });
  assertEquals(isTypeFilterActive("all"), false);
  for (const f of ["tickets", "reservations", "plans", "stays"]) assertEquals(isTypeFilterActive(f), true, f);
});

Deno.test("#4265 type filters narrow by tag", () => {
  assert(matchesTypeFilter("ticket", "all"));
  assert(matchesTypeFilter("ticket", "tickets"));
  assert(!matchesTypeFilter("plan", "tickets"));
  assert(matchesTypeFilter("reservation", "reservations"));
  assert(matchesTypeFilter("plan", "plans"));
  assert(matchesTypeFilter("stay", "stays"));
  assert(!matchesTypeFilter("stay", "plans"));
});

// ── 3. Grouping + labels ────────────────────────────────────────────────────

Deno.test("#4265 agenda groups by day with Today, Tomorrow, then dates; undated last", () => {
  const todayKey = dayKeyOf(TODAY);
  const rows = sortUpcoming([
    { key: "c", startMs: new Date(2026, 10, 7, 9).getTime(), dayKey: "2026-11-07" },
    { key: "u", startMs: Number.NaN, dayKey: null },
    { key: "a", startMs: new Date(2026, 10, 4, 20).getTime(), dayKey: "2026-11-04" },
    { key: "b", startMs: new Date(2026, 10, 5, 9).getTime(), dayKey: "2026-11-05" },
    { key: "a2", startMs: new Date(2026, 10, 4, 21).getTime(), dayKey: "2026-11-04" },
  ]);
  const groups = groupByDay(rows, todayKey);
  assertEquals(groups.map((g) => g.label), ["today", "tomorrow", "date", "undated"]);
  assertEquals(groups[0].data.map((r) => r.key), ["a", "a2"]);
  assertEquals(dayLabelFor("2026-12-01", "2026-11-30"), "tomorrow", "tomorrow crosses a month");
  assertEquals(dayLabelFor("2027-01-01", "2026-12-31"), "tomorrow", "and a year");
  assertEquals(sortPast(rows).map((r) => r.key), ["c", "b", "a2", "a", "u"]);
});

// ── 4. Today highlight (fails on revert) ────────────────────────────────────

Deno.test("#4265 today is always highlighted; selected is filled orange", () => {
  assertEquals(dayVisual({ isToday: true, isSelected: false }), { fill: "quiet", border: "accent", showTodayLabel: true, textOnAccent: false });
  assertEquals(dayVisual({ isToday: true, isSelected: true }), { fill: "accent", border: "accent", showTodayLabel: true, textOnAccent: true });
  assertEquals(dayVisual({ isToday: false, isSelected: true }), { fill: "accent", border: "accent", showTodayLabel: false, textOnAccent: true });
  assertEquals(dayVisual({ isToday: false, isSelected: false }), { fill: "quiet", border: "quiet", showTodayLabel: false, textOnAccent: false });
});

Deno.test("#4265 day strip = next seven days from today, with today, selection and counts", () => {
  const counts = tagsByDay([
    { dayKey: "2026-11-04", tag: "ticket" },
    { dayKey: "2026-11-04", tag: "reservation" },
    { dayKey: "2026-11-09", tag: "stay" },
    { dayKey: null, tag: "plan" },
  ]);
  const strip = buildDayStrip(TODAY, counts, "2026-11-06");
  assertEquals(strip.length, 7);
  assertEquals(strip[0].dayKey, "2026-11-04");
  assertEquals(strip[6].dayKey, "2026-11-10");
  assertEquals(strip.filter((d) => d.isToday).map((d) => d.dayKey), ["2026-11-04"]);
  assertEquals(strip.filter((d) => d.isSelected).map((d) => d.dayKey), ["2026-11-06"]);
  assertEquals(strip[0].planCount, 2);
  assertEquals(strip[5].planCount, 1);
  assertEquals(toggleSelectedDay(null, "2026-11-06"), "2026-11-06");
  assertEquals(toggleSelectedDay("2026-11-06", "2026-11-06"), null, "tap again clears");
  assertEquals(toggleSelectedDay("2026-11-05", "2026-11-06"), "2026-11-06");
  // Month and year boundaries.
  const dec = buildDayStrip(new Date(2026, 11, 29), new Map(), null);
  assertEquals(dec.map((d) => d.dayKey), ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
});

// ── 5. Week grid ────────────────────────────────────────────────────────────

Deno.test("#4265 week start follows the locale", () => {
  assertEquals(weekStartForLocale("en-US"), 0);
  assertEquals(weekStartForLocale("en-GB"), 1);
  assertEquals(weekStartForLocale("en-NG"), 1);
  assertEquals(weekStartForLocale("de-DE"), 1);
  assertEquals(weekStartForLocale("he-IL"), 0);
  assertEquals(weekStartForLocale("ar-EG"), 6);
  assertEquals(weekStartForLocale("fr"), 1);
  assertEquals(weekStartForLocale("ja"), 0);
});

Deno.test("#4265 week strip: the List day tiles, from the locale week start, with today, past and selection", () => {
  const counts = tagsByDay([{ dayKey: "2026-11-06", tag: "ticket" }, { dayKey: "2026-11-06", tag: "plan" }, { dayKey: "2026-11-02", tag: "stay" }]);
  const mon = buildWeekStrip(TODAY, 1, TODAY, counts, "2026-11-06");
  assertEquals(mon.map((d) => d.dayKey), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assertEquals(mon.filter((d) => d.isToday).map((d) => d.dayKey), ["2026-11-04"]);
  assertEquals(mon.filter((d) => d.isPast).map((d) => d.dayKey), ["2026-11-02", "2026-11-03"], "days before today dim; today does not");
  assertEquals(mon.filter((d) => d.isSelected).map((d) => d.dayKey), ["2026-11-06"]);
  assertEquals(mon[4].planCount, 2);
  assertEquals(mon[0].planCount, 1);
  assertEquals(buildWeekStrip(TODAY, 0, TODAY, counts, null)[0].dayKey, "2026-11-01", "Sunday-first locale");
  assertEquals(buildWeekStrip(TODAY, 6, TODAY, counts, null)[0].dayKey, "2026-10-31", "Saturday-first locale");
  assertEquals(dayKeyOf(startOfWeek(new Date(2026, 10, 1), 1)), "2026-10-26", "Sunday 1 Nov is the end of a Monday week");
  // Arrows step whole weeks, across a year boundary.
  assertEquals(buildWeekStrip(addDays(new Date(2026, 11, 30), 7), 1, TODAY, new Map(), null)[0].dayKey, "2027-01-04");
  // Same tile shape as the List strip.
  assertEquals(Object.keys(mon[0]).sort(), Object.keys(buildDayStrip(TODAY, counts, null)[0]).sort());
  assertEquals(buildDayStrip(TODAY, counts, null).some((d) => d.isPast), false, "the List strip starts today");
});

Deno.test("#4265 week rows: only plans dated inside the shown week", () => {
  const rows = [
    { key: "before", dayKey: "2026-11-01" },
    { key: "first", dayKey: "2026-11-02" },
    { key: "mid", dayKey: "2026-11-05" },
    { key: "last", dayKey: "2026-11-08" },
    { key: "after", dayKey: "2026-11-09" },
    { key: "undated", dayKey: null },
  ];
  const range = weekRange(TODAY, 1);
  assertEquals([range.firstKey, range.lastKey], ["2026-11-02", "2026-11-08"]);
  assertEquals(rowsInWeek(rows, range).map((r) => r.key), ["first", "mid", "last"]);
  assertEquals(rowsInWeek(rows, weekRange(TODAY, 0)).map((r) => r.key), ["before", "first", "mid"]);
});

// ── 6. Month grid ───────────────────────────────────────────────────────────

Deno.test("#4265 month grid: boundaries, 5-6 rows, outside days, today, selected, dots", () => {
  const tags = new Map([
    ["2026-11-04", ["ticket", "reservation"]],
    ["2026-11-20", ["ticket", "plan", "stay", "plan", "ticket"]],
  ]);
  const nov = buildMonthGrid(2026, 10, 1, TODAY, "2026-11-20", tags);
  // Nov 2026 starts on a Sunday → 6 leading days in a Monday-first grid.
  assertEquals(nov.length % 7, 0);
  assertEquals(nov.length, 42);
  assertEquals(nov[0].dayKey, "2026-10-26");
  assertEquals(nov[0].inMonth, false);
  assertEquals(nov[6].dayKey, "2026-11-01");
  assertEquals(nov.filter((c) => c.inMonth).length, 30);
  const today = nov.find((c) => c.isToday);
  assertEquals(today.dayKey, "2026-11-04");
  assertEquals(today.dots, ["ticket", "reservation"]);
  const busy = nov.find((c) => c.dayKey === "2026-11-20");
  assertEquals(busy.isSelected, true);
  assertEquals(busy.dots.length, 3, "at most three dots");
  assertEquals(busy.extra, 2, "+2 more");
  assertEquals(nov.find((c) => c.dayKey === "2026-11-03").isPast, true);
  // Sunday-first: the same month has no leading days → 5 rows.
  assertEquals(buildMonthGrid(2026, 10, 0, TODAY, null, new Map()).length, 35);
  // Leap years.
  assertEquals(daysInMonth(2028, 1), 29);
  assertEquals(daysInMonth(2026, 1), 28);
  assertEquals(daysInMonth(2100, 1), 28);
  assertEquals(daysInMonth(2000, 1), 29);
  const feb = buildMonthGrid(2028, 1, 1, TODAY, null, new Map());
  assertEquals(feb.filter((c) => c.inMonth).length, 29);
  assertEquals(feb.filter((c) => c.inMonth).at(-1).dayKey, "2028-02-29");
  // Navigation across the year.
  assertEquals(shiftMonth(2026, 11, 1), { year: 2027, monthIndex: 0 });
  assertEquals(shiftMonth(2026, 0, -1), { year: 2025, monthIndex: 11 });
});

// ── 7. View preference ──────────────────────────────────────────────────────

Deno.test("#4265 the view preference defaults to List and is per user", () => {
  assertEquals(DEFAULT_CALENDAR_VIEW, "list");
  assertEquals(parseCalendarView(null), "list");
  assertEquals(parseCalendarView(undefined), "list");
  assertEquals(parseCalendarView("garbage"), "list");
  for (const v of CALENDAR_VIEWS) assertEquals(parseCalendarView(v), v);
  assertEquals(calendarViewStorageKey("u1"), "mingla:calendar-view:u1");
  assert(calendarViewStorageKey("u1") !== calendarViewStorageKey("u2"));
});

// ── 8. Wiring (source structure) ────────────────────────────────────────────

Deno.test("#4265 CalendarTab is a virtualised list with no search bar", async () => {
  const tab = stripComments(await read("src/components/activity/CalendarTab.tsx"));
  assert(/<SectionList\b/.test(tab), "List view renders through SectionList");
  assert(!/<ScrollView\b/.test(tab), "no ScrollView + map");
  assert(!/CardFilterBar/.test(tab), "the Calendar has no search/filter bar");
  assert(/buildUnifiedRows(<\w+>)?\(/.test(tab), "rows come from the pure model");
  const moduleStyles = tab.indexOf("\nconst styles = StyleSheet.create(");
  assert(moduleStyles > tab.indexOf("const CalendarTab = ("), "styles live at module scope");
  assert(!/StyleSheet\.create\(/.test(tab.slice(tab.indexOf("const CalendarTab = ("), moduleStyles)), "no StyleSheet.create inside the component");
  assert(!/index \* 60/.test(tab), "no per-row staggered entrance loop");
  assert(!/"tickets", "active"/.test(tab), "the dead accordion default is gone");
  assert(/const mainScrollContent = useMemo\([\s\S]*?paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/.test(tab), "ORCH-1189 clearance");
  assert(/contentContainerStyle=\{mainScrollContent\}/.test(tab), "the clearance reaches the list");
  assert(/keyExtractor=\{\(item\) => item\.key\}/.test(tab), "rows key by entity identity");
  assert(/memo\(CalendarAgendaRowImpl\)/.test(stripComments(await read("src/components/activity/CalendarAgendaRow.tsx"))), "rows are memoised");
});

Deno.test("#4265 Week and Month live in the one scroll body, with chips above the grid and nav clearance", async () => {
  const tab = stripComments(await read("src/components/activity/CalendarTab.tsx"));
  const grids = stripComments(await read("src/components/activity/CalendarGrids.tsx"));
  // ONE vertical scroller for every view: the SectionList, whose header holds the grids.
  assertEquals((tab.match(/<SectionList\b/g) ?? []).length, 1, "exactly one list");
  assert(!/<(ScrollView|FlatList)\b/.test(tab), "no second vertical scroller in CalendarTab");
  assert(!/<(ScrollView|FlatList|SectionList)\b/.test(grids), "the grids never scroll on their own");
  assert(/ListHeaderComponent=\{header\}/.test(tab), "the header (controls + grids) is the list header");
  const header = tab.slice(tab.indexOf("const header = ("), tab.indexOf("return (", tab.indexOf("const header = (")));
  assert(header.includes("<CalendarWeekHeader") && header.includes("<CalendarMonthView"), "Week and Month render inside the list header");
  // Week = its title + the SAME day strip as List; its plans are the List rows.
  assertEquals((header.match(/<CalendarDayStrip\b/g) ?? []).length, 2, "List and Week share the one strip component");
  assert(/days=\{weekStrip\}/.test(header), "Week feeds the strip its own week");
  assert(!/CalendarWeekView|weekRow|weekChip/.test(tab + grids), "no vertical day bars");
  const sections0 = tab.slice(tab.indexOf("const sections = useMemo"), tab.indexOf("const hasUpcomingInView"));
  assert(/rowsInWeek\(typedRows, week\)/.test(sections0) && /groupByDay\(visible, todayKey\)/.test(sections0), "Week lists its rows with the List grouping");
  // The view switch and filter moved to the Likes header line: the body starts with the strip / grid.
  assert(!/CalendarTypeChips|CalendarViewToggle/.test(tab), "no chip row and no text toggle in the Calendar body");
  // Past plans close every view (Week and Month no longer return an empty list).
  assert(!/if \(view === "week"\) return \[\]/.test(tab), "Week keeps its Past plans");
  const sections = tab.slice(tab.indexOf("const sections = useMemo"), tab.indexOf("const hasUpcomingInView"));
  assert(/if \(pastRows\.length > 0\)/.test(sections) && !/view === "list"[^\n]*pastRows/.test(sections), "Past plans are appended for every view");
  // Nav clearance reaches that one list.
  assert(/const mainScrollContent = useMemo\([\s\S]*?paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/.test(tab));
  assert(/contentContainerStyle=\{mainScrollContent\}/.test(tab));
  // removeClippedSubviews toggled under Fabric crashed the app (unmountChildComponentView).
  assert(!/removeClippedSubviews/.test(tab), "no removeClippedSubviews on the Calendar list");
  // Week's empty state names the week (or the day when one is tapped).
  assert(/: view === "week"\s*\? "week"/.test(header), "Nothing booked this week");
  const strip = stripComments(await read("src/components/activity/CalendarControls.tsx"));
  assert(/day\.isPast && !day\.isSelected && styles\.tilePast/.test(strip), "past days dim in the strip");
});

Deno.test("#4265 Likes header line: view icons + filter menu sit beside Saved | Calendar, on Calendar only", async () => {
  const likes = stripComments(await read("src/components/LikesPage.tsx"));
  const controls = stripComments(await read("src/components/activity/CalendarHeaderControls.tsx"));
  const band = likes.slice(likes.indexOf("styles.switcherBand"), likes.indexOf("{/* Content") >= 0 ? likes.indexOf("{/* Content") : likes.indexOf("styles.content"));
  assert(/activeTab === "calendar" \? \(\s*<View style=\{styles\.calendarControls\}>\s*<CalendarViewIcons[\s\S]*?<CalendarFilterMenu/.test(band), "the icons + filter render in the switcher band, only on Calendar");
  assert(/switcherBand:\s*\{[^}]*flexDirection: 'row'[^}]*justifyContent: 'space-between'/.test(likes), "one line: switcher left, controls right");
  assert(/useCalendarViewPref\(userId\)/.test(likes), "LikesPage keeps the persisted view pref");
  assert(/view=\{calendarView\}[\s\S]*typeFilter=\{calendarTypeFilter\}[\s\S]*onTypeCountsChange=\{setCalendarTypeCounts\}/.test(likes), "CalendarTab gets the choice and reports counts");
  // View icons: three 32pt icon buttons with view labels and selected state.
  assert(/const ICON_BUTTON = 32;/.test(controls));
  assert(/CALENDAR_VIEWS\.map/.test(controls) && /accessibilityLabel=\{t\(VIEW_A11Y_KEY\[id\]\)\}/.test(controls) && /accessibilityState=\{\{ selected: on \}\}/.test(controls));
  // Filter: icon button, white when a type is on, labelled with the current choice, expanded state.
  assert(/style=\{\[styles\.filterButton, active && styles\.iconButtonOn\]\}/.test(controls), "highlighted when a type filter is on");
  assert(/const active = isTypeFilterActive\(value\)/.test(controls));
  assert(/filterButtonA11y", \{ current \}/.test(controls) && /expanded: anchor !== null/.test(controls));
  // Menu: every type, its tag dot, its upcoming count and a check on the selected one.
  assert(/<Modal\b/.test(controls) && /AGENDA_TYPE_FILTERS\.map/.test(controls));
  assert(/C\.tag\[TYPE_FILTER_TAG\[id\]\]\.dot/.test(controls), "tag colour dots");
  assert(/\{counts\[id\]\}/.test(controls), "upcoming count per row");
  assert(/\{on \? <Icon name="checkmark"/.test(controls), "checkmark on the selected row");
  assert(/accessibilityRole="menuitem"/.test(controls) && /selected: on, checked: on/.test(controls));
  assert(/onPress=\{\(\) => pick\(id\)\}/.test(controls) && /onRequestClose=\{close\}/.test(controls), "pick applies and closes; back closes");
  assert(/setAccessibilityFocus/.test(controls), "focus returns to the button");
  assert(/if \(reduceMotion\) \{\s*progress\.setValue\(1\)/.test(controls), "no open animation under reduce motion");
});

Deno.test("#4265 pull to refresh refreshes every calendar source", async () => {
  const tab = stripComments(await read("src/components/activity/CalendarTab.tsx"));
  const start = tab.indexOf("const handleRefresh");
  const body = tab.slice(start, tab.indexOf("}, [", start));
  for (const [name, query] of [["refetchOrders", "businessOrdersQuery"], ["refetchReservations", "reservationsQuery"], ["refetchStays", "staysQuery"], ["refetchRsvps", "goingRsvpsQuery"]]) {
    assert(new RegExp(`const \\{ refetch: ${name} \\} = ${query};`).test(tab), `${name} is ${query}.refetch`);
  }
  for (const source of ['"calendarEntries"', "refetchOrders()", "refetchReservations()", "refetchStays()", "refetchRsvps()"]) {
    assert(body.includes(source), `refresh is missing ${source}`);
  }
});

Deno.test("#4265 the calendar service carries each order row's day so keys are unique", async () => {
  const service = stripComments(await read("src/services/calendarService.ts"));
  assert(/eventDateId\?: string \| null;/.test(service));
  assert(/eventDateId: day\.eventDateId \?\? null,/.test(service));
});

Deno.test("#4265 Calendar copy is translated in all 29 locales", async () => {
  const LOCALES = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
  const placeholders = (v: string): string => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join("|");
  const en = JSON.parse(await read("src/i18n/locales/en/activity.json")).calendarTab;
  const REQUIRED = ["viewToggleLabel", "viewListA11y", "viewWeekA11y", "viewMonthA11y", "filterAllPlans", "filterMenuTitle", "filterButtonA11y", "today", "tomorrow", "dateToBeSet", "typeTickets", "typeReservations", "typePlans", "typeStays", "tagTicket", "tagReservation", "tagPlan", "tagStay", "ticketButton", "ticketA11y", "moreA11y", "dayA11y", "dayTodayA11y", "weekPrev", "weekNext", "monthPrev", "monthNext", "noPlans", "pastPlans", "again", "againA11y", "emptyTitleYet", "emptyTitleDay", "emptyTitleWeek", "emptyBody", "planFromSaves", "actionsTitle", "actionShare", "actionAddToPhone", "actionRemove", "actionOpen", "actionCancelReservation", "statusFinalizing", "statusAwaitingApproval", "statusRequested", "statusCancelled", "partyOf", "morePlaces", "loadingCalendar", "reschedule"];
  const RETIRED = ["viewList", "viewWeek", "viewMonth", "typeFilterLabel", "typeAll", "active", "archives", "soloDiscovery", "purchaseDetails", "emptyActiveTitle", "emptyArchiveTitle", "aboutExperience", "visitWebsite"];
  for (const locale of LOCALES) {
    const cal = JSON.parse(await read(`src/i18n/locales/${locale}/activity.json`)).calendarTab;
    let localized = 0;
    for (const key of REQUIRED) {
      const value = cal[key];
      assert(typeof value === "string" && value.trim().length > 0, `${locale} calendarTab.${key} missing`);
      assertEquals(placeholders(value), placeholders(en[key]), `${locale} calendarTab.${key} placeholders`);
      if (value !== en[key]) localized += 1;
    }
    if (locale !== "en" && locale !== "bin") assert(localized >= 20, `${locale} looks like an English fallback (${localized})`);
    for (const key of RETIRED) assert(!(key in cal), `${locale} still carries retired calendarTab.${key}`);
  }
});
