/**
 * issue #1027 — Thread B (business web date/time) · adversarial STRUCTURAL guard
 * (the fails-on-revert lock for the whole umbrella) + native-parity check (T3).
 *
 * The web date/time bug class spread because each surface hand-rolled its own
 * web branch. This suite enforces I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT across
 * EVERY fixed surface, so a divergent branch cannot reappear:
 *
 *   - The ONE shared control (`ui/WebDateTimeInput`) renders a REAL, visible
 *     <input> — never a hidden (opacity:0 / pointer-events:none) one.
 *   - Class 1 (event/RSVP When + per-date override): NO `showPicker`, NO
 *     `HIDDEN_WEB_INPUT_STYLE`, NO `pointerEvents:"none"`; each uses the shared
 *     WebDateTimeInput; the native DateTimePicker Sheet/dialog stays gated to
 *     iOS/Android (T3 parity — native path untouched).
 *   - Class 2 (buyer checkout date, trip installment date, trip booking
 *     deadline, marketing scheduler): each renders WebDateTimeInput on
 *     `Platform.OS === "web"` and NEVER renders @react-native-community/
 *     datetimepicker on web (it has no web build).
 *
 * FAILS-ON-REVERT: restoring the hidden-input + showPicker bridge, or dropping a
 * surface back to a web-unguarded native DateTimePicker, makes a named assertion
 * RED. Comment lines are stripped first so the historical "opacity:0/showPicker"
 * descriptions in the fix's own docblocks cannot mask a real regression.
 */

import { describe, expect, test } from "@jest/globals";
import React from "react";
import { Platform } from "react-native";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

/** Strip block + line comments (keeps `://` in URLs). */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sharedRaw = read("../../ui/WebDateTimeInput.tsx");
const shared = strip(sharedRaw);
const when = strip(read("../CreatorStep2When.tsx"));
const override = strip(read("../MultiDateOverrideSheet.tsx"));
const intake = strip(read("../../../../../packages/form-rendering/QuestionRenderers.tsx"));

