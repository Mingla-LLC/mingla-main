/**
 * Issue #1503 [stay-date-pickers] — implementor happy-path regression suite for
 * `stayDateRules.ts`, the ONE module that owns every Stay date computation.
 * SPEC §10.1 (T-1…T-12) + §10.3 source pins (T-19…T-23). Append-only: NEW file,
 * modifies and deletes nothing.
 *
 * WHY THIS SUITE EXISTS. Every Stay date is a VENUE-LOCAL calendar date, and the
 * server compares it against `(now() AT TIME ZONE stay_settings.timezone)::date`.
 * The shipped guest form disagreed: it seeded defaults with `setUTCDate` +
 * `toISOString().slice(0, 10)`, so a guest in Los Angeles at 18:00 opened a form
 * pre-filled TWO days past their own tomorrow. A date bug that only appears in
 * one timezone is the exact historical failure mode here, so this suite is run
 * three times — `TZ=UTC`, `TZ=America/New_York`, `TZ=Pacific/Auckland`.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION, not a comment-out):
 *   - restore the UTC seed (`setUTCDate` + `toISOString().slice(0,10)`) in
 *     `venueToday`            -> T-4, T-5 RED
 *   - change `parseStayDate`'s anchor from noon (12) to midnight (0)
 *                             -> T-1 RED
 *   - swap `formatStayDate`'s local getters for UTC getters
 *                             -> T-2, T-3 RED
 *   - drop the horizon clamp / the min-notice walk in `stayDateBounds`
 *                             -> T-6, T-7, T-9 RED
 *   - revert the `Field` swap in StayGuestBooking.tsx
 *                             -> T-19, T-20 RED
 *   - delete StayDateRangeField.native.tsx (web build pulls the native picker)
 *                             -> T-22 RED
 *
 * Run: cd mingla-business && npx jest --config jest.issue1503.cfg.cjs --runInBand
 *
 * INVARIANTS: I-PROPOSED-1503-STAY-DATE-IS-VENUE-LOCAL-YMD,
 *             I-PROPOSED-1503-STAY-DATES-ARE-PICKED-NOT-TYPED.
 */

import fs from "node:fs";
import path from "node:path";

import {
  addStayDays,
  applyCheckInChange,
  applyCheckOutChange,
  compareStayDates,
  formatStayDate,
  isStayDate,
  MAX_STAY_NIGHTS,
  nightsBetween,
  parseStayDate,
  stayDateBounds,
  stayDateErrorMessage,
  venueToday,
} from "../stayDateRules";

const PACKAGE_DIR = path.join(__dirname, "..");
const readPackageFile = (name: string): string =>
  fs.readFileSync(path.join(PACKAGE_DIR, name), "utf8");

