/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4523 — Explorer inline calendars. Changing month never moves a value (the F-4
 * contributor: the stay filter's check-in used to change on a month change), a day
 * tap picks once, and a stay range commits on Done. Runs under
 * app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  return {
    BaseBottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? h("SheetOpen", null, children) : null,
    BottomSheetTextInput: "BottomSheetTextInput",
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: "DateTimePicker" }));

const { StayFilterChips } = require("../StayFilterChips");
const { PlanDateTimeFields } = require("../../chat/PlanTimePickerSheet");

type Instance = import("react-test-renderer").ReactTestInstance;
type Renderer = import("react-test-renderer").ReactTestRenderer;

const render = async (element: React.ReactElement): Promise<Renderer> => {
  let renderer: Renderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer as unknown as Renderer;
};
const pressables = (r: Renderer, match: (n: Instance) => boolean): Instance[] =>
  r.root.findAll((n) => typeof n.props.onPress === "function" && match(n));
const press = async (r: Renderer, testID: string): Promise<void> => {
  await act(async () => {
    const hit = pressables(r, (n) => n.props.testID === testID)[0];
    if (hit === undefined) throw new Error(`nothing pressable: ${testID}`);
    (hit.props.onPress as () => void)();
  });
};
const pad = (v: number): string => String(v).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

describe("#4523 Explorer inline calendars", () => {
  it("StayFilterChips: 14 month changes never move the dates or call onChange", async () => {
    const onChange = jest.fn();
    const filters = {
      destinationQuery: null, checkIn: null, checkOut: null, adults: 2, children: 0, rooms: 1,
      propertyKinds: [], amenities: [], confirmationMode: null,
    };
    const r = await render(<StayFilterChips filters={filters} onChange={onChange} />);
    const datesChip = pressables(r, (n) => n.props.label === "Dates")[0];
    expect(datesChip).toBeDefined();
    await act(async () => {
      (datesChip.props.onPress as () => void)();
    });

    for (let i = 0; i < 14; i += 1) await press(r, "stay-dates-calendar-next");
    for (let i = 0; i < 14; i += 1) await press(r, "stay-dates-calendar-prev");
    expect(onChange).not.toHaveBeenCalled();
    // Nothing was picked, so the readout is still empty: a month change wrote no check-in.
    const readout = r.root.findAll((n) => n.props.testID === "stay-dates-calendar-readout")[0];
    expect(readout.props.children).toBe("");
  });

  it("PlanDateTimeFields: month changes never change the plan; a day tap picks once and closes", async () => {
    const onChange = jest.fn();
    const r = await render(
      <PlanDateTimeFields value={{ date: "", time: "19:00" }} onChange={onChange} testIDPrefix="plan" />,
    );
    await press(r, "plan-date");
    for (let i = 0; i < 14; i += 1) await press(r, "plan-calendar-next");
    for (let i = 0; i < 14; i += 1) await press(r, "plan-calendar-prev");
    expect(onChange).not.toHaveBeenCalled();

    const today = new Date();
    const lastDay = ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    await press(r, `plan-calendar-day-${lastDay}`);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ date: lastDay, time: "19:00" });
    expect(r.root.findAll((n) => n.props.testID === "plan-calendar-next")).toHaveLength(0);
  });
});
