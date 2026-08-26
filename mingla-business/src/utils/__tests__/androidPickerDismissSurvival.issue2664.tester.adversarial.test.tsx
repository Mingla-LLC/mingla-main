/**
 * #2664 [editing a sale window crashes on Android] — TESTER adversarial.
 * Append-only: NEW file. Modifies and deletes nothing.
 *
 * DIFFERENT AXIS FROM THE IMPLEMENTOR'S SUITES — read this before editing.
 *
 * The implementor's two suites assert the `mode` STRING at the render seam:
 * they stub `@react-native-community/datetimepicker` with an inert marker host
 * node and then compare `props.mode` to `"date"` / `"time"`. That proves the
 * prop. It does NOT prove the thing that actually crashed, because the marker
 * node has no unmount effect at all — the entire mechanism that threw in
 * production is mocked away.
 *
 * Production stack (Sentry MINGLA-BUSINESS-18, SM-A725F / Android 14):
 *
 *   TypeError: Cannot read property 'dismiss' of undefined
 *     at dismiss (DateTimePickerAndroid.android.js:136:31)
 *     at anonymous (datetimepicker.android.js:46:47)
 *     at commitHookEffectListUnmount (ReactFabric-prod.js:7583)
 *
 * The failure is a REGISTRY LOOKUP performed inside a React unmount effect.
 * So this suite does two things the implementor's cannot:
 *
 *  1. It DERIVES the Android picker registry from the REAL installed library
 *     source on disk (`src/constants.js` + `src/picker.android.js`) instead of
 *     hardcoding {date,time}. If the dependency is ever upgraded and the mode
 *     set changes, this suite re-derives rather than lying.
 *
 *  2. Its `DateTimePicker` stub RE-CREATES `datetimepicker.android.js:46`
 *     faithfully — `useEffect(() => () => dismiss(mode, design), [mode, design])`
 *     — and `dismiss` performs the real `pickers[mode].dismiss()` lookup. So
 *     unmounting the tree executes the production crash path THROUGH REACT'S
 *     OWN `commitHookEffectListUnmount`, not through a string comparison.
 *
 * Consequence: on a true revert to `mode="datetime"`, these tests do not fail
 * on an assertion — they fail by REPRODUCING THE PRODUCTION TypeError at the
 * exact frame Sentry recorded. That is the proof the seam-level tests cannot
 * give, and it is the closest a jest lane can get to the native unmount path.
 *
 * It additionally attacks the temporal parity traps the render-seam suites do
 * not reach: DST boundaries, 23:59/00:00, month-end and leap day, and seed
 * values carrying non-zero seconds and milliseconds.
 *
 * ANTI-VACUITY. T-1 is a positive control: it asserts the derived registry
 * genuinely THROWS for `datetime` and genuinely does NOT for `date`/`time`. If
 * the derivation silently produced an empty or permissive object, every other
 * test here would pass for the wrong reason — T-1 fails first and says so.
 *
 * FAILS-ON-REVERT (verify by TRUE LINE DELETION, not comment-out):
 *   - restore `mode="datetime"` on TicketTierEditSheet's Android picker
 *                                                  -> T-2, T-3, T-6 RED (TypeError)
 *   - restore `mode="datetime"` on BookingDeadlinePicker's picker
 *                                                  -> T-4, T-5 RED (TypeError)
 */

import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

/**
 * The stub that makes this suite adversarial rather than declarative.
 *
 * Everything inside the factory is `require`d locally because jest hoists
 * `jest.mock` above the imports; nothing here may close over module scope.
 */
