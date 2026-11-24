/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4523 — Creator date of birth is picked on the Mingla calendar's year grid:
 * year, then month, then day (three taps), nothing is typed, and a birth date
 * under 18 cannot be chosen. Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("../../programs/ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  return {
    PROGRAM_COLORS: new Proxy({}, { get: () => "#000" }),
    programStyles: new Proxy({}, { get: () => ({}) }),
    ProgramSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? h("ProgramSheetOpen", null, children) : null,
  };
});
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

const { CreatorDobField } = require("../CreatorDobField");

type Instance = import("react-test-renderer").ReactTestInstance;
type Renderer = import("react-test-renderer").ReactTestRenderer;

const render = async (element: React.ReactElement): Promise<Renderer> => {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer as unknown as Renderer;
};
const find = (r: Renderer, testID: string): Instance[] =>
  r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");
const press = async (r: Renderer, testID: string): Promise<void> => {
  await act(async () => {
    const hit = find(r, testID)[0];
    if (hit === undefined) throw new Error(`nothing pressable: ${testID}`);
    (hit.props.onPress as () => void)();
  });
};

describe("#4523 Creator date of birth", () => {
  it("opens on the year grid, then month, then day: three taps pick a date and nothing is typed", async () => {
    const onChange = jest.fn();
    const r = await render(<CreatorDobField value={null} onChange={onChange} />);
    expect(r.root.findAll((n) => typeof n.props.onChangeText === "function")).toHaveLength(0);
    const trigger = r.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityHint === "Opens calendar")[0];
    await act(async () => { (trigger.props.onPress as () => void)(); });
    const years = r.root.findAll((n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("calendar-year-") && typeof n.props.onPress === "function");
    const enabled = years.filter((n) => !(n.props.accessibilityState as { disabled: boolean }).disabled);
    expect(enabled.length).toBeGreaterThan(0);
    const yearId = enabled[0].props.testID as string;
    await press(r, yearId);
    await press(r, "calendar-month-6");
    const year = yearId.replace("calendar-year-", "");
    await press(r, `calendar-day-${year}-06-15`);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(`${year}-06-15`);
  });

  it("a birth year that would make the creator under 18 is not selectable", async () => {
    const r = await render(<CreatorDobField value={null} onChange={jest.fn()} />);
    const trigger = r.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityHint === "Opens calendar")[0];
    await act(async () => { (trigger.props.onPress as () => void)(); });
    const thisYear = new Date().getFullYear();
    // Page forward until the current year is on the grid, then check it is disabled.
    for (let i = 0; i < 6 && find(r, `calendar-year-${thisYear}`).length === 0; i += 1) await press(r, "calendar-next");
    const current = r.root.findAll((n) => n.props.testID === `calendar-year-${thisYear}`);
    expect(current.length).toBeGreaterThan(0);
    expect(current.some((n) => (n.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true)).toBe(true);
  });
});
