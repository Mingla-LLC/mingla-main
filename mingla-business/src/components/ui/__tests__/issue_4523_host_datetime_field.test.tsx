import React from "react";

import { HostDateTimeField } from "../HostCalendarFields";

jest.mock("../Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));

type Node = { props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
  act: (callback: () => void | Promise<void>) => Promise<void> & void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = ReturnType<typeof TestRenderer.create>;

const mount = async (props: Partial<React.ComponentProps<typeof HostDateTimeField>>): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <HostDateTimeField
        label="Ends"
        accessibilityLabel="Ends"
        value={{ date: "2027-03-12", time: "19:00" }}
        onChangeValue={jest.fn()}
        timeZone="Africa/Lagos"
        testID="dt"
        {...props}
      />,
    );
  });
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  return tree;
};
const press = async (tree: Tree, testID: string): Promise<void> => {
  await TestRenderer.act(async () => {
    const hit = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
    if (hit === undefined) throw new Error(`nothing pressable: ${testID}`);
    (hit.props.onPress as () => void)();
  });
};
const exists = (tree: Tree, testID: string): boolean => tree.root.findAll((n) => n.props.testID === testID).length > 0;

describe("issue #4523 Host date-and-time field (discount end, ticket sale, schedule)", () => {
  it("is a picked field: no text input, and a stored value round-trips unchanged through Done", async () => {
    const onChangeValue = jest.fn();
    const tree = await mount({ onChangeValue });
    expect(tree.root.findAll((n) => n.props.placeholder !== undefined && typeof n.props.onChangeText === "function")).toHaveLength(0);
    await press(tree, "dt");
    await press(tree, "dt-calendar-done");
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenCalledWith({ date: "2027-03-12", time: "19:00" });
  });

  it("picking a day and a time commits exact wall-clock strings once, on Done only", async () => {
    const onChangeValue = jest.fn();
    const tree = await mount({ onChangeValue, value: { date: "", time: "" } });
    await press(tree, "dt");
    await press(tree, "dt-calendar-next");
    await press(tree, "dt-calendar-prev");
    expect(onChangeValue).not.toHaveBeenCalled();
    const grid = tree.root.findAll((n) => typeof n.props.testID === "string" && /^dt-calendar-day-\d{4}-\d{2}-15$/.test(n.props.testID as string));
    const dayId = grid.map((n) => n.props.testID as string)[0];
    await press(tree, dayId);
    await press(tree, "dt-calendar-time-20:30");
    expect(onChangeValue).not.toHaveBeenCalled();
    await press(tree, "dt-calendar-done");
    expect(onChangeValue).toHaveBeenCalledWith({ date: dayId.replace("dt-calendar-day-", ""), time: "20:30" });
  });

  it("an optional field's Clear commits no value and closes", async () => {
    const onClear = jest.fn();
    const onChangeValue = jest.fn();
    const tree = await mount({ onClear, onChangeValue });
    await press(tree, "dt");
    await press(tree, "dt-calendar-clear");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChangeValue).not.toHaveBeenCalled();
    expect(exists(tree, "dt-calendar-next")).toBe(false);
  });
});

// #4522 boot room: every Host calendar field loads the body through the ONE
// loader in HostCalendarPlaceholder, so the eager Host web payload carries a
// single import of the calendar chunk (not one per field owner).
describe("#4522 Host calendar fields share one body loader", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const read = (file: string): string => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const bodyImports = (src: string): number =>
    // Runtime imports only (`typeof import(...)` is a type and emits nothing).
    (src.match(/(?<!typeof )import\(\s*["']\.\/HostCalendarBody["']\s*\)/g) ?? []).length;

  it("only HostCalendarPlaceholder imports HostCalendarBody, exactly once", () => {
    expect(bodyImports(read("HostCalendarPlaceholder.tsx"))).toBe(1);
    for (const owner of ["DateField.tsx", "HostCalendarFields.tsx", "HostDateRangeField.tsx"]) {
      expect(bodyImports(read(owner))).toBe(0);
      expect(read(owner)).toContain("= lazyHostField<");
    }
  });
});
