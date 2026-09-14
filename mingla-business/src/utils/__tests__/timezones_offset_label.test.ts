/**
 * Timezone field + picker offsets (event / experience / RSVP When step, venue
 * Availability card).
 *
 * The shipped bug, seen on an iOS production build: a Brooklyn event's field
 * read "America/New_York (GMT)" and every picker row read "GMT", from a list
 * of only ~70 zones. Two Hermes facts caused it, both proven on the RN 0.81.5
 * hermes.framework inside an iOS simulator:
 *   - `Intl.supportedValuesOf` is undefined, so the picker used a short
 *     curated fallback;
 *   - Hermes-iOS `formatToParts` splits "GMT-4" on punctuation, so the
 *     `timeZoneName` part of a `shortOffset` format is a bare "GMT".
 * And a third, engine-independent one: the offset was computed for today, so a
 * November New York event labelled in September said GMT-4 instead of GMT-5.
 *
 * Node runs these on V8, which has neither Hermes quirk — so the Hermes cases
 * install a faithful stand-in for Hermes-iOS's `DateTimeFormat` (same
 * tokenising algorithm as DateTimeFormatApple::formatToParts) before loading a
 * fresh copy of the module.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  formatGmtOffset,
  formatTimezoneLabel,
  formatTimezoneOffset,
  getAllTimezones,
  getTimezoneOffsetMinutes,
  listIanaTimezones,
  whenStepTimezoneReference,
} from "../timezones";

type TimezonesModule = typeof import("../timezones");

const RealIntl = Intl;
const RealDateTimeFormat = Intl.DateTimeFormat;

interface FakeRuntime {
  /** Throw RangeError for `timeZoneName: "shortOffset"` (older engines). */
  shortOffsetUnsupported?: boolean;
  /** No `formatToParts` at all. */
  noFormatToParts?: boolean;
  /** Zone names the runtime refuses (RangeError), like an older OS tz table. */
  refusedZones?: readonly string[];
}

/**
 * Stand-in for Hermes on iOS. `format()` is the real string; `formatToParts()`
 * reproduces Hermes's algorithm: split the string into alphanumeric runs and
 * single punctuation characters, and type the runs by position. A field whose
 * value contains punctuation ("GMT-4", "GMT+5:30") is therefore cut into
 * pieces and only its first piece carries the field's type.
 */
const makeHermesLikeIntl = (runtime: FakeRuntime): typeof Intl => {
  class HermesLikeDateTimeFormat {
    private readonly real: Intl.DateTimeFormat;

    constructor(
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (
        runtime.shortOffsetUnsupported === true &&
        options?.timeZoneName === "shortOffset"
      ) {
        throw new RangeError("Invalid timeZoneName: shortOffset");
      }
      const zone = options?.timeZone;
      if (zone !== undefined && (runtime.refusedZones ?? []).includes(zone)) {
        throw new RangeError(`Invalid time zone: ${zone}`);
      }
      this.real = new RealDateTimeFormat(locales, options);
      if (runtime.noFormatToParts === true) {
        (this as { formatToParts?: unknown }).formatToParts = undefined;
      }
    }

    format(date?: Date | number): string {
      return this.real.format(date);
    }

    resolvedOptions(): Intl.ResolvedDateTimeFormatOptions {
      return this.real.resolvedOptions();
    }

    formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
      const fieldTypes = this.real
        .formatToParts(date)
        .filter((p) => p.type !== "literal")
        .map((p) => p.type);
      const parts: Intl.DateTimeFormatPart[] = [];
      let run = "";
      let field = 0;
      const flush = (): void => {
        if (run === "") return;
        parts.push({ type: fieldTypes[field] ?? "literal", value: run });
        field += 1;
        run = "";
      };
      for (const ch of this.real.format(date)) {
        if (/[\p{L}\p{N}]/u.test(ch)) {
          run += ch;
        } else {
          flush();
          parts.push({ type: "literal", value: ch });
        }
      }
      flush();
      return parts;
    }
  }
  return Object.create(RealIntl, {
    DateTimeFormat: { value: HermesLikeDateTimeFormat },
    supportedValuesOf: { value: undefined },
  }) as typeof Intl;
};

