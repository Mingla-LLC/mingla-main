/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4456 device pass F-1 — the Unsend / Remove confirm sheet opens, Cancel and
 * the backdrop close it, it holds while busy, and a sheet that never reaches an
 * open snap point is closed by its watchdog (no invisible layer left behind).
 *
 * BaseBottomSheet is replaced by a host double that records its props, draws a
 * pressable backdrop only while visible, and reports the open snap through
 * onChange (unless a test says the open fails), the way gorhom does.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 * FAILS-ON-REVERT: go back to scrollMode="view" without snap points, or drop the
 * watchdog, and the matching case fails.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mockSheetState: { opens: boolean; lastProps: Record<string, unknown> | null } = { opens: true, lastProps: null };

jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactActual = jest.requireActual("react");
  const h = ReactActual.createElement;
  function BaseBottomSheet(props: Record<string, unknown>) {
    mockSheetState.lastProps = props;
    const visible = props.visible === true;
    ReactActual.useEffect(() => {
      const onChange = props.onChange as Function | undefined;
      if (visible && mockSheetState.opens && onChange) onChange(0);
    }, [visible]);
    if (!visible) return null;
    return h(
      "SheetHost",
      { testID: "sheet-host" },
      h("Backdrop", {
        testID: "sheet-backdrop",
        onPress: () => {
          if (props.backdropPressBehavior !== "none") (props.onClose as () => void)();
        },
      }),
      props.children as React.ReactNode,
    );
  }
  return { BaseBottomSheet };
});
jest.mock("../../ui/Icon", () => {
  const ReactActual = jest.requireActual("react");
  return { Icon: (props: Record<string, unknown>) => ReactActual.createElement("Icon", props) };
});

const { UnsendConfirmSheet, CONFIRM_OPEN_WATCHDOG_MS } = require("../UnsendConfirmSheet");

type Renderer = import("react-test-renderer").ReactTestRenderer;

const request = { ids: ["m1"], mode: "unsend", preview: "Bring the tickets" };

function render(props: Record<string, unknown>): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = TestRenderer.create(React.createElement(UnsendConfirmSheet, props));
  });
  return renderer as unknown as Renderer;
}

function byTestId(renderer: Renderer, id: string) {
  return renderer.root.findAll((node) => node.props?.testID === id && typeof node.type !== "string")[0]
    ?? renderer.root.findAll((node) => node.props?.testID === id)[0];
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSheetState.opens = true;
  mockSheetState.lastProps = null;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("#4456 UnsendConfirmSheet", () => {
  test("opens with a measurable body and the menu's snap cap", () => {
    const renderer = render({ request, busy: false, error: null, onCancel: jest.fn(), onConfirm: jest.fn() });
    expect(byTestId(renderer, "unsend-confirm-sheet")).toBeTruthy();
    expect(mockSheetState.lastProps?.visible).toBe(true);
    expect(mockSheetState.lastProps?.scrollMode).toBe("scroll");
    expect(mockSheetState.lastProps?.snapPoints).toEqual(["86%"]);
    expect(mockSheetState.lastProps?.wrapInRNModal).toBe(true);
  });

  test("Cancel closes it", () => {
    const onCancel = jest.fn();
    const renderer = render({ request, busy: false, error: null, onCancel, onConfirm: jest.fn() });
    act(() => { byTestId(renderer, "unsend-confirm-cancel").props.onPress(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("the backdrop closes it", () => {
    const onCancel = jest.fn();
    const renderer = render({ request, busy: false, error: null, onCancel, onConfirm: jest.fn() });
    act(() => { byTestId(renderer, "sheet-backdrop").props.onPress(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Unsend confirms; while busy Cancel, the backdrop and the drag hold", () => {
    const onConfirm = jest.fn();
    const renderer = render({ request, busy: false, error: null, onCancel: jest.fn(), onConfirm });
    act(() => { byTestId(renderer, "unsend-confirm-go").props.onPress(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const onCancel = jest.fn();
    const busy = render({ request, busy: true, error: null, onCancel, onConfirm: jest.fn() });
    act(() => { byTestId(busy, "sheet-backdrop").props.onPress(); });
    expect(onCancel).not.toHaveBeenCalled();
    expect(mockSheetState.lastProps?.enablePanDownToClose).toBe(false);
    expect(byTestId(busy, "unsend-confirm-cancel").props.disabled).toBe(true);
  });

  test("an opened sheet is never closed by the watchdog", () => {
    const onCancel = jest.fn();
    render({ request, busy: false, error: null, onCancel, onConfirm: jest.fn() });
    act(() => { jest.advanceTimersByTime(CONFIRM_OPEN_WATCHDOG_MS + 500); });
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("a sheet that never opens is closed, so no invisible layer stays", () => {
    mockSheetState.opens = false;
    const onCancel = jest.fn();
    const onOpenFailed = jest.fn();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    render({ request, busy: false, error: null, onCancel, onConfirm: jest.fn(), onOpenFailed });
    act(() => { jest.advanceTimersByTime(CONFIRM_OPEN_WATCHDOG_MS + 10); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenFailed).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("closed, it draws nothing", () => {
    const renderer = render({ request: null, busy: false, error: null, onCancel: jest.fn(), onConfirm: jest.fn() });
    expect(renderer.toJSON()).toBeNull();
  });
});