jest.mock("@react-native-community/datetimepicker", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");

  /** Locate the REAL installed library source, walking up to node_modules. */
  const findLibSrc = (): string => {
    const rel = path.join(
      "node_modules",
      "@react-native-community",
      "datetimepicker",
      "src",
    );
    let dir = __dirname;
    for (let i = 0; i < 12; i += 1) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(path.join(candidate, "picker.android.js"))) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(
      "#2664 tester: could not locate @react-native-community/datetimepicker " +
        "source. This suite derives the Android mode registry from it and " +
        "must not silently fall back to a hardcoded set.",
    );
  };

  const libSrc = findLibSrc();

  /**
   * Derive ANDROID_MODE from the real `constants.js`.
   *
   * `ANDROID_MODE = COMMON_MODES`, and COMMON_MODES is the frozen object
   * literal. `datetime` is added only to IOS_MODE — which is the whole bug.
   */
  const constantsSrc = fs.readFileSync(
    path.join(libSrc, "constants.js"),
    "utf8",
  );
  const commonBlock = /const\s+COMMON_MODES\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(
    constantsSrc,
  );
  if (commonBlock === null) {
    throw new Error(
      "#2664 tester: COMMON_MODES not found in the installed constants.js — " +
        "the library shape changed; re-derive rather than assuming {date,time}.",
    );
  }
  const androidModes = Array.from(
    commonBlock[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g),
  ).map((m) => m[2]);

  /** Confirm `picker.android.js` really keys the registry off ANDROID_MODE. */
  const pickerSrc = fs.readFileSync(
    path.join(libSrc, "picker.android.js"),
    "utf8",
  );
  const registryKeys = Array.from(
    pickerSrc.matchAll(/\[ANDROID_MODE\.(\w+)\]/g),
  ).map((m) => m[1]);

  /**
   * The registry, built exactly as `picker.android.js` builds it: one entry per
   * ANDROID_MODE key, each exposing `dismiss()`. Any mode NOT in here resolves
   * to `undefined`, and `pickers[mode].dismiss()` throws — production's line.
   */
  const pickers: Record<string, { dismiss: () => boolean }> = {};
  for (const key of registryKeys) {
    if (androidModes.includes(key)) pickers[key] = { dismiss: () => true };
  }

  /** Faithful re-creation of DateTimePickerAndroid.android.js `dismiss`. */
  const dismiss = (mode: string | undefined): boolean => {
    const resolved = mode ?? "date";
    // THE PRODUCTION LINE. Deliberately unguarded — guarding it here would
    // make this whole suite unable to observe the defect it exists to catch.
    return pickers[resolved].dismiss();
  };

  // Expose the derivation so the positive-control test can assert on it.
  (
    globalThis as unknown as {
      __issue2664Registry__: {
        androidModes: string[];
        registryKeys: string[];
        dismiss: (mode: string | undefined) => boolean;
        rendered: string[];
      };
    }
  ).__issue2664Registry__ = {
    androidModes,
    registryKeys,
    dismiss,
    rendered: [],
  };

  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      const mode = props.mode as string | undefined;
      const design = props.design as string | undefined;
      const bag = (
        globalThis as unknown as {
          __issue2664Registry__: { rendered: string[] };
        }
      ).__issue2664Registry__;
      bag.rendered.push(String(mode));
      // datetimepicker.android.js:46 — the effect whose CLEANUP threw.
      // Same dependency array, same cleanup body.
      ReactLocal.useEffect(() => {
        return () => {
          dismiss(mode);
        };
      }, [mode, design]);
      return ReactLocal.createElement("NativeDateTimePicker", props);
    },
  };
});

jest.mock("../../hooks/useEventWaitlist", () => ({
  useEventWaitlist: () => ({ data: [] }),
}));
jest.mock("../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../components/ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", null, children) : null),
}));
jest.mock("../../components/ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../components/ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../components/ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../../components/event/TicketTierEditSheet";
// eslint-disable-next-line import/first
import { BookingDeadlinePicker } from "../../components/trip/BookingDeadlinePicker";
// eslint-disable-next-line import/first
import { combineAndroidDateAndTime } from "../androidDateTimeStep";
// eslint-disable-next-line import/first
import type { TicketStub } from "../../store/draftEventStore";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const registry = (): {
  androidModes: string[];
  registryKeys: string[];
  dismiss: (mode: string | undefined) => boolean;
  rendered: string[];
} =>
  (
    globalThis as unknown as {
      __issue2664Registry__: {
        androidModes: string[];
        registryKeys: string[];
        dismiss: (mode: string | undefined) => boolean;
        rendered: string[];
      };
    }
  ).__issue2664Registry__;

const ORIGINAL_OS = Platform.OS;
const setOS = (os: string): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};
afterEach(() => {
  setOS(ORIGINAL_OS);
  registry().rendered.length = 0;
});

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-2664-tester",
  name: "General Admission",
  priceGbp: 250,
  capacity: 200,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  currency: "NGN",
  ...overrides,
});

