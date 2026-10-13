/**
 * @jest-environment ./jest.issue3801.timezone-env.cjs
 *
 * Issue #3801 — a trip's start, end and fixed balance date read the SAME
 * calendar day in every timezone, on web and in the native picker.
 *
 * THE BUG. These are calendar dates stored at UTC (`2026-11-12T00:00:00.000Z`,
 * an end at `…T23:59:59.000Z`, a balance `2026-10-29`). Three formatters read
 * them with the device's local clock, so a browser in New York showed
 * 11 November and 28 October. On native the picker was seeded with the shifted
 * day, so tapping Done without touching the wheel moved the start back a day.
 *
 * THE FIX. One helper (`utils/calendarDate`) reads and writes these values at
 * UTC; the Step 1 date fields, the native picker seed, the payment plan editor
 * and the instalment schedule all use it.
 *
 * HOW THIS PROVES IT. The process timezone is switched to New York (and to
 * Lagos and Kiritimati) through the timezone environment named above — inside
 * a test `process.env` is Jest's sandbox copy, so assigning `TZ` there does
 * nothing — and the test first PROVES the switch took effect by showing the
 * naive local read is wrong there. Then the REAL
 * `TripCreatorStep1Basics` source is compiled and mounted against an explicit
 * module boundary (the #3439 / #1780 compiled-creator pattern), once as web
 * and once as iOS, and the real `PaymentPlanEditor` / `InstallmentScheduleDisplay`
 * sources are checked through the helper they now call.
 *
 * Fails on revert: restore the local-clock body of `isoToHtml5Date` (or seed
 * the picker with `new Date(iso)`) -> red under America/New_York.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import * as calendarDate from "../../../utils/calendarDate";
import { projectInstallmentSchedule } from "../../../utils/installmentScheduleProjection";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_DIR = path.resolve(__dirname, "..");

// The stored values of production trip 2385da2f….
const START = "2026-11-12T00:00:00.000Z";
const END = "2026-11-16T23:59:59.000Z";
const BALANCE = "2026-10-29";

// Supplied by jest.issue3801.timezone-env.cjs, which also restores the
// original zone when this file finishes.
const setZone = (zone: string): void => {
  (
    globalThis as unknown as { __setProcessTimeZone: (zone: string) => void }
  ).__setProcessTimeZone(zone);
};

const ZONES = ["America/New_York", "Africa/Lagos", "Pacific/Kiritimati"] as const;

// ---------------------------------------------------------------------------
// module boundary for the REAL Step 1 source
// ---------------------------------------------------------------------------

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const nothing = (): null => null;

function boundaryFor(os: "web" | "ios"): Record<string, () => unknown> {
  const reactNative = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    react: () => React,
    "react-native": () => ({
      ...reactNative,
      Platform: { ...(reactNative.Platform as Record<string, unknown>), OS: os },
    }),
    "@mingla/location-input": () => ({ precisionFromPlaceDetails: () => null }),
    "@react-native-community/datetimepicker": () => ({
      __esModule: true,
      default: leaf("DateTimePickerProbe"),
    }),
    designSystem: () => designSystem,
    // REAL: the helper under test.
    calendarDate: () => calendarDate,
    Button: () => ({ Button: leaf("ButtonProbe") }),
    useBrands: () => ({
      useBrand: () => ({ data: undefined, isLoading: false, isError: false }),
    }),
    ThemeControlRow: () => ({ ThemeControlRow: nothing }),
    ThemeSheet: () => ({ ThemeSheet: nothing }),
    MapboxAddressInput: () => ({ MapboxAddressInput: nothing }),
    resolveApproxLocation: () => ({
      advanceLocationRequestGeneration: (): void => undefined,
      isFreeTextResolveStale: () => false,
      isLocationRequestGenerationCurrent: () => true,
      resolveFreeTextLocation: async () => null,
    }),
    tripLocationValidated: () => jest.requireActual("../tripLocationValidated"),
    CoverPickerSheet: () => ({ CoverPickerSheet: nothing }),
    EventCoverMedia: () => ({ EventCoverMedia: nothing }),
  };
}

function loadStep1(os: "web" | "ios"): React.ComponentType<Record<string, unknown>> {
  const boundary = boundaryFor(os);
  const output = ts.transpileModule(
    fs.readFileSync(path.join(TRIP_DIR, "TripCreatorStep1Basics.tsx"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = boundary[specifier] ?? boundary[key];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified TripCreatorStep1Basics boundary: ${specifier}`);
  };
  const module = {
    exports: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
  };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.TripCreatorStep1Basics;
}

const baseDraft = {
  title: "Lagos long weekend",
  startAt: START as string | null,
  endAt: END as string | null,
  destinationPlaceId: null,
  destinationLocationText: null,
  destinationLat: null,
  destinationLng: null,
  departurePlaceId: null,
  departureLocationText: null,
  departureLat: null,
  departureLng: null,
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  themeOverrides: null,
};

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

interface Harness {
  tree: Renderer;
  draft: () => typeof baseDraft;
  patches: Record<string, unknown>[];
}

/** Step 1 is controlled; the harness owns the draft the way the wizard does. */
async function mountStep1(os: "web" | "ios"): Promise<Harness> {
  const Step1 = loadStep1(os);
  let draft = { ...baseDraft };
  const patches: Record<string, unknown>[] = [];
  let tree!: Renderer;
  const element = (): React.ReactElement => (
    <Step1
      draft={draft}
      onChange={(patch: Record<string, unknown>) => {
        patches.push(patch);
        draft = { ...draft, ...patch };
        tree.update(element());
      }}
      brandId="brand-3801"
      tripEventId="evt-3801"
    />
  );
  await act(async () => {
    tree = TestRenderer.create(element());
  });
  mounted.push(tree);
  return { tree, draft: () => draft, patches };
}