const HIDDEN_INPUT_STYLE = /pointerEvents\s*:\s*["']none["']/;
const OPACITY_ZERO = /opacity\s*:\s*0\b/;

describe("issue #1027 Thread B — the shared visible web date/time control", () => {
  test("WebDateTimeInput renders a real, visible native <input> (no hidden bridge)", () => {
    expect(shared).toContain("<input");
    expect(shared).toContain("onChangeValue");
    // Dark native popup + indicator; the marker distinguishes the new mechanism.
    expect(shared).toContain("colorScheme");
    expect(shared).toContain("WEB_DATETIME_INPUT_TESTID");
    // It is NOT hidden and does NOT drive an imperative browser picker.
    expect(shared).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(shared).not.toMatch(OPACITY_ZERO);
    expect(shared).not.toContain("showPicker");
  });
});

describe("issue #1027 Thread B — Class 1: event/RSVP When + per-date override", () => {
  test("CreatorStep2When: hidden-input + showPicker bridge is GONE; visible WebDateTimeInput is used", () => {
    expect(when).not.toContain("showPicker");
    expect(when).not.toContain("HIDDEN_WEB_INPUT_STYLE");
    expect(when).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(when).toContain("WebDateTimeInput");
    // #4523: the date row is the shared calendar (DateField); its web
    // behaviour is proven mounted at the end of this file.
    expect(when).toContain("<DateField");
    expect(when).toContain('type="time"');
  });

  test("CreatorStep2When: native DateTimePicker Sheet/dialog stays gated to iOS/Android (T3 parity)", () => {
    expect(when).toContain("DateTimePicker");
    expect(when).toContain('Platform.OS === "ios"');
    expect(when).toContain('Platform.OS === "android"');
  });

  test("MultiDateOverrideSheet: hidden-input + showPicker bridge is GONE; visible WebDateTimeInput is used; native intact", () => {
    expect(override).not.toContain("showPicker");
    expect(override).not.toContain("HIDDEN_WEB_INPUT_STYLE");
    expect(override).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(override).toContain("WebDateTimeInput");
    expect(override).toContain('type="time"');
    expect(override).toContain("DateTimePicker");
    expect(override).toContain('Platform.OS === "ios"');
    expect(override).toContain('Platform.OS === "android"');
  });
});

describe("issue #1027 Thread B — Class 2: web-broken native pickers now render a web input", () => {
  test("Checkout intake date question (buyer web): the shared renderer no longer carries an OS or browser date control", () => {
    // #4523: the renderer draws the host's injected date input on every
    // platform, so the web branch and the OS picker imports are gone on
    // purpose. The behaviour (injected input used on web, no browser date box,
    // no OS picker, the commit reaches onChange) is mounted at the end of this
    // file.
    expect(intake).not.toContain("@react-native-community/datetimepicker");
    expect(intake).not.toMatch(/Platform\.OS\s*===/);
  });

  // #4523 moved the trip instalment due date, the trip booking deadline and
  // the marketing scheduler onto the shared Mingla calendar, so the old
  // `WebDateTimeInput type="date"` source pins no longer describe them. Their
  // web behaviour (visible picked control, no OS picker on web, the value
  // reaches the screen) is proven on the mounted screens in
  // the mounted suite at the end of this file.
});

// ===========================================================================
/*
 * issue #1027 Thread B (web date/time) — the behaviour half, rewritten for #4523.
 *
 * The original #1027 suite pinned the source text of four screens: each had to
 * contain `WebDateTimeInput` with a `type="date"` / `type="datetime-local"`
 * branch. #4523 moved every Host date onto the shared Mingla calendar, so those
 * pins described code that no longer exists. The intent they guarded is kept
 * here and checked on the MOUNTED screens with `Platform.OS === "web"`:
 *
 *   1. On web a date is chosen through a real, visible, pressable control that
 *      commits a value — never a hidden input or an imperative browser picker.
 *   2. The OS DateTimePicker (no web build) is never rendered on web.
 *   3. The commit reaches the screen's own state handler.
 *
 * Screens: event When step (CreatorStep2When), trip instalment fixed due date
 * (PaymentPlanEditor), trip booking deadline (BookingDeadlinePicker), marketing
 * scheduler (ComposerStepWhen).
 *
 * Fails on revert: bring back a hidden/imperative web date input, render the OS
 * picker on web, or drop the commit wiring on any of the four screens -> red.
 */


const OS_PICKER = "OsDateTimePicker";

jest.mock("@react-native-community/datetimepicker", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  const Picker = (props: Record<string, unknown>): React.ReactElement =>
    R.createElement("OsDateTimePicker", props);
  return { __esModule: true, default: Picker };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    __esModule: true,
    Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? R.createElement(R.Fragment, null, children) : null,
  };
});
jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: (): null => null }));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: (): null => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ __esModule: true, ConfirmDialog: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    __esModule: true,
    ScrollView: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children),
  };
});
jest.mock("../CreatorStep2WhenRepeatPickerSheet", () => ({
  __esModule: true,
  CreatorStep2WhenRepeatPickerSheet: (): null => null,
}));
jest.mock("../MultiDateOverrideSheet", () => ({ __esModule: true, MultiDateOverrideSheet: (): null => null }));
jest.mock("react-native-svg", () => ({ __esModule: true, default: (): null => null, Svg: (): null => null, Path: (): null => null }), {
  virtual: true,
});

type Node = { type: unknown; props: Record<string, unknown>; findAll: (p: (n: Node) => boolean) => Node[] };
type Tree = { root: Node; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalOS = Platform.OS;
beforeAll(() => {
  (Platform as { OS: string }).OS = "web";
});
afterAll(() => {
  (Platform as { OS: string }).OS = originalOS;
});

const mount = async (el: React.ReactElement): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(el);
  });
  // The calendar body is one lazy chunk; let it resolve.
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return tree;
};

const pressables = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");

