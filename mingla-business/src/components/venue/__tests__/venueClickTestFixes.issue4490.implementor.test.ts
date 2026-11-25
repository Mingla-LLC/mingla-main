/**
 * #4490 P1 click-test fixes — the pure rules behind D2, D4, D5, D9, D10, D11,
 * D14, D20–D26 and D30. Every test runs the real function; none reads source.
 */
import { describe, expect, it } from "@jest/globals";

import {
  dayDateLabel,
  monthGrid,
  normalizeTime24,
  parseDayDateInput,
  shiftMonth,
  timeOptions,
} from "../../ui/fieldModels";
import { featureSavedLine, otherChangedFeatures } from "../features/featureSwitchModel";
import { closedDayCopy, windowsSummary } from "../features/hoursModel";
import { starterSetting } from "../features/spaceModel";
import {
  chosenStartingFeatures,
  toggleStartingFeature,
  typeStartingFeatures,
  usualHeading,
  wizardFeatureRows,
} from "../features/wizardFeaturesModel";
import { hoursWeekLines, phoneWithCode, priceRangeLabel, venueTypeLabel } from "../venueReviewModel";
import { venueSubmitErrorCopy } from "../venueSubmitErrors";
import { venueCreateCloseGoesBack, venueStepError } from "../venueWizardValidation";
import { featureSetFrom } from "../../../types/venueFeatures";
import type { BrandHourEntry } from "../../../types/brand";
import {
  normalizeHoursWeek,
  reconcileHoursForm,
  sameHoursWeek,
} from "../../../utils/venueBrandHours";
import type { DraftVenueState } from "../../../store/draftVenueStore";

function week(sunday: Partial<BrandHourEntry> = {}): BrandHourEntry[] {
  const rows: BrandHourEntry[] = [];
  for (let d = 0; d < 6; d++) rows.push({ weekday: d, openTime: "09:00:00", closeTime: "17:00:00", isClosed: false });
  rows.push({ weekday: 6, openTime: "09:00:00", closeTime: "17:00:00", isClosed: false, ...sunday });
  return rows;
}

describe("D20/D21/D22 — one 24-hour time, typed or picked", () => {
  it("reads typed times the way hosts type them, never with seconds", () => {
    expect(normalizeTime24("09:00:00")).toBe("09:00");
    expect(normalizeTime24("22:00")).toBe("22:00");
    expect(normalizeTime24("2200")).toBe("22:00");
    expect(normalizeTime24("0200")).toBe("02:00");
    expect(normalizeTime24("9")).toBe("09:00");
    expect(normalizeTime24("9:30")).toBe("09:30");
    expect(normalizeTime24("21.15")).toBe("21:15");
  });
  it("refuses what is not a time", () => {
    for (const bad of ["", "24:00", "12:60", "abc", "123456", "7pm"]) expect(normalizeTime24(bad)).toBeNull();
  });
  it("lists every half hour of the day, 24-hour", () => {
    const options = timeOptions();
    expect(options).toHaveLength(48);
    expect(options[0]).toEqual({ value: "00:00", label: "00:00" });
    expect(options[44]).toEqual({ value: "22:00", label: "22:00" });
    expect(options.some((o) => /AM|PM/.test(o.label))).toBe(false);
  });
  it("special days and the hours summary read 24-hour too", () => {
    expect(windowsSummary([{ open: "22:00:00", close: "02:00:00" }])).toBe("22:00–02:00 (next day)");
  });
});

describe("D25 — day-first dates, typed or clicked", () => {
  const today = "2026-11-18";
  it("labels a date day first", () => {
    expect(dayDateLabel("2026-12-25")).toBe("Fri 25 Dec 2026");
    expect(dayDateLabel("nope")).toBe("");
  });
  it("reads typed dates day first, never month first", () => {
    expect(parseDayDateInput("25/12/2026", today)).toBe("2026-12-25");
    expect(parseDayDateInput("05/12/2026", today)).toBe("2026-12-05");
    expect(parseDayDateInput("25.12.26", today)).toBe("2026-12-25");
    expect(parseDayDateInput("25 Dec 2026", today)).toBe("2026-12-25");
    expect(parseDayDateInput("Fri 25 Dec 2026", today)).toBe("2026-12-25");
    expect(parseDayDateInput("25 December", today)).toBe("2026-12-25");
    expect(parseDayDateInput("2026-12-25", today)).toBe("2026-12-25");
    expect(parseDayDateInput("12/25/2026", today)).toBeNull();
    expect(parseDayDateInput("31/02/2027", today)).toBeNull();
    expect(parseDayDateInput("soon", today)).toBeNull();
  });
  it("builds a Monday-first month to click", () => {
    const dec = monthGrid(2026, 12);
    // 1 Dec 2026 is a Tuesday: one blank Monday first.
    expect(dec[0]).toEqual([null, "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(dec.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(dec.every((w) => w.length === 7)).toBe(true);
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month1: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month1: 12 });
  });
  it("closed-day wording follows the features", () => {
    expect(closedDayCopy(false)).toBe("Guests see you as closed that day.");
    expect(closedDayCopy(true)).toContain("can't book a table");
  });
});