const webInput = (tree: Renderer, testId: string): TestInstance => {
  const found = tree.root.findAll(
    (node) => node.type === "input" && node.props["data-testid"] === testId,
  );
  expect(found).toHaveLength(1);
  return found[0];
};

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------

describe("#3801 — the timezone switch is real (so the rest of this file means something)", () => {
  test("in New York the naive local read of the stored start is the day before", () => {
    setZone("America/New_York");
    expect(localDay(new Date(START))).toBe("2026-11-11");
  });

  test("in Kiritimati the naive local read of the stored end is the day after", () => {
    setZone("Pacific/Kiritimati");
    expect(localDay(new Date(END))).toBe("2026-11-17");
  });

  test("in Lagos the naive local read of the stored end is the day after too", () => {
    setZone("Africa/Lagos");
    expect(localDay(new Date(END))).toBe("2026-11-17");
    expect(new Date().getTimezoneOffset()).toBe(-60);
  });
});

describe("#3801 — the helper reads the stored calendar day in every timezone", () => {
  test.each(ZONES)("%s: start, end and balance keep their day", (zone) => {
    setZone(zone);
    expect(calendarDate.calendarDateToInputValue(START)).toBe("2026-11-12");
    expect(calendarDate.calendarDateToInputValue(END)).toBe("2026-11-16");
    expect(calendarDate.calendarDateToInputValue(BALANCE)).toBe("2026-10-29");
    expect(calendarDate.formatCalendarDate(START, undefined, "en-US")).toBe("Nov 12, 2026");
    expect(calendarDate.formatCalendarDate(END, undefined, "en-US")).toBe("Nov 16, 2026");
    expect(calendarDate.formatCalendarDate(BALANCE, undefined, "en-US")).toBe("Oct 29, 2026");
    // The native picker gets a LOCAL day equal to the stored day…
    const seed = calendarDate.calendarDateToPickerDate(START);
    expect(seed).not.toBeNull();
    expect(localDay(seed as Date)).toBe("2026-11-12");
    // …and confirming it unchanged writes back exactly what was stored.
    expect(calendarDate.pickerDateToCalendarIso(seed as Date, false)).toBe(START);
    const endSeed = calendarDate.calendarDateToPickerDate(END) as Date;
    expect(localDay(endSeed)).toBe("2026-11-16");
    expect(calendarDate.pickerDateToCalendarIso(endSeed, true)).toBe(END);
  });

  test("nothing stored, or nonsense, reads as no date rather than a made-up one", () => {
    for (const value of [null, undefined, "", "   ", "not a date", "2026-02-30"]) {
      expect(calendarDate.readCalendarDate(value)).toBeNull();
      expect(calendarDate.calendarDateToInputValue(value)).toBe("");
      expect(calendarDate.formatCalendarDate(value)).toBe("");
      expect(calendarDate.calendarDateToPickerDate(value)).toBeNull();
    }
    expect(calendarDate.inputValueToCalendarIso("", false)).toBeNull();
    expect(calendarDate.inputValueToCalendarIso("12/11/2026", false)).toBeNull();
  });
});