const mountTier = async (
  initial: TicketStub | null,
  onSave: (saved: TicketStub) => void = () => undefined,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        nextOrder={0}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="NGN"
      />,
    );
  });
  return tree as Tree;
};

const TRIP_START = new Date(2028, 0, 1, 0, 0, 0, 0).toISOString();

const mountDeadline = async (
  value: string | null,
  onChange: (next: string | null) => void = () => undefined,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <BookingDeadlinePicker
        value={value}
        tripStartIso={TRIP_START}
        brandTimezone="Europe/London"
        onChange={onChange}
      />,
    );
  });
  return tree as Tree;
};

const byLabel = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const pickers = (tree: Tree): HostNode[] =>
  tree.root.findAll((node) => node.type === "NativeDateTimePicker");

const press = async (tree: Tree, label: string): Promise<void> => {
  await TestRenderer.act(() => {
    (byLabel(tree, label).props.onPress as () => void)();
  });
};

const toggleDeadlineOn = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(() => {
    (byLabel(tree, "Set a booking deadline").props.onValueChange as (
      v: boolean,
    ) => void)(true);
  });
};

const fire = async (
  tree: Tree,
  type: "set" | "dismissed",
  date?: Date,
): Promise<void> => {
  const found = pickers(tree);
  expect(found).toHaveLength(1);
  const onChange = found[0].props.onChange as (
    event: { type: string; nativeEvent: { timestamp: number } },
    selected?: Date,
  ) => void;
  await TestRenderer.act(() => {
    onChange(
      { type, nativeEvent: { timestamp: date?.getTime() ?? 0 } },
      type === "set" ? date : undefined,
    );
  });
};

/** Unmount, letting the re-created library cleanup run for real. */
const unmount = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(() => tree.unmount());
};

const PICKED_DATE = new Date(2027, 2, 14, 8, 5, 0, 0);
const PICKED_TIME = new Date(2001, 0, 1, 21, 45, 0, 0);

/**
 * The web surface's commit, reproduced from TicketTierEditSheet's hidden
 * `<input type="datetime-local">` handler VERBATIM:
 *   const [y,m,d] = datePart.split("-").map(Number)
 *   const [h,mm]  = timePart.split(":").map(Number)
 *   new Date(y, m - 1, d, h, mm, 0, 0).toISOString()
 */
const webCommit = (datetimeLocal: string): string => {
  const [datePart, timePart] = datetimeLocal.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, h, mm, 0, 0).toISOString();
};

