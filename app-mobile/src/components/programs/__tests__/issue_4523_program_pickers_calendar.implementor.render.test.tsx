/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4523 — the Explorer program pickers use the shared Mingla calendar: changing
 * month never closes it or moves the value; a day tap commits once; a range
 * commits only on Done.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("../ProgramUi", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  return {
    PROGRAM_COLORS: new Proxy({}, { get: () => "#000" }),
    programStyles: new Proxy({}, { get: () => ({}) }),
    ProgramButton: (props: Record<string, unknown>) => h("ProgramButton", props),
    ProgramSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? h("ProgramSheetOpen", null, children) : null,
    SelectField: (props: Record<string, unknown>) => h("SelectField", props),
  };
});
jest.mock("../../ui/BaseBottomSheet", () => ({ BottomSheetTextInput: "BottomSheetTextInput" }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: "DateTimePicker" }));

const { DateRangeField, CalendarGrid } = require("../ProgramPickers");

type Instance = import("react-test-renderer").ReactTestInstance;
type Renderer = import("react-test-renderer").ReactTestRenderer;

const render = async (element: React.ReactElement): Promise<Renderer> => {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer as unknown as Renderer;
};

const byTestID = (renderer: Renderer, testID: string): Instance[] =>
  renderer.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");

const press = async (renderer: Renderer, testID: string): Promise<void> => {
  await act(async () => {
    const hit = byTestID(renderer, testID)[0];
    if (hit === undefined) throw new Error(`nothing pressable with testID ${testID}`);
    (hit.props.onPress as () => void)();
  });
};

const hasNode = (renderer: Renderer, testID: string): boolean =>
  renderer.root.findAll((n) => n.props.testID === testID).length > 0;

describe("#4523 Explorer program pickers", () => {
  it("CalendarGrid: month arrows only move the view; a day tap picks once", async () => {
    const onPick = jest.fn();
    const renderer = await render(<CalendarGrid start="2027-03-12" onPick={onPick} />);
    for (let i = 0; i < 14; i += 1) await press(renderer, "calendar-next");
    for (let i = 0; i < 14; i += 1) await press(renderer, "calendar-prev");
    expect(onPick).not.toHaveBeenCalled();
    expect(hasNode(renderer, "calendar-grid")).toBe(true);
    await press(renderer, "calendar-day-2027-03-20");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("2027-03-20");
  });

  it("CalendarGrid: days outside the window are not pickable", async () => {
    const onPick = jest.fn();
    const renderer = await render(
      <CalendarGrid start={null} onPick={onPick} minDate="2027-03-10" maxDate="2027-03-20" />,
    );
    // Open on the window's first month (min), not today.
    await press(renderer, "calendar-day-2027-03-09");
    await press(renderer, "calendar-day-2027-03-21");
    expect(onPick).not.toHaveBeenCalled();
    await press(renderer, "calendar-day-2027-03-15");
    expect(onPick).toHaveBeenCalledWith("2027-03-15");
  });

  it("DateRangeField: two taps stay open, Done commits the range once", async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <DateRangeField label="Window" start={null} end={null} onChange={onChange} minDate="2027-03-01" maxDate="2027-03-31" />,
    );
    const field = renderer.root.findAll((n) => n.type === "SelectField" || typeof n.props.onPress === "function")[0];
    expect(field).toBeDefined();
    await act(async () => {
      const trigger = renderer.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityHint === "Opens calendar")[0];
      (trigger.props.onPress as () => void)();
    });
    await press(renderer, "calendar-next");
    await press(renderer, "calendar-prev");
    await press(renderer, "calendar-day-2027-03-12");
    await press(renderer, "calendar-day-2027-03-16");
    expect(onChange).not.toHaveBeenCalled();
    await press(renderer, "calendar-done");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-16" });
  });

  it("DateRangeField (days): a one-day range commits start = end (#4523 rework F5)", async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <DateRangeField label="Window" start={null} end={null} onChange={onChange} minDate="2027-03-01" maxDate="2027-03-31" />,
    );
    await act(async () => {
      const trigger = renderer.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityHint === "Opens calendar")[0];
      (trigger.props.onPress as () => void)();
    });
    await press(renderer, "calendar-day-2027-03-12");
    await press(renderer, "calendar-day-2027-03-12");
    await press(renderer, "calendar-done");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-12" });
  });
});