describe("#3801 — Step 1 on web", () => {
  test("under America/New_York the start field reads 2026-11-12 and the end field 2026-11-16", async () => {
    setZone("America/New_York");
    const { tree } = await mountStep1("web");
    expect(webInput(tree, "trip-step1-start-web").props.value).toBe("2026-11-12");
    expect(webInput(tree, "trip-step1-end-web").props.value).toBe("2026-11-16");
    // The end date cannot be set before the start: its floor is the start day.
    expect(webInput(tree, "trip-step1-end-web").props.min).toBe("2026-11-12");
  });

  test.each(ZONES)("%s: the fields read the stored days", async (zone) => {
    setZone(zone);
    const { tree } = await mountStep1("web");
    expect(webInput(tree, "trip-step1-start-web").props.value).toBe("2026-11-12");
    expect(webInput(tree, "trip-step1-end-web").props.value).toBe("2026-11-16");
  });

  test("typing a start after the end moves the end to that same day, not the day before", async () => {
    setZone("America/New_York");
    const harness = await mountStep1("web");
    await act(async () => {
      (
        webInput(harness.tree, "trip-step1-start-web").props.onChange as (e: {
          target: { value: string };
        }) => void
      )({ target: { value: "2026-11-20" } });
    });
    expect(harness.draft().startAt).toBe("2026-11-20T00:00:00.000Z");
    expect(harness.draft().endAt).toBe("2026-11-20T23:59:59.000Z");
    expect(webInput(harness.tree, "trip-step1-start-web").props.value).toBe("2026-11-20");
    expect(webInput(harness.tree, "trip-step1-end-web").props.value).toBe("2026-11-20");
  });
});

describe("#3801 — Step 1 on native (iOS picker)", () => {
  const openPicker = async (tree: Renderer, testID: string): Promise<TestInstance> => {
    const button = tree.root.findAll(
      (node) => typeof node.type !== "string" && node.props.testID === testID,
    );
    expect(button).toHaveLength(1);
    await act(async () => {
      (button[0].props.onPress as () => void)();
    });
    const picker = tree.root.findAll((node) => node.type === "DateTimePickerProbe");
    expect(picker).toHaveLength(1);
    return picker[0];
  };
  const tapDone = async (tree: Renderer): Promise<void> => {
    const done = tree.root.findAll(
      (node) => node.type === "ButtonProbe" && node.props.label === "Done",
    );
    expect(done).toHaveLength(1);
    await act(async () => {
      (done[0].props.onPress as () => void)();
    });
  };
  const buttonText = (tree: Renderer, testID: string): string => {
    const button = tree.root.findAll(
      (node) => typeof node.type !== "string" && node.props.testID === testID,
    )[0];
    return button
      .findAll((node) => node.type === "Text")
      .map((node) => String(node.props.children))
      .join("");
  };

  test.each(ZONES)("%s: the picker opens on the stored day, and Done without a change keeps it", async (zone) => {
    setZone(zone);
    const harness = await mountStep1("ios");

    const startPicker = await openPicker(harness.tree, "trip-step1-start");
    expect(localDay(startPicker.props.value as Date)).toBe("2026-11-12");
    await tapDone(harness.tree);
    expect(harness.draft().startAt).toBe(START);
    expect(harness.draft().endAt).toBe(END);

    const endPicker = await openPicker(harness.tree, "trip-step1-end");
    expect(localDay(endPicker.props.value as Date)).toBe("2026-11-16");
    // The end picker cannot go before the start day.
    expect(localDay(endPicker.props.minimumDate as Date)).toBe("2026-11-12");
    await tapDone(harness.tree);
    expect(harness.draft().endAt).toBe(END);
    expect(harness.draft().startAt).toBe(START);
  });

  test("a picked day is written as that calendar day at UTC", async () => {
    setZone("America/New_York");
    const harness = await mountStep1("ios");
    const picker = await openPicker(harness.tree, "trip-step1-start");
    await act(async () => {
      (picker.props.onChange as (event: { type: string }, selected: Date) => void)(
        { type: "set" },
        // What the wheel hands back: a LOCAL day, at whatever local time.
        new Date(2026, 10, 14, 21, 30, 0, 0),
      );
    });
    await tapDone(harness.tree);
    expect(harness.draft().startAt).toBe("2026-11-14T00:00:00.000Z");
    expect(harness.draft().endAt).toBe(END);
  });

  test("the date buttons show the stored days", async () => {
    setZone("America/New_York");
    const { tree } = await mountStep1("ios");
    expect(buttonText(tree, "trip-step1-start")).toContain("12");
    expect(buttonText(tree, "trip-step1-start")).not.toContain("11,");
    expect(buttonText(tree, "trip-step1-end")).toContain("16");
  });
});