const pad = (n: number): string => String(n).padStart(2, "0");
const asDatetimeLocal = (date: Date, time: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
  `T${pad(time.getHours())}:${pad(time.getMinutes())}`;

describe("#2664 tester — the Android unmount dismiss must survive, for real", () => {
  test("T-1 POSITIVE CONTROL: the derived registry is real and does throw", () => {
    const reg = registry();

    // The derivation actually found modes — not an empty object that would
    // make every later assertion vacuous.
    expect(reg.androidModes.length).toBeGreaterThan(0);
    expect(reg.registryKeys.length).toBeGreaterThan(0);

    // The installed library still has no Android `datetime`. If a dependency
    // upgrade ever adds one, this fails loudly rather than quietly rotting.
    expect(reg.androidModes).not.toContain("datetime");
    expect(reg.registryKeys).toEqual(expect.arrayContaining(["date", "time"]));

    // Real modes dismiss cleanly...
    expect(() => reg.dismiss("date")).not.toThrow();
    expect(() => reg.dismiss("time")).not.toThrow();

    // ...and the pre-fix mode reproduces the production TypeError. Without
    // this assertion the suite could pass because nothing ever throws.
    expect(() => reg.dismiss("datetime")).toThrow(TypeError);
    expect(() => reg.dismiss("datetime")).toThrow(/dismiss/);
  });

  test("T-2 sale window: completing both steps unmounts without throwing", async () => {
    setOS("android");
    const tree = await mountTier(ticket());

    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE);
    await fire(tree, "set", PICKED_TIME);

    // Every mode this component handed the library across the whole sequence
    // must be one the library can actually dismiss.
    const reg = registry();
    for (const mode of reg.rendered) {
      expect(reg.registryKeys).toContain(mode);
    }

    // The real unmount effect runs here. Pre-fix this threw.
    await expect(unmount(tree)).resolves.toBeUndefined();
  });

  test("T-3 sale window: unmounting BETWEEN the two steps does not throw and commits nothing", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mountTier(ticket(), (t) => saved.push(t));

    await press(tree, "Set sale start date and time");
    // Step 1 done — the time dialog is now up. This intermediate state did not
    // exist before the fix, and it is where an unmount is most likely to be
    // holding a mode nobody dismissed.
    await fire(tree, "set", PICKED_DATE);
    expect(pickers(tree)[0].props.mode).toBe("time");

    await expect(unmount(tree)).resolves.toBeUndefined();

    // A half-set date must never have been committed.
    expect(saved).toHaveLength(0);
  });

  test("T-4 booking deadline: unmounting BETWEEN the two steps does not throw and commits nothing", async () => {
    setOS("android");
    const changes: (string | null)[] = [];
    const tree = await mountDeadline(null, (next) => changes.push(next));

    await toggleDeadlineOn(tree);
    await fire(tree, "set", PICKED_DATE);
    expect(pickers(tree)[0].props.mode).toBe("time");

    await expect(unmount(tree)).resolves.toBeUndefined();

    expect(changes).toHaveLength(0);
  });

  test("T-5 booking deadline: completing both steps unmounts without throwing", async () => {
    setOS("android");
    const changes: (string | null)[] = [];
    const tree = await mountDeadline(null, (next) => changes.push(next));

    await toggleDeadlineOn(tree);
    await fire(tree, "set", PICKED_DATE);
    await fire(tree, "set", PICKED_TIME);

    const reg = registry();
    for (const mode of reg.rendered) {
      expect(reg.registryKeys).toContain(mode);
    }

    await expect(unmount(tree)).resolves.toBeUndefined();
    expect(changes).toHaveLength(1);
  });

  test("T-6 re-opening mid-sequence restarts at the date step and never leaves an undismissable mode", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mountTier(ticket(), (t) => saved.push(t));

    // Open, advance to the time step, then re-open the OTHER window without
    // finishing the first — a rapid double-entry.
    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE);
    expect(pickers(tree)[0].props.mode).toBe("time");

    await press(tree, "Set sale end date and time");
    // Re-entry must reset to step 1, not resume a stale time step.
    expect(pickers(tree)[0].props.mode).toBe("date");

    const reg = registry();
    for (const mode of reg.rendered) {
      expect(reg.registryKeys).toContain(mode);
    }

    await expect(unmount(tree)).resolves.toBeUndefined();
    expect(saved).toHaveLength(0);
  });
});