/** Load a fresh copy of the module (empty caches) under a fake runtime. */
const loadUnderRuntime = (runtime: FakeRuntime): TimezonesModule => {
  (globalThis as { Intl: typeof Intl }).Intl = makeHermesLikeIntl(runtime);
  let mod: TimezonesModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual<TimezonesModule>("../timezones");
  });
  if (mod === undefined) throw new Error("module did not load");
  return mod;
};

afterEach(() => {
  (globalThis as { Intl: typeof Intl }).Intl = RealIntl;
});

const at = (iso: string): Date => new Date(iso);

describe("the offset is the one in force at the date given", () => {
  test("a DST zone reads its summer and winter offsets", () => {
    expect(formatTimezoneOffset("America/New_York", at("2026-07-15T16:00:00Z"))).toBe("GMT-4");
    expect(formatTimezoneOffset("America/New_York", at("2026-12-15T17:00:00Z"))).toBe("GMT-5");
    expect(formatTimezoneOffset("Europe/London", at("2026-07-15T12:00:00Z"))).toBe("GMT+1");
    expect(formatTimezoneOffset("Europe/London", at("2026-12-15T12:00:00Z"))).toBe("GMT+0");
    expect(getTimezoneOffsetMinutes("America/New_York", at("2026-12-15T17:00:00Z"))).toBe(-300);
  });

  test("a 6 Nov New York event says GMT-5 even when labelled in September", () => {
    // DST ends 1 Nov 2026. The organiser is typing on 12 Sep.
    expect(
      formatTimezoneLabel("America/New_York", {
        localDate: "2026-11-06",
        localTime: "20:00",
      }),
    ).toBe("America/New_York (GMT-5)");
    expect(
      formatTimezoneLabel("America/New_York", {
        localDate: "2026-09-20",
        localTime: "20:00",
      }),
    ).toBe("America/New_York (GMT-4)");
  });

  test("a local time either side of the spring-forward switch resolves in its own zone", () => {
    // 8 Mar 2026: New York jumps 02:00 EST → 03:00 EDT.
    expect(
      formatTimezoneOffset("America/New_York", { localDate: "2026-03-08", localTime: "01:30" }),
    ).toBe("GMT-5");
    expect(
      formatTimezoneOffset("America/New_York", { localDate: "2026-03-08", localTime: "03:30" }),
    ).toBe("GMT-4");
    // No time yet → midday, clear of the switch.
    expect(formatTimezoneOffset("America/New_York", { localDate: "2026-03-08" })).toBe("GMT-4");
  });

  test("Lagos is GMT+1 all year", () => {
    expect(formatTimezoneLabel("Africa/Lagos", at("2026-01-15T12:00:00Z"))).toBe("Africa/Lagos (GMT+1)");
    expect(formatTimezoneLabel("Africa/Lagos", at("2026-07-15T12:00:00Z"))).toBe("Africa/Lagos (GMT+1)");
  });

  test("half- and quarter-hour zones keep their minutes", () => {
    expect(formatTimezoneOffset("Asia/Kolkata", at("2026-09-12T12:00:00Z"))).toBe("GMT+5:30");
    expect(formatTimezoneOffset("Asia/Kathmandu", at("2026-09-12T12:00:00Z"))).toBe("GMT+5:45");
    expect(formatTimezoneOffset("America/St_Johns", at("2026-12-15T12:00:00Z"))).toBe("GMT-3:30");
  });

  test("UTC is GMT+0", () => {
    expect(formatTimezoneLabel("UTC", at("2026-09-12T12:00:00Z"))).toBe("UTC (GMT+0)");
  });

  test("an unknown zone or unreadable date gives no offset rather than a wrong one", () => {
    expect(formatTimezoneOffset("Mars/Olympus_Mons", at("2026-09-12T12:00:00Z"))).toBe("");
    expect(formatTimezoneLabel("Mars/Olympus_Mons")).toBe("Mars/Olympus_Mons");
    expect(formatTimezoneOffset("Europe/London", new Date("not a date"))).toBe("");
    expect(formatTimezoneOffset("Europe/London", { localDate: "12/09/2026" })).toBe("");
  });

  test("the GMT formatter", () => {
    expect(formatGmtOffset(0)).toBe("GMT+0");
    expect(formatGmtOffset(-0)).toBe("GMT+0");
    expect(formatGmtOffset(60)).toBe("GMT+1");
    expect(formatGmtOffset(-300)).toBe("GMT-5");
    expect(formatGmtOffset(330)).toBe("GMT+5:30");
    expect(formatGmtOffset(-570)).toBe("GMT-9:30");
    expect(formatGmtOffset(840)).toBe("GMT+14");
  });

  test("every zone the picker offers agrees with the engine's own offset, in three seasons", () => {
    // Oracle: V8's shortOffset, which Node formats correctly ("GMT" = +0).
    const instants = [at("2026-01-15T12:00:00Z"), at("2026-07-15T12:00:00Z"), at("2026-11-06T20:00:00Z")];
    const mismatches: string[] = [];
    let checked = 0;
    for (const zone of listIanaTimezones()) {
      let oracle: Intl.DateTimeFormat;
      try {
        oracle = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" });
      } catch {
        continue; // this Node's ICU predates the zone
      }
      for (const instant of instants) {
        const expected = oracle.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value;
        const normalised = expected === "GMT" ? "GMT+0" : expected;
        const actual = formatTimezoneOffset(zone, instant);
        checked += 1;
        if (actual !== normalised) mismatches.push(`${zone} @ ${instant.toISOString()}: ${actual} vs ${normalised}`);
      }
    }
    expect(mismatches).toEqual([]);
    // Vacuity guard: the loop really covered the world.
    expect(checked).toBeGreaterThan(400 * instants.length);
  });
});

