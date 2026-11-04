// @ts-nocheck — Deno-runtime suite (deno2-discovered lane); app-mobile's tsc sweep has no Deno globals.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
/**
 * Issue #4265 — Likes redesign (two-column saved grid, heart-with-Undo, quick
 * "When are you going?" sheet, skeleton, coach step 3). Implementor happy-path
 * regression suite.
 *
 *   deno test --allow-read --no-check \
 *     app-mobile/src/components/activity/__tests__/issue_4265_likes_grid.implementor.test.ts
 *
 * The pure decisions (primary button, quick slots, pending removal) are
 * exercised for real; the RN wiring that cannot mount here is pinned as
 * source structure, the same way the #1636 / ORCH-1189 suites beside it do.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  SAVED_GRID_COLUMNS,
  SAVED_UNDO_WINDOW_MS,
  computeQuickSlots,
  createPendingRemovalController,
  isSavedCardTicketed,
  isSavedEventEnded,
  quickSlotDayLabel,
  resolveSavedPrimaryAction,
  resolveScheduleEntry,
} from "../savedGridModel.ts";
import { extractWeekdayText, isPlaceOpenAt } from "../../../utils/openingHoursUtils.ts";
import { COACH_STEPS } from "../../../constants/coachMarkSteps.ts";

const appRoot = new URL("../../../../", import.meta.url);
const read = (rel: string): Promise<string> => Deno.readTextFile(new URL(rel, appRoot));
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LOCALES = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"] as const;

// ── 1. Grid renders two columns ────────────────────────────────────────────

Deno.test("#4265 the Saved tab is a two-column grid with the design's spacing", async () => {
  assertEquals(SAVED_GRID_COLUMNS, 2);
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(/numColumns=\{SAVED_GRID_COLUMNS\}/.test(tab), "FlatList must render numColumns={SAVED_GRID_COLUMNS}");
  assert(/columnWrapperStyle=\{styles\.gridRow\}/.test(tab), "grid rows carry the column spacing");
  assert(/<SavedGridCard/.test(tab), "rows render the grid card");
  assert(!/SavedSimpleCardRow|SavedCuratedCardRow/.test(tab), "the old list rows are gone");
  // Virtualisation settings and the ORCH-1189 clearance survive the grid.
  assert(/data=\{filteredCards\}/.test(tab));
  assert(/keyExtractor=\{keyExtractor\}/.test(tab));
  assert(/windowSize=\{ISSUE_1636_WINDOW_SIZE\}/.test(tab));
  assert(/contentContainerStyle=\{dynamicStyles\.mainScrollContent\}/.test(tab));
  // Two equal columns inside 16pt edges with a 12pt gap.
  assert(/\(windowWidth - L\.grid\.sidePadding \* 2 - L\.grid\.columnGap\) \/ SAVED_GRID_COLUMNS/.test(tab));
  const tokens = await read("src/constants/designSystem.ts");
  assert(/sidePadding: 16,\s*columnGap: 12,\s*rowGap: 20,/.test(tokens), "grid tokens are 16 / 12 / 20");
  assert(/photoAspectRatio: 4 \/ 5,\s*photoRadius: 16,/.test(tokens), "photo is 4:5 with 16pt corners");
  // Loading is the card-shaped skeleton, not a spinner.
  assert(/<SavedGridSkeleton/.test(tab));
  assert(!/ActivityIndicator size="large"/.test(tab), "the Likes spinner is back");
});

// ── 2. Primary label logic ─────────────────────────────────────────────────

Deno.test("#4265 primary button: Schedule / Tickets / In calendar / Find similar", () => {
  const base = { isScheduled: false, isEnded: false, isTicketed: false };
  assertEquals(resolveSavedPrimaryAction(base), "schedule");
  assertEquals(resolveSavedPrimaryAction({ ...base, isTicketed: true }), "tickets");
  assertEquals(resolveSavedPrimaryAction({ ...base, isScheduled: true }), "inCalendar");
  // Booked beats tickets: the button quiets down once it is in the calendar.
  assertEquals(resolveSavedPrimaryAction({ ...base, isScheduled: true, isTicketed: true }), "inCalendar");
  // Ended beats everything.
  assertEquals(resolveSavedPrimaryAction({ isScheduled: true, isEnded: true, isTicketed: true }), "findSimilar");
  assertEquals(resolveSavedPrimaryAction({ ...base, isEnded: true }), "findSimilar");
});

Deno.test("#4265 ticketed + ended detection never guesses", () => {
  assert(isSavedCardTicketed({ purchaseOptions: [{ id: "p" }] }, false));
  assert(!isSavedCardTicketed({ purchaseOptions: [] }, false));
  assert(!isSavedCardTicketed({}, false));
  assert(isSavedCardTicketed({}, true), "a brand event sells tickets through its Book path");

  const now = Date.parse("2026-11-03T12:00:00Z");
  assert(isSavedEventEnded({ masterEndAtUtc: "2026-11-03T11:00:00Z" }, now));
  assert(!isSavedEventEnded({ masterEndAtUtc: "2026-11-03T13:00:00Z" }, now));
  // Start only: over once a 6 h window has passed, not the moment it starts.
  assert(!isSavedEventEnded({ masterDateUtc: "2026-11-03T09:00:00Z" }, now));
  assert(isSavedEventEnded({ masterDateUtc: "2026-11-03T05:00:00Z" }, now));
  // No date → never "ended" (Constitution #9).
  assert(!isSavedEventEnded({}, now));
  assert(!isSavedEventEnded({ masterDateUtc: "not a date" }, now));
  assert(!isSavedEventEnded(null, now));
});

Deno.test("#4265 a recurring or multi-date saved experience is not ended while a later date is ahead", () => {
  const now = new Date("2026-11-03T12:00:00Z").getTime();
  // First (master) date passed, the next date is still ahead → still on sale.
  assert(!isSavedEventEnded({
    masterDateUtc: "2026-10-01T18:00:00Z",
    masterEndAtUtc: "2026-10-01T21:00:00Z",
    nextStartAtUtc: "2026-11-10T18:00:00Z",
    nextEndAtUtc: "2026-11-10T21:00:00Z",
  }, now));
  // Only the occurrence list knows the later date.
  assert(!isSavedEventEnded({
    masterDateUtc: "2026-10-01T18:00:00Z",
    upcomingOccurrences: [
      { startAt: "2026-10-01T18:00:00Z", endAt: "2026-10-01T21:00:00Z" },
      { startAt: "2026-11-20T18:00:00Z", endAt: "2026-11-20T21:00:00Z" },
    ],
  }, now));
  // Every date passed → ended.
  assert(isSavedEventEnded({
    masterDateUtc: "2026-10-01T18:00:00Z",
    nextStartAtUtc: "2026-10-15T18:00:00Z",
    nextEndAtUtc: "2026-10-15T21:00:00Z",
    upcomingOccurrences: [{ startAt: "2026-10-20T18:00:00Z", endAt: "2026-10-20T21:00:00Z" }],
  }, now));
  // A recurring rule can always add a date → never ended from a snapshot.
  assert(!isSavedEventEnded({ masterDateUtc: "2026-10-01T18:00:00Z", isRecurring: true }, now));
  // No dates anywhere → not ended.
  assert(!isSavedEventEnded({ nextStartAtUtc: null, upcomingOccurrences: [] }, now));
});

Deno.test("#4265 the grid card maps each action to its own label, a11y text and gate", async () => {
  const card = stripComments(await read("src/components/activity/SavedGridCard.tsx"));
  for (const key of ["tickets", "inCalendar", "findSimilar", "schedule", "a11yTickets", "a11yInCalendar", "a11yFindSimilar", "a11ySchedule", "a11yShare", "a11yRemove", "a11yOpen"]) {
    assert(card.includes(`"activity:savedTab.${key}"`), `grid card no longer uses savedTab.${key}`);
  }
  // In calendar is disabled; Find similar / In calendar use the quiet style.
  assert(/const primaryDisabled = primaryAction === "inCalendar" \|\| isScheduling;/.test(card));
  assert(/const quiet = primaryAction === "inCalendar" \|\| primaryAction === "findSimilar";/.test(card));
  // Ended cards are dimmed to 60 %.
  assert(/isEnded && styles\.ended/.test(card));
  const tokens = await read("src/constants/designSystem.ts");
  assert(/endedOpacity: 0\.6,/.test(tokens));
  // Every button has a real role and a 44pt-class target.
  assert((card.match(/accessibilityRole="button"/g) ?? []).length >= 5);
  assert(/hitTarget: 44,/.test(tokens));
  // The tab routes each action through the EXISTING paths.
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(/onPurchaseFromSaved\(card, card\.purchaseOptions\[0\]\)/.test(tab), "Tickets reuses onPurchase");
  assert(/if \(isCuratedPlan\(card\)\) handleScheduleCurated\(card\);/.test(tab), "plans keep the Mingla+ gate");
  assert(/case "findSimilar":\s*onExplore\?\.\(\);/.test(tab), "Find similar goes to Explore");
  assert(/if \(!canAccess\('curated_cards'\)\)/.test(tab), "curated Mingla+ gate survives");
});

// ── 3. Heart remove + Undo restores ────────────────────────────────────────

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

Deno.test("#4265 heart remove waits out the Undo window; Undo restores", () => {
  assertEquals(SAVED_UNDO_WINDOW_MS, 3000);
  const clock = fakeClock();
  const committed: string[] = [];
  const removals = createPendingRemovalController<{ title: string }>({
    delayMs: SAVED_UNDO_WINDOW_MS,
    onCommit: (id) => committed.push(id),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  removals.schedule("a", { title: "Rooftop jazz" });
  assert(removals.isPending("a"));
  clock.advance(2000);
  assertEquals(committed, [], "nothing is deleted inside the Undo window");
  assert(removals.undo("a"), "Undo inside the window restores the card");
  clock.advance(5000);
  assertEquals(committed, [], "an undone removal never reaches the server");
  assert(!removals.undo("a"), "a second Undo is a no-op");

  removals.schedule("b", { title: "Brunch" });
  clock.advance(3000);
  assertEquals(committed, ["b"], "after the window the delete is committed once");

  removals.schedule("c", { title: "Pottery" });
  removals.flushAll();
  assertEquals(committed, ["b", "c"], "leaving Likes still honours a pending heart tap");
  clock.advance(10_000);
  assertEquals(committed, ["b", "c"], "flushed removals do not commit twice");
});

Deno.test("#4265 the tab hides, toasts Undo, and restores through the controller", async () => {
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(/!hiddenCardIds\.has\(card\.id\) &&/.test(tab), "a hearted card leaves the grid at once");
  assert(/pendingRemovalsRef\.current\.schedule\(card\.id, card\)/.test(tab));
  assert(/label: t\('common:undo'\)/.test(tab), "the toast carries Undo");
  assert(/if \(pendingRemovalsRef\.current\.undo\(card\.id\)\) \{[\s\S]*?unhideCard\(card\.id\);/.test(tab), "Undo puts it back");
  assert(/pending\.flushAll\(\);/.test(tab), "unmount commits pending removals");
  assert(/await savedCardsService\.removeCard\(/.test(tab), "the commit is the same service call as the old bin");
  assert(/unhideCard\(card\.id\);\s*toastManager\.error\(t\('activity:savedTab\.couldntRemove'\)/.test(tab), "a failed delete restores and says so");
  const toast = stripComments(await read("src/components/ui/Toast.tsx"));
  assert(/show\(message: string, type: ToastType = "info", duration\?: number, action\?: ToastAction\)/.test(toast));
});

// ── 4. Quick-slot computation from opening hours ───────────────────────────

const WEEK = [
  "Monday: Closed",
  "Tuesday: 5:00 PM – 11:00 PM",
  "Wednesday: Closed",
  "Thursday: 11:00 AM – 3:00 PM",
  "Friday: 6:00 PM – 2:00 AM",
  "Saturday: 10:00 AM – 11:00 PM",
  "Sunday: Closed",
];
const openAt = (weekdayText: string[]) => (at: Date) => isPlaceOpenAt(weekdayText, at, null);
const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

Deno.test("#4265 quick slots = the next four open times, one per day, closed days skipped", () => {
  // Monday 2 Nov 2026, 10:00 device-local.
  const now = new Date(2026, 10, 2, 10, 0, 0, 0);
  assertEquals(now.getDay(), 1);
  const weekdayText = extractWeekdayText({ weekdayDescriptions: WEEK });
  assert(weekdayText && weekdayText.length === 7);
  const { slots } = computeQuickSlots({ now, isOpenAt: openAt(weekdayText) });
  assertEquals(slots.length, 4);
  assertEquals(slots.map((s) => s.dayOffset), [1, 3, 4, 5], "Mon, Wed and Sun are closed and skipped");
  assertEquals(slots.map((s) => s.at.getDay()), [2, 4, 5, 6]);
  assertEquals(slots.map((s) => hhmm(s.at)), ["19:30", "12:00", "19:30", "19:30"]);
  for (const slot of slots) {
    assertEquals(isPlaceOpenAt(weekdayText, slot.at, null), true, `${slot.at.toString()} must be open`);
  }
  assertEquals(quickSlotDayLabel(slots[0]), "tomorrow");
  assertEquals(quickSlotDayLabel(slots[1]), "weekday");
});

Deno.test("#4265 quick slots respect the lead time and fall back to unusual hours", () => {
  // Tuesday 19:15 — 7:30 PM is inside the 30-minute lead, so tonight is 8:30 PM.
  const tuesdayEvening = new Date(2026, 10, 3, 19, 15, 0, 0);
  const week = extractWeekdayText({ weekdayDescriptions: WEEK })!;
  const tonight = computeQuickSlots({ now: tuesdayEvening, isOpenAt: openAt(week) }).slots[0];
  assertEquals(tonight.dayOffset, 0);
  assertEquals(hhmm(tonight.at), "20:30");
  assertEquals(quickSlotDayLabel(tonight), "tonight");

  // A 6–8 AM bakery has none of the preferred times: first open half hour.
  const bakery = ["Monday: 6:00 AM – 8:00 AM", "Tuesday: 6:00 AM – 8:00 AM", "Wednesday: 6:00 AM – 8:00 AM", "Thursday: 6:00 AM – 8:00 AM", "Friday: 6:00 AM – 8:00 AM", "Saturday: Closed", "Sunday: Closed"];
  const early = computeQuickSlots({ now: new Date(2026, 10, 2, 10, 0), isOpenAt: openAt(bakery) });
  assertEquals(early.slots.map((s) => hhmm(s.at)), ["6:00", "6:00", "6:00", "6:00"]);
  assertEquals(early.slots.map((s) => s.at.getDay()), [2, 3, 4, 5]);

  // Hours that never open in the horizon → no tiles (the sheet says so).
  const alwaysClosed = computeQuickSlots({ now: new Date(2026, 10, 2, 10, 0), isOpenAt: () => false });
  assertEquals(alwaysClosed.slots.length, 0);
  // Unknown answers are never offered as a confirmed open time.
  const unknown = computeQuickSlots({ now: new Date(2026, 10, 2, 10, 0), isOpenAt: () => null });
  assertEquals(unknown.slots.length, 0);
});

Deno.test("#4265 unknown hours → Schedule opens the full picker, never dead default tiles", async () => {
  // Pure rule: the quick sheet needs hours for the place, or for EVERY stop.
  assertEquals(resolveScheduleEntry([true]), "quickSheet");
  assertEquals(resolveScheduleEntry([false]), "fullPicker");
  assertEquals(resolveScheduleEntry([true, true, true]), "quickSheet", "plan with hours on every stop");
  assertEquals(resolveScheduleEntry([true, false, true]), "fullPicker", "one stop without hours fails the check for any time");
  assertEquals(resolveScheduleEntry([]), "fullPicker");

  // The model no longer invents tonight 7:30 / Sat 12 slots for unknown hours.
  const model = stripComments(await read("src/components/activity/savedGridModel.ts"));
  assert(!/computeDefaultQuickSlots|hasHours|source:/.test(model), "default-slot fallback is back");

  // SavedTab routes both Schedule paths (place + Mingla+-gated plan) through the rule.
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(/resolveScheduleEntry\(scheduleHoursKnown\(card\)\) === "quickSheet"/.test(tab));
  assert(/setShowScheduleSheet\(true\);\s*\} else \{\s*setShowProposeDateTimeModal\(true\);/.test(tab), "unknown hours opens the full picker");
  assert(/stops as CuratedStop\[\]\)\.map\(\(stop\) => hasKnownHours\(stop\.openingHours\)\)/.test(tab), "plans check every stop");
  const curated = tab.slice(tab.indexOf("const handleScheduleCurated"), tab.indexOf("const getCurrentScheduledDate"));
  assert(curated.indexOf("canAccess('curated_cards')") > -1, "plans keep the Mingla+ gate");
  assert(curated.indexOf("canAccess('curated_cards')") < curated.indexOf("openScheduleEntry(card)"), "gate runs before any sheet or picker");
  const single = tab.slice(tab.indexOf("const handleSchedule = "), tab.indexOf("const checkAllStopsOpen"));
  assert(/openScheduleEntry\(card\);/.test(single));
  assert(!/setShowScheduleSheet\(true\)/.test(single + curated), "no path opens the quick sheet unconditionally");

  // The sheet keeps only the open-times subtitle and the "no open times" + picker path.
  const sheet = stripComments(await read("src/components/activity/SavedScheduleSheet.tsx"));
  assert(!/sheetSubtitleDefault/.test(sheet));
  assert(/activity:savedTab\.sheetNoTimes/.test(sheet));
  assert(/onPickAnother\(\)/.test(sheet));
});

Deno.test("#4265 a slot pick runs the existing scheduling path", async () => {
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(/handleProposeDateTime\(at, "custom"\);/.test(tab), "slot pick → existing hours check → proceedWithScheduling");
  assert(/checkSingleCardSchedulingAvailability\(cardToSchedule, at, locale\)/.test(tab), "tiles use the same validator as the pick");
  assert(/checkAllStopsOpen\(stops, at\)\.allOpen/.test(tab), "plans validate every stop");
  assert(/setShowProposeDateTimeModal\(true\);/.test(tab), "Pick another date and time opens the full picker");
  assert(/toastManager\.success\(t\('activity:savedTab\.addedToCalendar'\), 3000\)/.test(tab));
  // proceedWithScheduling still removes the saved card and writes both calendars.
  assert(/CalendarService\.addEntryFromSavedCard\(/.test(tab));
  assert(/DeviceCalendarService\.addEventToDeviceCalendar\(deviceEvent\)/.test(tab));
});

// ── 5. Coach step 3 uses i18n keys ─────────────────────────────────────────

Deno.test("#4265 coach step 3 copy is i18n-keyed and carries the Likes preview", async () => {
  const step3 = COACH_STEPS.find((s) => s.id === 3);
  assert(step3);
  assertEquals(step3.tab, "home", "still spotlights the Likes tab from home");
  assertEquals(step3.titleKey, "modals:coach.step3.title");
  assertEquals(step3.descriptionKey, "modals:coach.step3.description");
  assertEquals(step3.illustration, "likesPreview");
  assertEquals(COACH_STEPS.filter((s) => s.illustration).map((s) => s.id), [3], "only step 3 has an illustration");
  assertEquals(COACH_STEPS.length, 12, "the tour keeps its 12 steps");

  const english = JSON.parse(await read("src/i18n/locales/en/modals.json"));
  assertEquals(english.coach.step3.title, "Where your saves live");
  assertEquals(english.coach.step3.description, "Everything you heart lands in Likes. Share it or put it in your calendar in one tap.");
  assertEquals(step3.title, english.coach.step3.title, "the fallback matches the English key");
  for (const locale of LOCALES) {
    const modals = JSON.parse(await read(`src/i18n/locales/${locale}/modals.json`));
    for (const field of ["title", "description"]) {
      const value = modals.coach?.step3?.[field];
      assert(typeof value === "string" && value.trim().length > 0, `${locale} coach.step3.${field} missing`);
      if (locale !== "en") assert(value !== english.coach.step3[field], `${locale} coach.step3.${field} is untranslated`);
    }
  }
  const overlay = stripComments(await read("src/components/SpotlightOverlay.tsx"));
  assert(/currentStepConfig\.illustration === 'likesPreview' \? <CoachLikesPreview \/> : null/.test(overlay));
});

// ── i18n: every new Likes string in all 29 locales ─────────────────────────

const NEW_SAVED_KEYS = ["kindEvent", "kindPlace", "tickets", "inCalendar", "findSimilar", "eventEnded", "closedNow", "removedToast", "addedToCalendar", "a11yOpen", "a11yShare", "a11yRemove", "a11ySchedule", "a11yTickets", "a11yInCalendar", "a11yFindSimilar", "a11yMoreHint", "menuShare", "menuRemove", "sheetTitle", "sheetSubtitleOpen", "sheetNoTimes", "sheetPickAnother", "slotToday", "slotTonight", "slotTomorrow", "a11ySlot", "emptyBody", "emptyCta"] as const;
const PLURAL_STEMS = ["countSaved", "kindPlan"] as const;
const RETIRED = ["buyNow", "scheduled", "schedulePlan", "soloDiscovery", "recentlySaved", "placeClosed", "emptySubtitle", "scheduledToast", "stops", "avg", "sheetSubtitleDefault"] as const;
const placeholders = (v: string) => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join("|");

Deno.test("#4265 the new Likes strings are complete in all 29 locales", async () => {
  const en = JSON.parse(await read("src/i18n/locales/en/activity.json")).savedTab;
  for (const locale of LOCALES) {
    const saved = JSON.parse(await read(`src/i18n/locales/${locale}/activity.json`)).savedTab;
    let localized = 0;
    for (const key of NEW_SAVED_KEYS) {
      const value = saved[key];
      assert(typeof value === "string" && value.trim().length > 0, `${locale} savedTab.${key} missing`);
      assertEquals(placeholders(value), placeholders(en[key]), `${locale} savedTab.${key} placeholders`);
      if (locale !== "en" && value !== en[key]) localized += 1;
    }
    for (const stem of PLURAL_STEMS) {
      const expected = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((c) => `${stem}_${c}`).sort();
      const actual = Object.keys(saved).filter((k) => k.startsWith(`${stem}_`)).sort();
      assertEquals(actual, expected, `${locale} ${stem} plural categories`);
      for (const key of actual) assert(saved[key].includes("{{count}}"), `${locale} ${key} must show the count`);
    }
    for (const key of RETIRED) assert(!(key in saved), `${locale} still carries retired savedTab.${key}`);
    if (locale !== "en") assert(localized >= NEW_SAVED_KEYS.length - 4, `${locale} looks untranslated (${localized})`);
  }
  // Curated "Schedule Plan" / "Scheduled" literals are gone from the Likes code.
  const tab = await read("src/components/activity/SavedTab.tsx");
  const card = await read("src/components/activity/SavedGridCard.tsx");
  for (const src of [tab, card]) {
    assert(!/'Schedule Plan'|'Scheduled'|"Schedule Plan"/.test(stripComments(src)), "hard-coded curated label is back");
  }
});