describe("#2664 tester — Android/web parity across the temporal traps", () => {
  /**
   * Each case asserts the ANDROID combine equals the WEB commit for the same
   * wall clock. Equality is the invariant that survives any machine timezone,
   * so this is non-vacuous on a UTC CI runner as well as on a DST machine.
   */
  const cases: { label: string; date: Date; time: Date }[] = [
    {
      label: "DST spring-forward day (gap hour)",
      date: new Date(2027, 2, 28, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 1, 30, 0, 0),
    },
    {
      label: "DST fall-back day (ambiguous hour)",
      date: new Date(2027, 9, 31, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 1, 30, 0, 0),
    },
    {
      label: "US DST spring-forward day",
      date: new Date(2027, 2, 14, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 2, 30, 0, 0),
    },
    {
      label: "23:59 — last minute of the day",
      date: new Date(2027, 5, 10, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 23, 59, 0, 0),
    },
    {
      label: "00:00 — first minute of the day",
      date: new Date(2027, 5, 10, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 0, 0, 0, 0),
    },
    {
      label: "month end — 31 Jan",
      date: new Date(2027, 0, 31, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 18, 30, 0, 0),
    },
    {
      label: "month end — 28 Feb non-leap",
      date: new Date(2027, 1, 28, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 18, 30, 0, 0),
    },
    {
      label: "leap day — 29 Feb 2028",
      date: new Date(2028, 1, 29, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 12, 0, 0, 0),
    },
    {
      label: "year boundary — 31 Dec 23:59",
      date: new Date(2027, 11, 31, 0, 0, 0, 0),
      time: new Date(2000, 0, 1, 23, 59, 0, 0),
    },
  ];

  for (const { label, date, time } of cases) {
    test(`P — ${label}: Android combine === web datetime-local commit`, () => {
      const android = combineAndroidDateAndTime(date, time).toISOString();
      const web = webCommit(asDatetimeLocal(date, time));
      expect(android).toBe(web);
    });
  }

  test("P — seeds carrying non-zero seconds and milliseconds are normalised away", () => {
    // The stored value an organiser is EDITING can carry seconds (server
    // timestamps do). If those bled through, the same visible pick would save a
    // different instant on Android than on web, which is the parity claim.
    const dirtyDate = new Date(2027, 2, 14, 8, 5, 37, 123);
    const dirtyTime = new Date(2001, 0, 1, 21, 45, 59, 987);

    const combined = combineAndroidDateAndTime(dirtyDate, dirtyTime);
    expect(combined.getSeconds()).toBe(0);
    expect(combined.getMilliseconds()).toBe(0);

    // And it still matches what web would have written for the same wall clock.
    expect(combined.toISOString()).toBe(
      webCommit(asDatetimeLocal(dirtyDate, dirtyTime)),
    );
  });

  test("P — only Y/M/D of the date half and H/M of the time half are read", () => {
    // Deliberately contradictory halves: if the implementation ever read the
    // time from the date half (or vice versa) this catches it.
    const dateHalf = new Date(2027, 6, 4, 23, 59, 58, 999);
    const timeHalf = new Date(1999, 11, 31, 6, 7, 8, 9);

    const combined = combineAndroidDateAndTime(dateHalf, timeHalf);

    expect(combined.getFullYear()).toBe(2027);
    expect(combined.getMonth()).toBe(6);
    expect(combined.getDate()).toBe(4);
    expect(combined.getHours()).toBe(6);
    expect(combined.getMinutes()).toBe(7);
    expect(combined.getSeconds()).toBe(0);
    expect(combined.getMilliseconds()).toBe(0);
  });

  test("P — the committed instant renders identically in a non-machine timezone", () => {
    // Parity has to hold for an organiser whose brand timezone is not the
    // machine's. Same instant => same rendering in any named zone.
    const android = combineAndroidDateAndTime(PICKED_DATE, PICKED_TIME);
    const web = new Date(webCommit(asDatetimeLocal(PICKED_DATE, PICKED_TIME)));

    for (const tz of ["UTC", "Africa/Lagos", "America/New_York", "Asia/Tokyo"]) {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        dateStyle: "short",
        timeStyle: "short",
      });
      expect(fmt.format(android)).toBe(fmt.format(web));
    }
  });
});