describe("on a Hermes-like runtime", () => {
  test("the shipped symptom is real: reading shortOffset's timeZoneName part yields a bare GMT", () => {
    // Guards the stand-in itself — if it stopped reproducing Hermes, the tests
    // below would pass for the wrong reason.
    const HermesIntl = makeHermesLikeIntl({});
    const parts = new HermesIntl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    }).formatToParts(at("2026-09-12T16:00:00Z"));
    expect(parts.find((p) => p.type === "timeZoneName")?.value).toBe("GMT");
  });

  test("the field and every picker row show real offsets", () => {
    const tz = loadUnderRuntime({});
    const nov6 = { localDate: "2026-11-06", localTime: "20:00" };
    expect(tz.formatTimezoneLabel("America/New_York", nov6)).toBe("America/New_York (GMT-5)");
    expect(tz.formatTimezoneLabel("Africa/Lagos", nov6)).toBe("Africa/Lagos (GMT+1)");
    expect(tz.formatTimezoneLabel("Asia/Kolkata", nov6)).toBe("Asia/Kolkata (GMT+5:30)");
    expect(tz.formatTimezoneLabel("UTC", nov6)).toBe("UTC (GMT+0)");
    const offsets = tz.getAllTimezones().map((zone) => tz.formatTimezoneOffset(zone, nov6));
    expect(offsets.filter((o) => o === "" || o === "GMT")).toEqual([]);
  });

  test("a runtime without shortOffset support still labels correctly", () => {
    const tz = loadUnderRuntime({ shortOffsetUnsupported: true });
    expect(tz.formatTimezoneOffset("America/New_York", at("2026-07-15T16:00:00Z"))).toBe("GMT-4");
    expect(tz.formatTimezoneOffset("America/New_York", at("2026-12-15T17:00:00Z"))).toBe("GMT-5");
    expect(tz.formatTimezoneOffset("Africa/Lagos", at("2026-12-15T17:00:00Z"))).toBe("GMT+1");
    expect(tz.formatTimezoneOffset("Asia/Kolkata", at("2026-12-15T17:00:00Z"))).toBe("GMT+5:30");
    expect(tz.formatTimezoneOffset("UTC", at("2026-12-15T17:00:00Z"))).toBe("GMT+0");
  });

  test("a runtime without formatToParts reads the plain string instead", () => {
    const tz = loadUnderRuntime({ noFormatToParts: true });
    expect(tz.formatTimezoneOffset("America/New_York", at("2026-12-15T17:00:00Z"))).toBe("GMT-5");
    expect(tz.formatTimezoneOffset("Asia/Kolkata", at("2026-12-15T17:00:00Z"))).toBe("GMT+5:30");
    // Midnight wall clock on the far side of the date line.
    expect(tz.formatTimezoneOffset("Pacific/Kiritimati", at("2026-12-15T10:00:00Z"))).toBe("GMT+14");
  });

  test("the picker offers the whole world, not the ~70-zone fallback", () => {
    const tz = loadUnderRuntime({});
    const offered = tz.getAllTimezones();
    expect(offered.length).toBeGreaterThanOrEqual(400);
    expect(offered[0]).toBe("Africa/Abidjan");
    for (const zone of ["UTC", "Africa/Lagos", "America/New_York", "America/Detroit", "Asia/Kathmandu", "Europe/London"]) {
      expect(offered).toContain(zone);
    }
    expect(new Set(offered).size).toBe(offered.length);
    // Real IANA region/location names only — no offsets, no legacy single tokens.
    expect(offered.filter((z) => z !== "UTC" && !/^[A-Z][A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(z))).toEqual([]);
  });

  test("a zone the OS does not know is dropped, or offered under its previous name", () => {
    const tz = loadUnderRuntime({ refusedZones: ["Europe/Kyiv", "America/Coyhaique"] });
    const offered = tz.getAllTimezones();
    expect(offered).not.toContain("Europe/Kyiv");
    expect(offered).toContain("Europe/Kiev");
    expect(offered).not.toContain("America/Coyhaique");
  });
});

