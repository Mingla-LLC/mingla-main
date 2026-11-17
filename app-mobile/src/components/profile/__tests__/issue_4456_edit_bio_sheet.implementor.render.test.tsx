/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4456 — Profile → Edit bio froze (Seth, on his phone): the sheet's body was a
 * plain View that gorhom's dynamic sizing cannot measure, so it never opened
 * while its modal window swallowed every touch. This mounts EditBioSheet: it
 * opens with a measurable scroll body and a snap cap, Save saves the trimmed
 * bio and closes, the X and the backdrop close it, and Save is off until the
 * bio changes.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 * FAILS-ON-REVERT: put scrollMode="view" back (or drop the snap cap) and the
 * first case fails.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mockSheet: { lastProps: Record<string, unknown> | null } = { lastProps: null };

jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  function BaseBottomSheet(props: Record<string, unknown>) {
    mockSheet.lastProps = props;
    if (props.visible !== true) return null;
    return h(
      "SheetHost",
      null,
      h("Backdrop", { testID: "sheet-backdrop", onPress: () => (props.onClose as Function)() }),
      props.children,
    );
  }
  function BottomSheetTextInput(props: Record<string, unknown>) {
    return h("BottomSheetTextInput", props);
  }
  return { BaseBottomSheet, BottomSheetTextInput };
});
jest.mock("../../ui/Icon", () => {
  const ReactActual = jest.requireActual("react");
  return { Icon: (props: Record<string, unknown>) => ReactActual.createElement("Icon", props) };
});

const EditBioSheet = require("../EditBioSheet").default;

type Renderer = import("react-test-renderer").ReactTestRenderer;

function render(props: Record<string, unknown>): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(React.createElement(EditBioSheet, props));
  });
  return renderer as unknown as Renderer;
}
function byTestId(renderer: Renderer, id: string) {
  return renderer.root.findAll((node) => node.props?.testID === id)[0];
}

beforeEach(() => {
  mockSheet.lastProps = null;
});

describe("#4456 EditBioSheet", () => {
  test("opens with a measurable scroll body, a snap cap and the keyboard behaviour", () => {
    const renderer = render({ visible: true, onClose: jest.fn(), currentBio: "Hi", onSave: jest.fn() });
    expect(byTestId(renderer, "edit-bio-input")).toBeTruthy();
    expect(mockSheet.lastProps?.scrollMode).toBe("scroll");
    expect(mockSheet.lastProps?.snapPoints).toEqual(["86%"]);
    expect(mockSheet.lastProps?.enableDynamicSizing).toBe(true);
    expect(mockSheet.lastProps?.wrapInRNModal).toBe(true);
    expect(mockSheet.lastProps?.keyboardBehavior).toBe("interactive");
    expect(mockSheet.lastProps?.android_keyboardInputMode).toBe("adjustResize");
  });

  test("Save is off until the bio changes, then saves the trimmed bio and closes", () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const renderer = render({ visible: true, onClose, currentBio: "Hi", onSave });
    expect(byTestId(renderer, "edit-bio-save").props.disabled).toBe(true);
    act(() => { byTestId(renderer, "edit-bio-input").props.onChangeText("  Night walks and chess  "); });
    expect(byTestId(renderer, "edit-bio-save").props.disabled).toBe(false);
    act(() => { byTestId(renderer, "edit-bio-save").props.onPress(); });
    expect(onSave).toHaveBeenCalledWith("Night walks and chess");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the X and the backdrop close it", () => {
    const onClose = jest.fn();
    const renderer = render({ visible: true, onClose, currentBio: "Hi", onSave: jest.fn() });
    act(() => { byTestId(renderer, "edit-bio-close").props.onPress(); });
    act(() => { byTestId(renderer, "sheet-backdrop").props.onPress(); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("closed, it draws nothing", () => {
    const renderer = render({ visible: false, onClose: jest.fn(), currentBio: "Hi", onSave: jest.fn() });
    expect(renderer.toJSON()).toBeNull();
  });
});
