/**
 * #4523 checkpoint 17 — a custom-form date question (#4514 / #4541 brand forms
 * and trip checkout questions) is picked from the Host's Mingla calendar on
 * every platform, and the answer it stores is byte-identical to what the old
 * controls produced for the same day.
 *
 * Mounts the REAL `IntakeQuestionDate` from @mingla/form-rendering with the
 * REAL Host primitives (`businessFormPrimitives`, whose date input is the Host
 * `DateField` → `@mingla/calendar`). Only the sheet, the icon and the cover
 * media are stubbed. Runs under `jest.issue4523.cfg.cjs`.
 */
import React from "react";
import { Platform } from "react-native";

import { IntakeQuestionDate, isBirthDateQuestion, type FormQuestion } from "@mingla/form-rendering";
import { businessFormPrimitives } from "../../checkout/intake/businessFormPrimitives";

jest.mock("../Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require("react-native") as typeof import("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    Sheet: ({ visible, onClose, testID, children }: { visible: boolean; onClose: () => void; testID?: string; children: React.ReactNode }) =>
      visible
        ? R.createElement(
            R.Fragment,
            null,
            R.createElement(Pressable, { testID: testID?.replace(/-sheet$/, "-close"), onPress: onClose }),
            children,
          )
        : null,
  };
});
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../EventCoverMedia", () => ({ EventCoverMedia: () => null }));
jest.mock("@react-native-community/datetimepicker", () => {
  throw new Error("a form date question must never load the OS date picker (#4523)");
});

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> & void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Tree = ReturnType<typeof TestRenderer.create>;

const QUESTION: FormQuestion = {
  id: "q-arrival",
  type: "date",
  label: "Arrival day",
  required: true,
  position: 0,
};

/** The pre-#4523 native path's conversion (QuestionRenderers `dateToIso`). */
const legacyNativeIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** The pre-#4523 web path stored the browser date box's own value. */
const legacyWebValue = (browserValue: string): string => browserValue;

const mount = async (onChange: jest.Mock, value = ""): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <IntakeQuestionDate question={QUESTION} primitives={businessFormPrimitives} value={value} onChange={onChange} />,
    );
  });
  for (let i = 0; i < 3; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
  return tree;
};

const press = async (tree: Tree, testID: string): Promise<void> => {
  await TestRenderer.act(async () => {
    const hit = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
    if (hit === undefined) throw new Error(`nothing pressable with testID ${testID}`);
    (hit.props.onPress as () => void)();
  });
};
const isOpen = (tree: Tree): boolean =>
  tree.root.findAll((n) => n.props.testID === "intake-date-calendar-next").length > 0;
/** Host Text nodes (string type) whose own children include `value`. */
const textNodesWith = (tree: Tree, value: string): number =>
  tree.root.findAll(
    (n) =>
      n.type === "Text" &&
      (n.props.children === value || (Array.isArray(n.props.children) && (n.props.children as unknown[]).includes(value))),
  ).length;

// FIRST in the file: the lazily loaded calendar body is not loaded yet.
it("a tap on the row while the calendar is still loading is kept and opens it once loaded (no dead tap)", async () => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <IntakeQuestionDate question={QUESTION} primitives={businessFormPrimitives} value="" onChange={jest.fn()} />,
    ) as unknown as Tree;
  });
  const loading = tree.root.findAll((n) => n.props.testID === "intake-date-loading" && typeof n.props.onPress === "function")[0];
  expect(loading).toBeDefined();
  expect(loading.props.accessibilityLabel).toBe("Arrival day");
  TestRenderer.act(() => {
    (loading.props.onPress as () => void)();
  });
  expect(isOpen(tree)).toBe(false);
  for (let i = 0; i < 4; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
  expect(isOpen(tree)).toBe(true);
  await TestRenderer.act(async () => tree.unmount());
});