const press = async (tree: Tree, testID: string): Promise<void> => {
  const hit = pressables(tree, testID)[0];
  if (hit === undefined) throw new Error(`nothing pressable with testID ${testID}`);
  await TestRenderer.act(async () => {
    (hit.props.onPress as () => void)();
  });
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const dayIds = (tree: Tree, prefix: string): string[] =>
  tree.root
    .findAll((n) => typeof n.props.testID === "string" && new RegExp(`^${prefix}-calendar-day-\\d{4}-\\d{2}-\\d{2}$`).test(n.props.testID as string) && typeof n.props.onPress === "function" && n.props.disabled !== true)
    .map((n) => n.props.testID as string);

/** Intent 1 + 2: nothing hidden, no imperative browser picker, no OS picker on web. */
const expectNoHiddenOrOsPicker = (tree: Tree): void => {
  expect(tree.root.findAll((n) => n.type === OS_PICKER)).toHaveLength(0);
  for (const input of tree.root.findAll((n) => n.type === "input")) {
    const style = (input.props.style ?? {}) as Record<string, unknown>;
    expect(style.opacity).not.toBe(0);
    expect(style.pointerEvents).not.toBe("none");
    expect(input.props.type).not.toBe("date");
    expect(input.props.type).not.toBe("datetime-local");
  }
};

describe("issue #1027 / #4523 — web date fields are picked on a visible control (mounted)", () => {
  test("event When step: the date row opens the Mingla calendar and a picked day reaches the draft; times stay visible inputs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreatorStep2When } = require("../CreatorStep2When") as { CreatorStep2When: React.FC<Record<string, unknown>> };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildDraftEvent } = require("../../../store/draftEventStore") as {
      buildDraftEvent: (brandId: string) => Record<string, unknown>;
    };
    const updateDraft = jest.fn();
    const tree = await mount(
      React.createElement(CreatorStep2When, {
        draft: { ...buildDraftEvent("brand_1027_web"), whenMode: "single", date: null, doorsOpen: null, endsAt: null, endsAtUtc: null, timezone: "Europe/London" },
        updateDraft,
        errors: [],
        showErrors: false,
        onShowToast: () => undefined,
        scrollToBottom: () => undefined,
      }),
    );
    expectNoHiddenOrOsPicker(tree);
    // TEST-MOD-APPROVED #4490 (N136): Doors / Ends on web are the 24-hour
    // TimeField (typing works), not native <input type="time">; each is still a
    // visible control whose change commits the draft.
    const nativeTimes = tree.root.findAll((n) => n.type === "input" && n.props.type === "time");
    expect(nativeTimes).toHaveLength(0);
    const timeFields = tree.root.findAll(
      (n) =>
        ["creator-when-doors-web", "creator-when-ends-web"].includes(String(n.props.testID)) &&
        typeof n.props.onChangeValue === "function",
    );
    expect([...new Set(timeFields.map((n) => String(n.props.testID)))].sort()).toEqual(["creator-when-doors-web", "creator-when-ends-web"]);

    await press(tree, "creator-when-date");
    const days = dayIds(tree, "creator-when-date");
    expect(days.length).toBeGreaterThan(0);
    await press(tree, days[days.length - 1]);
    const datePatch = updateDraft.mock.calls.map((c) => c[0] as Record<string, unknown>).find((p) => "date" in p);
    expect(datePatch?.date).toBe(days[days.length - 1].replace("creator-when-date-calendar-day-", ""));
    expectNoHiddenOrOsPicker(tree);
    tree.unmount();
  });

  test("checkout intake date question (buyer web): the injected date input is drawn, no browser date box or OS picker, and a pick reaches onChange", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IntakeQuestionDate } = require("../../../../../packages/form-rendering/QuestionRenderers") as {
      IntakeQuestionDate: React.FC<Record<string, unknown>>;
    };
    const { Pressable } = jest.requireActual("react-native") as typeof import("react-native");
    const injected = (props: Record<string, unknown>): React.ReactElement =>
      React.createElement(Pressable, {
        testID: props.testID as string,
        accessibilityLabel: props.ariaLabel as string,
        onPress: () => (props.onChangeValue as (v: string) => void)("2099-02-03"),
      });
    const primitives = {
      tokens: {
        color: { text1: "#111", text2: "#222", text3: "#333", text4: "#444", textStrong: "#000", line: "#ddd", accent: "#f60", danger: "#d00", fill: { inset: "#eee" } },
        radius: { sm: 4, md: 8 },
        space: { 1: 2, 2: 4, 4: 8, 6: 12 },
        type: {
          body: { fontSize: 14, lineHeight: 20 },
          caption: { fontSize: 12, lineHeight: 16 },
          small: { fontSize: 13, lineHeight: 18 },
        },
      },
      Icon: (): null => null,
      WebDateTimeInput: injected,
    };
    const onChange = jest.fn();
    const tree = await mount(
      React.createElement(IntakeQuestionDate, {
        question: { id: "q1", type: "date", label: "Arrival day", required: true, position: 0 },
        primitives,
        value: "",
        onChange,
      }),
    );
    expect(Platform.OS).toBe("web");
    expectNoHiddenOrOsPicker(tree);
    expect(pressables(tree, "intake-date").length).toBeGreaterThan(0);
    await press(tree, "intake-date");
    expect(onChange).toHaveBeenCalledWith("2099-02-03");
    tree.unmount();
  });

  test("trip instalment fixed due date: the calendar commits the picked day into the schedule", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PaymentPlanEditor } = require("../../trip/PaymentPlanEditor") as { PaymentPlanEditor: React.FC<Record<string, unknown>> };
    const onChange = jest.fn();
    const tree = await mount(
      React.createElement(PaymentPlanEditor, {
        value: { deposit_pct: 50, installments: [{ ordinal: 1, pct: 50, fixed_date: "2099-01-15" }] },
        onChange,
        totalAmountCents: 100000,
        currency: "GBP",
        locked: false,
      }),
    );
    expectNoHiddenOrOsPicker(tree);
    await press(tree, "payplan-date-1");
    const days = dayIds(tree, "payplan-date-1");
    expect(days.length).toBeGreaterThan(0);
    const picked = days[days.length - 1];
    await press(tree, picked);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as { installments: Array<{ fixed_date?: string }> } | undefined;
    expect(last?.installments[0]?.fixed_date).toBe(picked.replace("payplan-date-1-calendar-day-", ""));
    tree.unmount();
  });

  test("trip booking deadline: date and time are picked on the calendar and saved as an instant", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BookingDeadlinePicker } = require("../../trip/BookingDeadlinePicker") as { BookingDeadlinePicker: React.FC<Record<string, unknown>> };
    const onChange = jest.fn();
    const tree = await mount(
      React.createElement(BookingDeadlinePicker, {
        value: "2099-03-01T10:00:00.000Z",
        tripStartIso: "2099-06-01T10:00:00.000Z",
        brandTimezone: "Europe/London",
        onChange,
      }),
    );
    expectNoHiddenOrOsPicker(tree);
    await press(tree, "booking-deadline-field");
    await press(tree, "booking-deadline-field-calendar-done");
    expect(onChange).toHaveBeenCalledWith("2099-03-01T10:00:00.000Z");
    expectNoHiddenOrOsPicker(tree);
    tree.unmount();
  });

  test("marketing scheduler: the schedule is picked on the calendar and reaches the composer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ComposerStepWhen } = require("../../marketing/ComposerStepWhen") as { ComposerStepWhen: React.FC<Record<string, unknown>> };
    const onScheduledForChange = jest.fn();
    const tree = await mount(
      React.createElement(ComposerStepWhen, {
        mode: "schedule",
        onModeChange: () => undefined,
        scheduledForIso: "2099-05-04T18:15",
        onScheduledForChange,
      }),
    );
    expectNoHiddenOrOsPicker(tree);
    await press(tree, "composer-when-datetime");
    await press(tree, "composer-when-datetime-calendar-done");
    expect(onScheduledForChange).toHaveBeenCalledWith("2099-05-04T18:15");
    tree.unmount();
  });
});
