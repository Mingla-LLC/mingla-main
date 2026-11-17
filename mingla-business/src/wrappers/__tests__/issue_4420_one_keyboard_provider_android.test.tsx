// @ts-nocheck -- the test supplies a minimal host-component RN runtime.
// #4420 / #4238 — one KeyboardProvider per app on Android.
//
// Bug: on Android, after any bottom Sheet or Modal opened and closed once, the
// keyboard covered every full-screen form for the rest of the session. Sheet.tsx
// and Modal.tsx (ORCH-1170) mounted a second KeyboardRoot inside their RN Modal.
// Each native provider owns a ModalAttachedWatcher; on the Modal's `topShow`
// each watcher suspends its own main-window keyboard callback and calls
// `dialog.setOnDismissListener(...)` to resume it. A Dialog keeps one dismiss
// listener, so the nested provider's watcher replaced the root's: on close the
// app-root callback stayed suspended and no keyboard events reached the app.
//
// This mounts the REAL KeyboardRoot (native variant) the way Sheet/Modal do —
// a KeyboardRoot nested inside the app-root KeyboardRoot — and counts native
// providers. Android must mount exactly one; iOS keeps the per-window provider.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "android" };

jest.mock("react-native", () => {
  const ReactLocal = require("react");
  return {
    View: (props: any) => ReactLocal.createElement("View", props, props.children),
    Platform: mockPlatform,
  };
});
jest.mock("react-native-keyboard-controller", () => {
  const ReactLocal = require("react");
  return {
    KeyboardProvider: (props: any) =>
      ReactLocal.createElement("KeyboardProvider", null, props.children),
  };
});

const { KeyboardRoot, skipsNestedProvider } = require("../KeyboardRoot.native");
const { View } = require("react-native");

const mountSheetInsideApp = () => {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <KeyboardRoot>
        <View testID="screen" />
        {/* what SheetMobile.tsx / Modal.tsx render inside their RN Modal */}
        <KeyboardRoot>
          <View testID="sheet-body" />
        </KeyboardRoot>
      </KeyboardRoot>,
    );
  });
  return tree!;
};

describe("#4420 KeyboardRoot — one native keyboard provider on Android", () => {
  afterEach(() => {
    mockPlatform.OS = "android";
  });

  it("Android: a sheet's nested KeyboardRoot mounts NO second provider", () => {
    mockPlatform.OS = "android";
    const tree = mountSheetInsideApp();
    expect(tree.root.findAllByType("KeyboardProvider")).toHaveLength(1);
    // the sheet body still renders, under the app-root provider
    const body = tree.root.findByProps({ testID: "sheet-body" });
    expect(body).toBeTruthy();
  });

  it("Android: the app-root KeyboardRoot still mounts its provider", () => {
    mockPlatform.OS = "android";
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <KeyboardRoot>
          <View testID="screen" />
        </KeyboardRoot>,
      );
    });
    expect(tree!.root.findAllByType("KeyboardProvider")).toHaveLength(1);
  });

  it("iOS: the sheet keeps its own per-window provider (ORCH-1170 unchanged)", () => {
    mockPlatform.OS = "ios";
    const tree = mountSheetInsideApp();
    expect(tree.root.findAllByType("KeyboardProvider")).toHaveLength(2);
  });

  it("skipsNestedProvider is Android-and-nested only", () => {
    expect(skipsNestedProvider("android", true)).toBe(true);
    expect(skipsNestedProvider("android", false)).toBe(false);
    expect(skipsNestedProvider("ios", true)).toBe(false);
    expect(skipsNestedProvider("ios", false)).toBe(false);
  });

  it("Sheet and Modal reach the library only through KeyboardRoot", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    for (const file of ["SheetMobile.tsx", "Modal.tsx"]) {
      const source = fs
        .readFileSync(path.join(__dirname, "..", "..", "components", "ui", file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .split("\n")
        .map((line: string) => line.replace(/^\s*\/\/.*$/, ""))
        .join("\n");
      // A direct <KeyboardProvider> in a Modal window would bring the second
      // native watcher (and the stuck keyboard) back on Android.
      expect(source).not.toMatch(/<KeyboardProvider[\s>]/);
      expect(source).toMatch(/<KeyboardRoot>/);
    }
  });
});