describe("#3801 — the balance date (payment plan fixed_date)", () => {
  const tierWithFixedBalance = {
    priceCents: 120000,
    currency: "USD",
    installmentSchedule: {
      deposit_pct: 25,
      installments: [{ ordinal: 1, pct: 75, fixed_date: BALANCE }],
    },
  };
  const tierWithOffset = {
    priceCents: 120000,
    currency: "USD",
    installmentSchedule: {
      deposit_pct: 25,
      installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
    },
  };

  test("under America/New_York 2026-10-29 reads Oct 29, where the local read said Oct 28", () => {
    setZone("America/New_York");
    const naive = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${BALANCE}T00:00:00.000Z`));
    expect(naive).toBe("Oct 28, 2026");
    expect(calendarDate.formatCalendarDate(BALANCE, undefined, "en-US")).toBe("Oct 29, 2026");
  });

  test("the schedule projection marks a fixed date as a calendar date, and an offset as a real moment", () => {
    const anchor = new Date("2026-10-14T01:30:00.000Z");
    const fixed = projectInstallmentSchedule(tierWithFixedBalance, anchor);
    expect(fixed?.installments[0].dueAt).toBe("2026-10-29T00:00:00.000Z");
    expect(fixed?.installments[0].dueIsCalendarDate).toBe(true);
    const offset = projectInstallmentSchedule(tierWithOffset, anchor);
    expect(offset?.installments[0].dueIsCalendarDate).toBeUndefined();
  });

  test("the editor and the schedule display format a fixed date through the calendar helper", () => {
    const editor = fs.readFileSync(path.join(TRIP_DIR, "PaymentPlanEditor.tsx"), "utf8");
    const body = editor.slice(
      editor.indexOf("function formatDateForDisplay("),
      editor.indexOf("function todayPlusDays("),
    );
    expect(body).toContain("formatCalendarDate(iso)");
    expect(body).not.toContain("new Date(");
    // The native picker is seeded with, and writes back, a local day.
    expect(editor).toContain("calendarDateToPickerDate(inst.fixed_date ?? null)");
    expect(editor).toContain("pickerDateToInputValue(selected)");
    expect(editor).not.toContain("selected.toISOString().slice(0, 10)");

    const display = fs.readFileSync(
      path.join(TRIP_DIR, "InstallmentScheduleDisplay.tsx"),
      "utf8",
    );
    expect(display).toContain("label: formatDueDate(inst)");
    expect(display).toMatch(
      /inst\.dueIsCalendarDate === true\) \{\s*const label = formatCalendarDate\(inst\.dueAt\)/,
    );
  });
});