describe.each(["ios", "android", "web"] as const)("#4523 Host form date question on %s", (os) => {
  const realOs = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
  });
  afterAll(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => realOs });
  });

  it("opens the Mingla calendar, never closes on month changes, and stores the picked day byte-identically", async () => {
    const onChange = jest.fn();
    const tree = await mount(onChange);

    // The question label is drawn once (by the shell), and the field is spoken with it.
    expect(textNodesWith(tree, "Arrival day")).toBe(1);
    const trigger = tree.root.findAll((n) => n.props.testID === "intake-date" && typeof n.props.onPress === "function")[0];
    expect(trigger.props.accessibilityLabel).toBe("Arrival day, not set");

    await press(tree, "intake-date");
    expect(isOpen(tree)).toBe(true);
    for (let i = 0; i < 6; i += 1) await press(tree, "intake-date-calendar-next");
    for (let i = 0; i < 6; i += 1) await press(tree, "intake-date-calendar-prev");
    expect(isOpen(tree)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    await press(tree, "intake-date-calendar-next");
    // Any day of the visible month: read its YYYY-MM-DD off the day button.
    const day = tree.root.findAll(
      (n) => typeof n.props.testID === "string" && /^intake-date-calendar-day-\d{4}-\d{2}-15$/.test(n.props.testID as string) && typeof n.props.onPress === "function",
    )[0];
    const picked = (day.props.testID as string).replace("intake-date-calendar-day-", "");
    await press(tree, day.props.testID as string);

    expect(onChange).toHaveBeenCalledTimes(1);
    const stored = onChange.mock.calls[0][0] as string;
    expect(stored).toBe(picked);
    const [y, m, d] = picked.split("-").map(Number);
    expect(stored).toBe(legacyNativeIso(new Date(y, m - 1, d)));
    expect(stored).toBe(legacyWebValue(picked));
    expect(isOpen(tree)).toBe(false);
    await TestRenderer.act(async () => tree.unmount());
  });

  it("shows a stored answer in long form and keeps it when the calendar is dismissed", async () => {
    const onChange = jest.fn();
    const tree = await mount(onChange, "2027-03-12");
    const trigger = tree.root.findAll((n) => n.props.testID === "intake-date" && typeof n.props.onPress === "function")[0];
    expect(String(trigger.props.accessibilityLabel)).toMatch(/^Arrival day, .*12.*2027/);
    await press(tree, "intake-date");
    await press(tree, "intake-date-close");
    expect(isOpen(tree)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });
});

/**
 * #4523 SC-12 (W-9) — a date-of-birth question in a real checkout opened the
 * plain calendar: on this month, future days allowed, no year grid, focus left
 * on the page. The question now opens the birth-date calendar: the year grid
 * first, three taps to a day, no future day, and (web) focus moved in.
 * FAILS ON REVERT: the plain calendar has no year grid.
 */
