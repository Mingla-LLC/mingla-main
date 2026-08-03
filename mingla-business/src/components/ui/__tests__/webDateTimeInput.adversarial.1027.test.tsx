/**
 * issue #1027 — Thread B (business web date/time) · TESTER ADVERSARIAL regression.
 * Two different angles than the implementor suites (which prove the three MAIN
 * When rows commit on web + source-pin the 7 surfaces):
 *
 *   PART A — the shared control's edge behaviour, EXECUTED (react-test-renderer):
 *     - EMPTY / cleared value: onChange with `""` forwards `""` to onChangeValue and
 *       does NOT throw (a real date/time input emits "" until complete / on clear —
 *       the shared control must survive it; callers own their own empty guard).
 *     - ERROR-STATE styling: `hasError` draws the semantic.error border; the default
 *       draws the base glass border (the error affordance actually renders).
 *     - VISIBLE / hit-testable: the rendered <input> is NOT hidden — no `opacity: 0`,
 *       no `pointerEvents: "none"` (the exact regression that made the old bridge
 *       un-dismissable + dead). Asserted on the RENDERED style object, not source.
 *     - default + explicit testID; colorScheme "dark"; disabled passthrough.
 *
 *   PART B — native parity / NO WEB LEAK, EXECUTED: with Platform.OS === "ios",
 *     mounting the REAL `CreatorStep2When` renders ZERO web `<input>` host nodes —
 *     the visible web inputs must never leak onto native (the native Sheet/
 *     DateTimePicker path owns iOS/Android). The implementor render suite only
 *     exercised the web target; this proves the other side of the Platform gate.
 *
 * FAILS-ON-REVERT (tester-verified): re-add `opacity: 0` / `pointerEvents: "none"`
 * to WebDateTimeInput's BASE_STYLE → PART A "visible" assertions go RED; drop the
 * `hasError` border branch → the error-border assertion goes RED; remove a
 * `Platform.OS === "web"` gate so WebDateTimeInput renders unconditionally → PART B
 * finds web inputs on native and goes RED.
 *
 * I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT.
 */

import React from "react";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { WebDateTimeInput } from "../WebDateTimeInput";
import { glass, semantic } from "../../../constants/designSystem";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

async function renderInput(
  props: Record<string, unknown>,
): Promise<{ tree: Tree; input: HostNode }> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(
      React.createElement(
        WebDateTimeInput as unknown as React.FC<Record<string, unknown>>,
        props,
      ),
    );
  });
  const tree = created as Tree;
  const input = tree.root.findAll((n) => n.type === "input")[0];
  expect(input).toBeDefined();
  return { tree, input };
}

