/** Issue #2726 independent tester guards: real RNW rail interaction contract. */
import React from "react";
import { AccessibilityInfo } from "react-native";

interface RenderNode {
  props: Record<string, unknown>;
  find: (predicate: (node: RenderNode) => boolean) => RenderNode;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface RenderTree { root: RenderNode; unmount: () => void }
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

import { SuiteDesktopShell } from "../../suite/SuiteDesktopShell";

const modules = [
  { key: "overview", label: "Overview", group: "Venue" },
  { key: "tables", label: "Tables", group: "Bookings" },
  { key: "availability", label: "Availability", group: "Bookings" },
  { key: "menu", label: "Menu", group: "Operations" },
] as const;

function byTestId(root: RenderNode, testID: string): RenderNode {
  return root.find((node) => node.props.testID === testID);
}

function keyboardEvent(key: string): { key: string; preventDefault: jest.Mock } {
  return { key, preventDefault: jest.fn() };
}

describe("#2726 tester adversarial web rail", () => {
  beforeEach(() => {
    (global as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (global as typeof globalThis & { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
      (callback) => { callback(); return 1; };
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() });
  });

  it("emits the selected state into the real RNW DOM for every tab", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SuiteDesktopShell modules={modules} activeModule="availability" onSelect={jest.fn()}
        workspaceSelfScrolls scrollBottomPad={0} railTestIdPrefix="test-rail-">
        <span>Workspace</span>
      </SuiteDesktopShell>,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/aria-selected="false"/g)).toHaveLength(3);
  });

  it("uses one tablist, non-accessible group labels, and one roving tab stop", async () => {
    let tree!: RenderTree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <SuiteDesktopShell modules={modules} activeModule="availability" onSelect={jest.fn()}
          workspaceSelfScrolls scrollBottomPad={0} railTestIdPrefix="test-rail-">
          <span>Workspace</span>
        </SuiteDesktopShell>,
      );
    });
    expect(tree.root.findAll((node) => node.props.accessibilityRole === "tablist")).toHaveLength(1);
    const tabs = modules.map((module) => byTestId(tree.root, `test-rail-${module.key}`));
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([-1, -1, 0, -1]);
    const headings = tree.root.findAll((node) => node.props.accessible === false)
      .map((node) => node.props.children).filter((child) => typeof child === "string");
    expect(new Set(headings)).toEqual(new Set(["Venue", "Bookings", "Operations"]));
    TestRenderer.act(() => tree.unmount());
  });

  it.each([
    ["ArrowDown", "tables", "availability"],
    ["ArrowUp", "overview", "menu"],
    ["Home", "menu", "overview"],
    ["End", "overview", "menu"],
    ["Enter", "tables", "tables"],
    [" ", "tables", "tables"],
  ] as const)("%s selects the expected tab and supplies a focus-return callback", async (key, from, expected) => {
    const onSelect = jest.fn();
    let tree!: RenderTree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <SuiteDesktopShell modules={modules} activeModule={from} onSelect={onSelect}
          workspaceSelfScrolls scrollBottomPad={0} railTestIdPrefix="test-rail-">
          <span>Workspace</span>
        </SuiteDesktopShell>,
      );
    });
    const event = keyboardEvent(key);
    TestRenderer.act(() => {
      const handler = byTestId(tree.root, `test-rail-${from}`).props.onKeyDown;
      if (typeof handler !== "function") throw new Error("missing web keyboard handler");
      handler(event);
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe(expected);
    expect(onSelect.mock.calls[0][1]).toEqual(expect.any(Function));
    TestRenderer.act(() => tree.unmount());
  });

  it("does not emit an orphan heading when the filtered modules omit Bookings", async () => {
    const filtered = modules.filter((module) => module.group !== "Bookings");
    let tree!: RenderTree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <SuiteDesktopShell modules={filtered} activeModule="overview" onSelect={jest.fn()}
          workspaceSelfScrolls scrollBottomPad={0} railTestIdPrefix="test-rail-">
          <span>Workspace</span>
        </SuiteDesktopShell>,
      );
    });
    const labels = tree.root.findAll((node) => node.props.accessible === false)
      .map((node) => node.props.children).filter((child) => typeof child === "string");
    expect(new Set(labels)).toEqual(new Set(["Venue", "Operations"]));
    TestRenderer.act(() => tree.unmount());
  });
});