describe("#4523 SC-12 — a date-of-birth question opens the birth-date calendar", () => {
  const DOB: FormQuestion = { id: "q-dob", type: "date", label: "Date of birth", required: true, position: 0 };
  const realOs = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => realOs });
  });

  const mountDob = async (onChange: jest.Mock): Promise<Tree> => {
    let tree!: Tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <IntakeQuestionDate question={DOB} primitives={businessFormPrimitives} value="" onChange={onChange} />,
      );
    });
    for (let i = 0; i < 3; i += 1) {
      await TestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    return tree;
  };

  it("labels that ask for a birth date are birth-date questions; others are not", () => {
    for (const label of ["Date of birth", "Birth date", "Birthday", "DOB", "Traveler date of birth"]) {
      expect(isBirthDateQuestion({ ...DOB, label })).toBe(true);
    }
    for (const label of ["Arrival day", "Passport expiry date", "Doberman's name"]) {
      expect(isBirthDateQuestion({ ...DOB, label })).toBe(false);
    }
    expect(isBirthDateQuestion({ ...DOB, type: "short_text" })).toBe(false);
  });

  // #4522 W-11 — a birth date has no time of day, so its footer shows no zone.
  // FAILS ON REVERT: the footer printed "New York time (UTC-5)" on a DOB.
  it("the birth-date calendar's footer shows no time zone; another date question's still does", async () => {
    const tree = await mountDob(jest.fn());
    await press(tree, "intake-date");
    expect(tree.root.findAll((n) => n.props.testID === "intake-date-calendar-tz")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
    let other!: Tree;
    await TestRenderer.act(async () => {
      other = TestRenderer.create(
        <IntakeQuestionDate question={QUESTION} primitives={businessFormPrimitives} value="" onChange={jest.fn()} />,
      );
    });
    for (let i = 0; i < 3; i += 1) {
      await TestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    await press(other, "intake-date");
    expect(other.root.findAll((n) => n.props.testID === "intake-date-calendar-tz").length).toBeGreaterThan(0);
    await TestRenderer.act(async () => other.unmount());
  });

  it("year grid first, no future year, three taps to a day, focus moved in on web", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });
    const onChange = jest.fn();
    const tree = await mountDob(onChange);
    await press(tree, "intake-date");
    const years = tree.root.findAll(
      (n) => typeof n.props.testID === "string" && /^intake-date-calendar-year-\d{4}$/.test(n.props.testID as string) && typeof n.props.onPress === "function",
    );
    expect(years.length).toBe(12);
    // Focus went into the year grid as it opened: the anchor year (25 years
    // back) took focus. RN's jest View keeps a focus mock per instance.
    const anchor = new Date().getUTCFullYear() - 25;
    const focused = tree.root.findAll(
      (n) =>
        n.props.testID === `intake-date-calendar-year-${anchor}` &&
        typeof (n as unknown as { instance?: { focus?: jest.Mock } }).instance?.focus === "function",
    );
    expect(
      focused.some(
        (n) => ((n as unknown as { instance: { focus: jest.Mock } }).instance.focus.mock?.calls.length ?? 0) > 0,
      ),
    ).toBe(true);
    // No future year can be picked: page to the decade holding next year.
    const nextYear = new Date().getUTCFullYear() + 1;
    for (let i = 0; i < 6; i += 1) {
      if (tree.root.findAll((n) => n.props.testID === `intake-date-calendar-year-${nextYear}`).length > 0) break;
      await press(tree, "intake-date-calendar-next");
    }
    const future = tree.root.findAll((n) => n.props.testID === `intake-date-calendar-year-${nextYear}` && typeof n.props.onPress === "function")[0];
    expect(future.props.disabled).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      if (tree.root.findAll((n) => n.props.testID === "intake-date-calendar-year-1996").length > 0) break;
      await press(tree, "intake-date-calendar-prev");
    }
    await press(tree, "intake-date-calendar-year-1996");
    await press(tree, "intake-date-calendar-month-3");
    await press(tree, "intake-date-calendar-day-1996-03-14");
    expect(onChange).toHaveBeenCalledWith("1996-03-14");
    expect(isOpen(tree)).toBe(false);
    await TestRenderer.act(async () => tree.unmount());
  });

  // #4522 W-9 — arrow keys move between years and months as they do between
  // days. FAILS ON REVERT: an arrow key in the year or month grid moved nothing.
  it("arrow keys move focus through the year and month grids (web)", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });
    const tree = await mountDob(jest.fn());
    await press(tree, "intake-date");
    type Inst = { focus: jest.Mock };
    // RN's jest host views share one focus mock; `mock.contexts` names the
    // instance each call focused.
    const lastFocused = (): string | undefined => {
      const nodes = tree.root.findAll(
        (n) => typeof n.props.testID === "string" && /^intake-date-calendar-(year|month)-\d+$/.test(n.props.testID as string) &&
          typeof (n as unknown as { instance?: Partial<Inst> }).instance?.focus === "function",
      );
      if (nodes.length === 0) return undefined;
      const mock = (nodes[0] as unknown as { instance: Inst }).instance.focus.mock;
      const target = mock.contexts[mock.contexts.length - 1];
      return nodes.find((n) => (n as unknown as { instance: unknown }).instance === target)?.props.testID as string | undefined;
    };
    const key = async (k: string): Promise<void> => {
      await TestRenderer.act(async () => {
        const surface = tree.root.findAll((n) => typeof n.props.onKeyDown === "function")[0];
        (surface.props.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({ key: k, preventDefault: () => undefined });
      });
    };
    const anchor = new Date().getUTCFullYear() - 25;
    expect(lastFocused()).toBe(`intake-date-calendar-year-${anchor}`);
    await key("ArrowRight");
    expect(lastFocused()).toBe(`intake-date-calendar-year-${anchor + 1}`);
    await key("ArrowLeft");
    await key("ArrowUp");
    expect(lastFocused()).toBe(`intake-date-calendar-year-${anchor - 3}`);
    // Into the month grid: focus starts on the visible month and arrows move it.
    await press(tree, `intake-date-calendar-year-${anchor}`);
    const opened = lastFocused();
    expect(opened).toMatch(/^intake-date-calendar-month-\d+$/);
    const month = Number((opened as string).split("-").pop());
    const next = month <= 9 ? month + 3 : month - 3;
    await key(month <= 9 ? "ArrowDown" : "ArrowUp");
    expect(lastFocused()).toBe(`intake-date-calendar-month-${next}`);
    await TestRenderer.act(async () => tree.unmount());
  });
});