describe("issue #1027 Thread B ADVERSARIAL · Part A — shared WebDateTimeInput edge behaviour", () => {
  test("EMPTY value: onChange('') forwards '' and does not throw", async () => {
    const got: string[] = [];
    const { tree, input } = await renderInput({
      type: "date",
      value: "2026-08-01",
      ariaLabel: "Pick a date",
      onChangeValue: (v: string) => got.push(v),
    });
    let threw = false;
    await TestRenderer.act(() => {
      try {
        (input.props.onChange as (e: { target: { value: string } }) => void)({
          target: { value: "" },
        });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(got).toContain("");
    tree.unmount();
  });

  test("ERROR state draws the semantic.error border; default draws the base glass border", async () => {
    const err = await renderInput({
      type: "time",
      value: "",
      ariaLabel: "t",
      hasError: true,
      onChangeValue: () => undefined,
    });
    expect((err.input.props.style as Record<string, unknown>).borderColor).toBe(
      semantic.error,
    );
    err.tree.unmount();

    const ok = await renderInput({
      type: "time",
      value: "",
      ariaLabel: "t",
      onChangeValue: () => undefined,
    });
    expect((ok.input.props.style as Record<string, unknown>).borderColor).toBe(
      glass.border.profileBase,
    );
    ok.tree.unmount();
  });

  test("rendered input is VISIBLE / hit-testable — no opacity:0, no pointerEvents:none", async () => {
    const { tree, input } = await renderInput({
      type: "date",
      value: "",
      ariaLabel: "x",
      onChangeValue: () => undefined,
    });
    const style = input.props.style as Record<string, unknown>;
    expect(style.opacity).not.toBe(0);
    expect(style.pointerEvents).toBeUndefined();
    expect(style.colorScheme).toBe("dark");
    tree.unmount();
  });

  test("default testID applied; explicit testID + type + disabled pass through", async () => {
    const dflt = await renderInput({
      type: "date",
      value: "",
      ariaLabel: "x",
      onChangeValue: () => undefined,
    });
    expect(dflt.input.props["data-testid"]).toBe("web-native-datetime-input");
    dflt.tree.unmount();

    const explicit = await renderInput({
      type: "datetime-local",
      value: "",
      ariaLabel: "x",
      disabled: true,
      testID: "my-id",
      onChangeValue: () => undefined,
    });
    expect(explicit.input.props["data-testid"]).toBe("my-id");
    expect(explicit.input.props.type).toBe("datetime-local");
    expect(explicit.input.props.disabled).toBe(true);
    explicit.tree.unmount();
  });
});

describe("issue #1027 Thread B ADVERSARIAL · Part B — native parity (NO web input leaks onto native)", () => {
  const originalOS = Platform.OS;
  beforeAll(() => {
    (Platform as { OS: string }).OS = "ios";
  });
  afterAll(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  // The heavy children are stubbed so only CreatorStep2When's own body renders;
  // the native DateTimePicker is mocked to null. On iOS the web WebDateTimeInput
  // rows are gated OFF — so there must be zero <input> host nodes in the tree.
  jest.mock("@react-native-community/datetimepicker", () => ({
    __esModule: true,
    default: (): null => null,
  }));
  jest.mock("../../../wrappers/SmartScrollView", () => {
    const R = require("react") as typeof React;
    return {
      __esModule: true,
      ScrollView: ({ children }: { children?: React.ReactNode }) =>
        R.createElement(R.Fragment, null, children),
    };
  });
  jest.mock("../Sheet", () => ({ __esModule: true, Sheet: (): null => null }));
  jest.mock("../Icon", () => ({ __esModule: true, Icon: (): null => null }));
  jest.mock("../Button", () => ({ __esModule: true, Button: (): null => null }));
  jest.mock("../Input", () => ({ __esModule: true, Input: (): null => null }));
  jest.mock("../ConfirmDialog", () => ({
    __esModule: true,
    ConfirmDialog: (): null => null,
  }));
  jest.mock("../../event/CreatorStep2WhenRepeatPickerSheet", () => ({
    __esModule: true,
    CreatorStep2WhenRepeatPickerSheet: (): null => null,
  }));
  jest.mock("../../event/MultiDateOverrideSheet", () => ({
    __esModule: true,
    MultiDateOverrideSheet: (): null => null,
  }));

  test("Platform.OS === 'ios' → CreatorStep2When renders zero web <input> nodes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CreatorStep2When } = require("../../event/CreatorStep2When") as {
      CreatorStep2When: React.FC<Record<string, unknown>>;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildDraftEvent } = require("../../../store/draftEventStore") as {
      buildDraftEvent: (brandId: string) => Record<string, unknown>;
    };
    let created: Tree | undefined;
    await TestRenderer.act(() => {
      created = TestRenderer.create(
        React.createElement(CreatorStep2When, {
          draft: {
            ...buildDraftEvent("brand_1027_native"),
            whenMode: "single",
            date: null,
            doorsOpen: null,
            endsAt: null,
            endsAtUtc: null,
            timezone: "Europe/London",
          },
          updateDraft: () => undefined,
          errors: [],
          showErrors: false,
          onShowToast: () => undefined,
          scrollToBottom: () => undefined,
        }),
      );
    });
    const tree = created as Tree;
    const webInputs = tree.root.findAll((n) => n.type === "input");
    expect(webInputs).toHaveLength(0);
    tree.unmount();
  });
});
