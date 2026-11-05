// #4273 — crossing the desktop breakpoint must not remount what is on screen: an
// open composer would lose its text, its ticks and its picker.
//
// MINGLA-INVARIANT: I-4273-CANVAS-SAME-TREE-ACROSS-BREAKPOINT | issue #4273 | DesktopCanvas renders one tree on web at every width, so routes under it keep their state when the width crosses 1024.
import React, { useEffect } from "react";
import { Platform } from "react-native";

const mockLayout = { isWideDesktop: false };
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => mockLayout,
}));

import { DesktopCanvas } from "../../ui/DesktopCanvas";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { update: (node: React.ReactElement) => void; unmount: () => void };
  act: (callback: () => void) => void;
};

describe("#4273 DesktopCanvas across the breakpoint", () => {
  const original = Platform.OS;
  beforeAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" }); });
  afterAll(() => { Object.defineProperty(Platform, "OS", { configurable: true, get: () => original }); });

  it("keeps the child mounted both ways", () => {
    const mounts = jest.fn();
    const unmounts = jest.fn();
    const Child = (): null => {
      useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return null;
    };
    const tree = (): React.ReactElement => <DesktopCanvas><Child /></DesktopCanvas>;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => { renderer = TestRenderer.create(tree()); });
    mockLayout.isWideDesktop = true;
    TestRenderer.act(() => renderer.update(tree()));
    mockLayout.isWideDesktop = false;
    TestRenderer.act(() => renderer.update(tree()));
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();
    TestRenderer.act(() => renderer.unmount());
  });
});