describe("D23/D26 — the hours form re-reads saved state and is clean after save", () => {
  it("treats the server's HH:mm:ss and the form's HH:mm as the same hours", () => {
    const server = week({ extraWindows: [{ openTime: "22:00:00", closeTime: "02:00:00" }] });
    const form = normalizeHoursWeek(server);
    expect(form[6].openTime).toBe("09:00");
    expect(form[6].extraWindows).toEqual([{ openTime: "22:00", closeTime: "02:00" }]);
    expect(sameHoursWeek(form, server)).toBe(true);
  });

  it("after Save, a stale cache never wipes window 2 and a fresh read leaves nothing unsaved", () => {
    const before = week();
    // The host adds 22:00–02:00 and saves; the form steps to what was saved.
    const saved = normalizeHoursWeek(week({ extraWindows: [{ openTime: "22:00", closeTime: "02:00" }] }));
    let form = { base: saved, draft: saved };
    expect(sameHoursWeek(form.draft, form.base)).toBe(true);
    // The refetch answers with the server's copy (seconds included).
    form = reconcileHoursForm(form, week({ extraWindows: [{ openTime: "22:00:00", closeTime: "02:00:00" }] }));
    expect(form.draft[6].extraWindows).toEqual([{ openTime: "22:00", closeTime: "02:00" }]);
    expect(sameHoursWeek(form.draft, form.base)).toBe(true);
    // The old bug: the form reset to the pre-save cache and stayed "unsaved".
    expect(sameHoursWeek(form.draft, before)).toBe(false);
  });

  it("a server answer while the host is mid-edit moves only the base", () => {
    const base = normalizeHoursWeek(week());
    const draft = normalizeHoursWeek(week({ isClosed: true, openTime: null, closeTime: null }));
    const next = reconcileHoursForm({ base, draft }, week({ openTime: "10:00:00" }));
    expect(next.draft).toBe(draft);
    expect(next.base[6].openTime).toBe("10:00");
  });
});

describe("D5 — the wizard's hours step takes split days", () => {
  it("accepts a second window past midnight and refuses overlaps", () => {
    const base = { hours: week({ extraWindows: [{ openTime: "22:00", closeTime: "02:00" }] }) } as unknown as DraftVenueState;
    expect(venueStepError("s2", base)).toBeNull();
    const overlap = { hours: week({ extraWindows: [{ openTime: "16:00", closeTime: "18:00" }] }) } as unknown as DraftVenueState;
    expect(venueStepError("s2", overlap)).toMatch(/overlap/);
  });
});

describe("D9 — the wizard's Features step", () => {
  it("a play venue starts with Entry, Menu and Events here, and can change any built switch", () => {
    // TEST-MOD-APPROVED #4490 — P2 ships Entry, so it is in the play preset now.
    // TEST-MOD-APPROVED #4490 P4 — group packages and private hire are built, so the play preset starts them too.
    expect(typeStartingFeatures("play")).toEqual(["entry", "group_packages", "private_hire", "menu", "events_here"]);
    const rows = wizardFeatureRows("play");
    // TEST-MOD-APPROVED #4490 P6-2 — the play preset lists table ordering (it never starts on) and memberships is built.
    expect(rows.usual).toEqual(["entry", "group_packages", "private_hire", "menu", "table_ordering", "events_here"]);
    // TEST-MOD-APPROVED #4490 P5-2 — by the hour, floor plan, pick a table and minimum-spend tables are built.
    // TEST-MOD-APPROVED #4490 07-I — Guest list is built and is an optional
    // starting feature for a play venue.
    expect(rows.more).toEqual(["by_the_hour", "table_reservations", "floor_plan", "pick_a_table", "min_spend_tables", "guest_list", "memberships", "waitlist"]);
    let on = chosenStartingFeatures("play", null);
    on = toggleStartingFeature(on, "menu", false);
    on = toggleStartingFeature(on, "waitlist", true);
    expect(on).toEqual(["entry", "group_packages", "private_hire", "events_here", "waitlist"]);
  });
  it("Table ordering never starts on (it waits for approval)", () => {
    // TEST-MOD-APPROVED #4490 P6-2 — cafes also start with entry (day passes), a room by the hour and events.
    expect(typeStartingFeatures("cafe")).toEqual(["entry", "by_the_hour", "menu", "events_here"]);
    expect(toggleStartingFeature(["menu"], "table_ordering", true)).toEqual(["menu"]);
  });
  it("the step says what the type usually uses, in plain words", () => {
    expect(usualHeading("play")).toBe("Usual for play and games venues");
    // TEST-MOD-APPROVED #4490 — coworking starts with Entry (day passes) now.
    // TEST-MOD-APPROVED #4490 P4 — coworking also starts with private hire (meeting rooms) now it is built.
    // TEST-MOD-APPROVED #4490 P5-2 — coworking starts with by the hour (meeting rooms) now it is built.
    // TEST-MOD-APPROVED #4490 P6-2 — coworking starts with memberships now they are built.
    expect(typeStartingFeatures("coworking")).toEqual(["entry", "by_the_hour", "private_hire", "memberships"]);
  });
  it("a Stay keeps every starting feature the host explicitly chose", () => {
    expect(
      chosenStartingFeatures("stay", [
        "entry",
        "private_hire",
        "menu",
        "memberships",
      ]),
    ).toEqual(["entry", "private_hire", "menu", "memberships"]);
  });
});