/**
 * Comments are DOCUMENTATION, not behaviour. `stayDateRules.ts` deliberately
 * names `toISOString` / `setUTCDate` / `getUTCDate` in its protective header so
 * the next reader knows exactly what is forbidden and why, and
 * `StayGuestBooking.tsx` names the deleted `isoDateFromOffset` in the comment
 * that explains the fix. A pin that matched those would punish the very
 * documentation the SPEC requires, so the token assertions run against CODE
 * only. Mirrors the `stripComments` helper in
 * `.github/scripts/strict-grep/i-1047-biz-bundle-budget-deferral.mjs`.
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const NY = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
const LA = "America/Los_Angeles";

describe("#1503 T-1…T-3 · parse / format never drift", () => {
  test("T-1 noon anchoring: parseStayDate lands at 12:00 local on the named day", () => {
    const parsed = parseStayDate("2026-03-08");
    expect(parsed).not.toBeNull();
    const date = parsed as Date;
    // 2026-03-08 is the US spring-forward day. Noon is >10h from either
    // midnight, so no transition can roll the calendar day.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(8);
    // THE noon pin. Re-anchoring at midnight makes this line RED.
    expect(date.getHours()).toBe(12);
  });

  test("T-2 round-trip is the identity across 400 consecutive days (two DST transitions)", () => {
    // Starts 2026-01-01 and runs past both US/EU transitions and the southern
    // hemisphere pair, whichever the host TZ happens to observe.
    let cursor = "2026-01-01";
    const seen: string[] = [];
    for (let day = 0; day < 400; day += 1) {
      const parsed = parseStayDate(cursor);
      expect(parsed).not.toBeNull();
      expect(formatStayDate(parsed as Date)).toBe(cursor);
      seen.push(cursor);
      cursor = addStayDays(cursor, 1);
    }
    // Vacuity guard: the loop really walked 400 DISTINCT days and finished a
    // year and a bit later, so an early `break` or a frozen cursor cannot pass.
    expect(new Set(seen).size).toBe(400);
    expect(seen[0]).toBe("2026-01-01");
    expect(cursor).toBe("2027-02-05");
  });

  test("T-3 no UTC drift: a date survives the round-trip whatever the host TZ is", () => {
    for (const value of ["2026-08-04", "2026-01-01", "2026-12-31", "2028-02-29"]) {
      const parsed = parseStayDate(value);
      expect(parsed).not.toBeNull();
      expect(formatStayDate(parsed as Date)).toBe(value);
    }
    // Vacuity guard: prove the host TZ is actually being exercised, i.e. the
    // assertions above are not passing because Date is stubbed out.
    expect(typeof Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("string");
  });
});

describe("#1503 T-4…T-5 · venueToday is VENUE-local, not UTC and not device-local", () => {
  test("T-4 America/New_York at 2026-08-04T01:00Z is still 2026-08-03", () => {
    expect(venueToday(NY, new Date(Date.UTC(2026, 7, 4, 1, 0, 0)))).toBe(
      "2026-08-03",
    );
  });

  test("T-5 Pacific/Auckland at 2026-08-03T22:00Z is already 2026-08-04", () => {
    expect(venueToday(AUCKLAND, new Date(Date.UTC(2026, 7, 3, 22, 0, 0)))).toBe(
      "2026-08-04",
    );
  });

  test("the Los Angeles 18:00 case from the issue: tomorrow is +1, never +2", () => {
    // 2026-08-04T01:00Z is 2026-08-03 18:00 PDT. UTC has already rolled to the
    // 4th. The OLD code returned 2026-08-05 for "tomorrow"; venue-local is the
    // 4th. This single assertion is the user-facing defect.
    const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
    expect(venueToday(LA, now)).toBe("2026-08-03");
    expect(addStayDays(venueToday(LA, now), 1)).toBe("2026-08-04");
  });

  test("T-10 an unusable IANA name falls back to UTC instead of throwing", () => {
    const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));
    expect(() => venueToday("Not/AZone", now)).not.toThrow();
    expect(venueToday("Not/AZone", now)).toBe("2026-08-04");
    expect(venueToday("Not/AZone", now)).toBe(venueToday("UTC", now));
  });
});

describe("#1503 T-6…T-9 · the range rules match the server's guards", () => {
  const now = new Date(Date.UTC(2026, 7, 4, 1, 0, 0)); // NY: 2026-08-03 21:00
  const base = {
    timezone: NY,
    checkInTime: "15:00:00",
    bookingHorizonDays: 365,
    maxAdvanceDays: null as number | null,
    minNoticeMinutes: 0,
    checkIn: null as string | null,
    now,
  };

  test("T-6 the horizon clamps to the TIGHTEST of venue horizon and offering advance", () => {
    const bounds = stayDateBounds({ ...base, maxAdvanceDays: 30 });
    expect(bounds.minCheckIn).toBe("2026-08-03");
    expect(bounds.maxCheckIn).toBe(addStayDays("2026-08-03", 30));
    // Vacuity guard: without the clamp the answer would be today + 365.
    expect(bounds.maxCheckIn).not.toBe(addStayDays("2026-08-03", 365));
  });

  test("T-7 the horizon is INCLUSIVE — today+N passes, today+N+1 does not", () => {
    const edge = stayDateBounds({
      ...base,
      maxAdvanceDays: 30,
      checkIn: addStayDays("2026-08-03", 30),
    });
    expect(edge.error).toBeNull();
    const past = stayDateBounds({
      ...base,
      maxAdvanceDays: 30,
      checkIn: addStayDays("2026-08-03", 31),
    });
    expect(past.error).toBe("check_in_beyond_horizon");
  });

  test("T-8 check-out must be STRICTLY after check-in", () => {
    const same = stayDateBounds({
      ...base,
      checkIn: "2026-08-10",
      checkOut: "2026-08-10",
    });
    expect(same.error).toBe("checkout_not_after_checkin");
    const backwards = stayDateBounds({
      ...base,
      checkIn: "2026-08-10",
      checkOut: "2026-08-09",
    });
    expect(backwards.error).toBe("checkout_not_after_checkin");
    const oneNight = stayDateBounds({
      ...base,
      checkIn: "2026-08-10",
      checkOut: "2026-08-11",
    });
    expect(oneNight.error).toBeNull();
    expect(oneNight.minCheckOut).toBe("2026-08-11");
  });

  test("T-9 minimum notice advances the floor by a whole venue-local day", () => {
    // Venue-local 2026-08-03 10:00 EDT, 24h notice, 15:00 check-in: today's
    // 15:00 is only 5h away, so the earliest bookable check-in is tomorrow.
    const bounds = stayDateBounds({
      ...base,
      now: new Date(Date.UTC(2026, 7, 3, 14, 0, 0)),
      minNoticeMinutes: 1440,
    });
    expect(bounds.minCheckIn).toBe("2026-08-04");
    // Vacuity guard: with no notice requirement the floor is today.
    expect(
      stayDateBounds({ ...base, now: new Date(Date.UTC(2026, 7, 3, 14, 0, 0)) })
        .minCheckIn,
    ).toBe("2026-08-03");
  });

  test("a check-in before venue-local today is rejected as past, not as horizon", () => {
    const bounds = stayDateBounds({ ...base, checkIn: "2026-08-02" });
    expect(bounds.error).toBe("check_in_in_past");
  });

  test("a stay longer than 365 nights is rejected", () => {
    const bounds = stayDateBounds({
      ...base,
      checkIn: "2026-08-10",
      checkOut: addStayDays("2026-08-10", MAX_STAY_NIGHTS + 1),
    });
    expect(bounds.error).toBe("stay_too_long");
    expect(bounds.maxCheckOut).toBe(addStayDays("2026-08-10", MAX_STAY_NIGHTS));
  });

  test("every bounds error carries the exact SPEC §6 copy", () => {
    const bounds = stayDateBounds({ ...base, maxAdvanceDays: 30 });
    expect(stayDateErrorMessage("check_in_in_past", bounds)).toBe(
      "Choose a date from today onward.",
    );
    expect(stayDateErrorMessage("checkout_not_after_checkin", bounds)).toBe(
      "Check-out must be after check-in.",
    );
    expect(stayDateErrorMessage("check_in_too_soon", bounds)).toBe(
      "This Stay needs more notice. Choose a later date.",
    );
    expect(stayDateErrorMessage("stay_too_long", bounds)).toBe(
      "Stays can be up to 365 nights.",
    );
    expect(stayDateErrorMessage("check_in_beyond_horizon", bounds)).toBe(
      `This Stay takes bookings up to ${bounds.maxCheckIn}.`,
    );
    expect(stayDateErrorMessage(null, bounds)).toBeNull();
  });
});

describe("#1503 T-11…T-12 · calendar arithmetic and validation", () => {
  test("T-11 isStayDate rejects dates that do not exist", () => {
    expect(isStayDate("2026-02-31")).toBe(false);
    expect(isStayDate("2026-13-01")).toBe(false);
    expect(isStayDate("2026-00-10")).toBe(false);
    expect(isStayDate("2027-02-29")).toBe(false);
    expect(isStayDate("2026-8-4")).toBe(false);
    expect(isStayDate("2026-08-04T00:00:00Z")).toBe(false);
    expect(isStayDate("")).toBe(false);
    expect(isStayDate(20260804)).toBe(false);
    // Vacuity guard: real dates still pass, so this is not rejecting everything.
    expect(isStayDate("2026-08-04")).toBe(true);
    expect(isStayDate("2028-02-29")).toBe(true);
  });

  test("T-12 addStayDays crosses both DST transitions without losing a day", () => {
    expect(addStayDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addStayDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addStayDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addStayDays("2026-09-26", 1)).toBe("2026-09-27");
    expect(addStayDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addStayDays("2026-08-04", -1)).toBe("2026-08-03");
    expect(addStayDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  test("compareStayDates and nightsBetween agree with the SQL night expansion", () => {
    expect(compareStayDates("2026-08-04", "2026-08-05")).toBeLessThan(0);
    expect(compareStayDates("2026-08-05", "2026-08-04")).toBeGreaterThan(0);
    expect(compareStayDates("2026-08-04", "2026-08-04")).toBe(0);
    // check-out is EXCLUSIVE: Aug 4 -> Aug 6 is two nights (the 4th and 5th).
    expect(nightsBetween("2026-08-04", "2026-08-06")).toBe(2);
    expect(nightsBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(nightsBetween("2026-11-01", "2026-11-03")).toBe(2);
  });
});

describe("#1503 · range editing keeps an invalid range off the screen", () => {
  test("moving check-in to or past check-out CLEARS check-out", () => {
    const range = { checkIn: "2026-08-04", checkOut: "2026-08-06" };
    expect(applyCheckInChange(range, "2026-08-06")).toEqual({
      checkIn: "2026-08-06",
      checkOut: "",
    });
    expect(applyCheckInChange(range, "2026-08-07")).toEqual({
      checkIn: "2026-08-07",
      checkOut: "",
    });
    // …but a check-in that still precedes check-out keeps it.
    expect(applyCheckInChange(range, "2026-08-05")).toEqual({
      checkIn: "2026-08-05",
      checkOut: "2026-08-06",
    });
  });

  test("clearing either control is legal and never throws", () => {
    const range = { checkIn: "2026-08-04", checkOut: "2026-08-06" };
    expect(() => applyCheckInChange(range, "")).not.toThrow();
    expect(applyCheckInChange(range, "")).toEqual({ checkIn: "", checkOut: "" });
    expect(applyCheckOutChange(range, "")).toEqual({
      checkIn: "2026-08-04",
      checkOut: "",
    });
    expect(
      stayDateBounds({
        timezone: NY,
        checkInTime: "15:00:00",
        bookingHorizonDays: 365,
        maxAdvanceDays: null,
        minNoticeMinutes: 0,
        checkIn: "",
        checkOut: "",
        now: new Date(Date.UTC(2026, 7, 4, 1, 0, 0)),
      }).error,
    ).toBeNull();
  });
});

describe("#1503 T-19…T-23 · source pins (the swap cannot be silently reverted)", () => {
  test("T-19 StayGuestBooking.tsx has no UTC date maths left in it", () => {
    const source = codeOnly(readPackageFile("StayGuestBooking.tsx"));
    // Vacuity guard: we really read the component, not an empty string.
    expect(source).toContain("export function StayGuestBooking");
    expect(source).not.toContain("isoDateFromOffset");
    expect(source).not.toContain("toISOString");
    expect(source).not.toContain("setUTCDate");
    expect(source).not.toContain("getUTCDate");
    expect(/new Date\(\s*["']\d{4}-\d{2}-\d{2}["']\s*\)/.test(source)).toBe(false);
  });

  test("T-20 StayGuestBooking.tsx renders the picker, not a typed Field", () => {
    const source = codeOnly(readPackageFile("StayGuestBooking.tsx"));
    expect(source).toContain("<StayDateRangeField");
    expect(source).not.toContain('label="Check-in"');
    expect(source).not.toContain('label="Check-out"');
    // The guest identity fields still use Field — proving the pin is targeted
    // at the DATE rows and not just asserting Field is gone entirely.
    expect(source).toContain('label="Guest name"');
    expect(source).toContain("function Field(");
    // The venue-local seed replaced the UTC one.
    expect(source).toContain("venueToday(detail.timezone)");
  });

  test("T-22 the native picker lives ONLY in the .native.tsx half of the split", () => {
    const web = codeOnly(readPackageFile("StayDateRangeField.tsx"));
    const native = codeOnly(readPackageFile("StayDateRangeField.native.tsx"));
    expect(web).toContain("export function StayDateRangeField");
    expect(native).toContain("export function StayDateRangeField");
    expect(web).not.toContain("@react-native-community/datetimepicker");
    expect(native).toContain("@react-native-community/datetimepicker");
    // The SC-8 tripwire string must EXIST in the native half, otherwise the
    // web-export grep that proves the split holds would be vacuously green.
    // Runtime-attached (`nativeID` on the root View) so a minifier cannot
    // dead-code it away — an unused exported const IS eliminated, and a grep
    // for an eliminated string proves nothing.
    expect(native).toContain("stay-date-range-field-native-only-1503");
    expect(native).toContain("nativeID={STAY_DATE_RANGE_FIELD_NATIVE_MARKER}");
    expect(web).not.toContain("stay-date-range-field-native-only-1503");
    // The web half must render a REAL, visible input — never the banned hidden
    // input + showPicker()/.click() bridge (I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT).
    expect(web).toContain('type="date"');
    expect(web).not.toContain("showPicker");
    expect(web).not.toContain(".click()");
    expect(web).not.toContain('pointerEvents: "none"');
    // A FULLY transparent control is the banned mechanism; the 0.55 dim on the
    // disabled check-out row is a legitimate affordance, so match only a literal
    // zero, never `0.55`.
    expect(web).not.toMatch(/opacity:\s*0(?![.\d])/);
  });

  test("T-23 the package stays self-contained and UTC-free", () => {
    for (const name of [
      "stayDateRules.ts",
      "StayDateRangeField.tsx",
      "StayDateRangeField.native.tsx",
    ]) {
      const source = codeOnly(readPackageFile(name));
      expect(source.length).toBeGreaterThan(200); // vacuity guard
      expect(source).not.toMatch(/from\s+["'][^"']*mingla-business\/src/);
      expect(source).not.toMatch(/from\s+["'][^"']*app-mobile\/src/);
      expect(source).not.toContain("toISOString");
      expect(source).not.toContain("setUTCDate");
      expect(source).not.toContain("getUTCDate");
      expect(/new Date\(\s*["']\d{4}-\d{2}-\d{2}["']\s*\)/.test(source)).toBe(
        false,
      );
    }
  });
});