describe("the web keeps the engine's own list", () => {
  test("Intl.supportedValuesOf wins when the runtime has it", () => {
    expect(getAllTimezones()).toEqual(
      [...(Intl as typeof Intl & { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")].sort(),
    );
  });
});

describe("which moment the When step labels", () => {
  const base = { whenMode: "single", date: null, doorsOpen: null, multiDates: null };

  test("nothing picked yet → no reference (label at now)", () => {
    expect(whenStepTimezoneReference(base)).toBeNull();
  });

  test("single and recurring use the date and doors time", () => {
    expect(whenStepTimezoneReference({ ...base, date: "2026-11-06", doorsOpen: "20:00" })).toEqual({
      localDate: "2026-11-06",
      localTime: "20:00",
    });
    expect(
      whenStepTimezoneReference({ ...base, whenMode: "recurring", date: "2026-11-06", doorsOpen: null }),
    ).toEqual({ localDate: "2026-11-06", localTime: null });
  });

  test("multi-date uses the earliest date, whatever order the list is in", () => {
    const schedule = {
      ...base,
      whenMode: "multi_date",
      date: "2026-09-01",
      multiDates: [
        { date: "2026-11-20", startTime: "19:00" },
        { date: "2026-11-06", startTime: "21:00" },
        { date: "2026-11-06", startTime: "18:00" },
      ],
    };
    expect(whenStepTimezoneReference(schedule)).toEqual({ localDate: "2026-11-06", localTime: "18:00" });
    expect(whenStepTimezoneReference({ ...schedule, multiDates: [] })).toBeNull();
    // The RSVP wizard renders only the single body.
    expect(whenStepTimezoneReference(schedule, true)).toEqual({ localDate: "2026-09-01", localTime: null });
  });
});
