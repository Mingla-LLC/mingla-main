/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4523 checkpoint 17 — the Explorer's form date input (RSVP and brand-form
 * date questions) is the Mingla calendar, drawn inline in the form's palette:
 * no browser date box, no OS picker. Changing month never closes it or commits;
 * a day tap stores `YYYY-MM-DD`, byte-identical to the old browser date box's
 * value and the old native path's conversion for the same day. Runs under
 * app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("@react-native-community/datetimepicker", () => {
  throw new Error("a form date question must never load the OS date picker (#4523)");
});

const { RsvpFormWebDateInput } = require("../RsvpFormWebDateInput");

type Instance = import("react-test-renderer").ReactTestInstance;
type Renderer = import("react-test-renderer").ReactTestRenderer;

const LIGHT_FORM_TOKENS = {
  color: {
    danger: "#EF4444", warning: "#F59E0B", accent: "#7c3aed", accentLine: "#7c3aed", line: "#e5e7eb",
    text1: "#111827", text2: "#374151", text3: "#6b7280", text4: "#9ca3af", textStrong: "#ffffff",
    fill: { inset: "#f3f4f6" },
  },
  radius: { sm: 8, md: 12 },
  space: { 1: 4, 2: 8, 4: 16, 6: 24 },
  type: { body: { fontSize: 16, lineHeight: 24 }, caption: { fontSize: 12, lineHeight: 16 }, small: { fontSize: 14, lineHeight: 20 } },
};

/** The pre-#4523 native path's conversion (form-rendering `dateToIso`). */
const legacyNativeIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

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
const isOpen = (r: Renderer): boolean => pressables(r, (n) => n.props.testID === "rsvp-date-calendar-next").length > 0;

describe("#4523 Explorer form date input", () => {
  it("renders no browser date box; month changes never close or commit; a day tap stores YYYY-MM-DD once", async () => {
    const onChangeValue = jest.fn();
    const r = await render(
      <RsvpFormWebDateInput type="date" value="" onChangeValue={onChangeValue} ariaLabel="Arrival day" testID="rsvp-date" tokens={LIGHT_FORM_TOKENS} />,
    );
    expect(r.root.findAll((n) => n.type === "input")).toHaveLength(0);
    const trigger = pressables(r, (n) => n.props.testID === "rsvp-date")[0];
    expect(trigger.props.accessibilityLabel).toBe("Arrival day, not set");
    expect(trigger.props.accessibilityHint).toBe("Opens calendar");

    await press(r, "rsvp-date");
    expect(isOpen(r)).toBe(true);
    for (let i = 0; i < 14; i += 1) await press(r, "rsvp-date-calendar-next");
    for (let i = 0; i < 13; i += 1) await press(r, "rsvp-date-calendar-prev");
    expect(isOpen(r)).toBe(true);
    expect(onChangeValue).not.toHaveBeenCalled();

    const day = pressables(r, (n) => typeof n.props.testID === "string" && /^rsvp-date-calendar-day-\d{4}-\d{2}-20$/.test(n.props.testID as string))[0];
    const picked = (day.props.testID as string).replace("rsvp-date-calendar-day-", "");
    await press(r, day.props.testID as string);
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenCalledWith(picked);
    const [y, m, d] = picked.split("-").map(Number);
    expect(onChangeValue.mock.calls[0][0]).toBe(legacyNativeIso(new Date(y, m - 1, d)));
    expect(isOpen(r)).toBe(false);
  });

  it("a stored answer is spoken in long form; tapping the row again closes without a change", async () => {
    const onChangeValue = jest.fn();
    const r = await render(
      <RsvpFormWebDateInput type="date" value="2027-03-12" onChangeValue={onChangeValue} ariaLabel="Arrival day" testID="rsvp-date" tokens={LIGHT_FORM_TOKENS} />,
    );
    const trigger = pressables(r, (n) => n.props.testID === "rsvp-date")[0];
    expect(String(trigger.props.accessibilityLabel)).toMatch(/^Arrival day, .*12.*2027/);
    await press(r, "rsvp-date");
    expect(isOpen(r)).toBe(true);
    await press(r, "rsvp-date");
    expect(isOpen(r)).toBe(false);
    expect(onChangeValue).not.toHaveBeenCalled();
  });

  it("a disabled answer cannot be opened", async () => {
    const r = await render(
      <RsvpFormWebDateInput type="date" value="" onChangeValue={jest.fn()} ariaLabel="Arrival day" testID="rsvp-date" disabled />,
    );
    const trigger = pressables(r, (n) => n.props.testID === "rsvp-date")[0];
    expect(trigger.props.disabled).toBe(true);
    expect(isOpen(r)).toBe(false);
  });
});