describe("D10 — the Review step in a host's words", () => {
  it("names the type in full", () => {
    expect(venueTypeLabel("play")).toBe("Play and games");
    expect(venueTypeLabel(null)).toBe("—");
  });
  it("formats money with the symbol and thousands", () => {
    expect(priceRangeLabel("5000", "25000", "NGN")).toBe("₦5,000 – ₦25,000");
    expect(priceRangeLabel("5000", "", "NGN")).toBe("From ₦5,000");
    expect(priceRangeLabel("", "", "NGN")).toBe("—");
  });
  it("shows the phone with its country code", () => {
    expect(phoneWithCode("+234", "08031234567")).toBe("+234 8031234567");
    expect(phoneWithCode("+234", "+2348031234567")).toBe("+2348031234567");
    expect(phoneWithCode("+234", "")).toBe("");
  });
  it("lists the hours, runs of days together", () => {
    const hours = week({ isClosed: true, openTime: null, closeTime: null });
    hours[0] = { ...hours[0], extraWindows: [{ openTime: "22:00", closeTime: "02:00" }] };
    expect(hoursWeekLines(hours)).toEqual([
      "Mon · 09:00–17:00, 22:00–02:00",
      "Tue to Sat · 09:00–17:00",
      "Sun · Closed",
    ]);
  });
});

describe("D11 — submit errors in plain words with a way forward", () => {
  it("a cover problem sends the host to Cover, never a raw code", () => {
    const copy = venueSubmitErrorCopy({ message: "invalid_cover_media_triplet", code: "P0001" });
    expect(copy.message).toBe("Your cover couldn't be saved. Pick your cover again, then submit.");
    expect(copy.step).toBe("s4");
    expect(copy.fixLabel).toBe("Go to Cover");
  });
  it("an unknown code becomes a retry line, never the code", () => {
    const copy = venueSubmitErrorCopy(new Error("tier2_pipeline_failed"));
    expect(copy.message).not.toMatch(/_/);
    expect(copy.message).toContain("submit again");
  });
  it("hours, network and permission each get their own way forward", () => {
    expect(venueSubmitErrorCopy(new Error("hours_must_have_7_rows")).step).toBe("s2");
    expect(venueSubmitErrorCopy(new TypeError("Failed to fetch")).message).toContain("connection dropped");
    expect(venueSubmitErrorCopy({ message: "not_authorized" }).message).toContain("brand owners and admins");
  });
});

describe("D4 — the add-venue X never looks dead", () => {
  it("goes back only to a real screen that is not another create screen", () => {
    expect(venueCreateCloseGoesBack(null)).toBe(false);
    expect(venueCreateCloseGoesBack("venue/create")).toBe(false);
    expect(venueCreateCloseGoesBack("(tabs)")).toBe(true);
    expect(venueCreateCloseGoesBack("venue/[venueId]/index")).toBe(true);
  });
});

describe("D14 — starters open with the right setting", () => {
  it("outdoor names start outdoor", () => {
    expect(starterSetting("Outdoor area")).toBe("outdoor");
    expect(starterSetting("Rooftop")).toBe("outdoor");
    expect(starterSetting("Main floor")).toBe("indoor");
    expect(starterSetting("Private room")).toBe("indoor");
  });
});

describe("D30 — every switch that moved is named", () => {
  it("names Waitlist when the server turned it on through the backfill rule", () => {
    const before = featureSetFrom({ menu: true });
    const after = featureSetFrom({ menu: true, table_reservations: true, waitlist: true });
    const others = otherChangedFeatures(before, after, "table_reservations", ["table_reservations"]);
    expect(others).toEqual(["waitlist"]);
    expect(featureSavedLine(after, others)).toBe("Saved. Waitlist turned on too.");
  });
  it("says off when the cascade turned things off", () => {
    const before = featureSetFrom({ menu: true, table_ordering: true });
    const after = featureSetFrom({});
    expect(featureSavedLine(after, otherChangedFeatures(before, after, "menu"))).toBe("Saved. Table ordering turned off too.");
  });
  it("plain Saved when nothing else moved", () => {
    const set = featureSetFrom({ menu: true });
    expect(featureSavedLine(set, otherChangedFeatures(set, set, "menu"))).toBe("Saved");
  });
});

// [TEST-MOD-APPROVED #4490] W3 fix 1: the Stay workspace round 4J source shape (D1, D3):
// the source-text pins moved to the additive gate .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047).
