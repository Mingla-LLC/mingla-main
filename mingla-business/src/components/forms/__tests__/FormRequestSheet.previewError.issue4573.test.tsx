/**
 * #4573 P3: after a refused send the preview is read again; when that read fails the sheet keeps the
 * last data, so Send must stay off while the preview shows an error.
 *
 * FAILS-ON-REVERT: dropping `!preview.isError` from canSend turns the disabled case RED.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; toJSON: () => unknown; unmount: () => void };
  act: (cb: () => void) => void;
};

type Preview = import("../../../services/brandFormRequestService").FormRequestPreview;
let previewData: Preview | undefined;
const mutate = jest.fn();
let previewIsError = false;
const previewInputs: unknown[] = [];

jest.mock("../../../hooks/useBrandForms", () => ({
  useFormRequestPreview: (input: unknown) => {
    previewInputs.push(input);
    return { data: previewData, isLoading: false, isError: previewIsError, isFetching: false, error: previewIsError ? new Error('x') : null, refetch: jest.fn() };
  },
  useSendFormRequest: () => ({ mutate, isPending: false }),
  useSetFormAutoRemind: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../useFormsToast", () => ({ errorSentence: (_e: unknown, fallback: string) => fallback }));
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Sheet: ({ children }: { children: React.ReactNode }) => R.createElement("Sheet", null, children) };
});
jest.mock("../../ui/SheetScrollLayout", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    SheetScrollLayout: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) =>
      R.createElement("Layout", null, children, footer),
  };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props) };
});
jest.mock("../../ui/Pill", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Chip: (props: Record<string, unknown>) => R.createElement("Chip", props) };
});
jest.mock("../../ui/Switch", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Switch: (props: Record<string, unknown>) => R.createElement("Switch", props) };
});

import { FormRequestSheet } from "../FormRequestSheet";

const data = {
  selectedCount: 4, reachableCount: 4, throttledCount: 0, smsOptedOutCount: 0, unreachableCount: 0,
  perChannelReachable: { push: 0, sms: 0, email: 4 }, smsCount: 0, smsSegments: 0, estimatedCostMinor: 0,
  currency: "NGN", textsToday: 0, textCap: 300, overTextCap: false, textsWaitUntil: null, pushAvailable: false,
  monthlyTextCap: 500, textsLeftThisMonth: 500, textsThisSendUses: 0, textsTodayUsed: 0, dailyTextCap: 300, textsOff: null,
} as unknown as Preview;

const sendDisabled = (): unknown => {
  let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
  act(() => {
    r = create(<FormRequestSheet visible onClose={() => undefined} formId="f1" eventId="e1" mode="ask" notify={() => undefined} />);
  });
  if (r === null) throw new Error("not mounted");
  const mounted = r as { root: Node; unmount: () => void };
  const disabled = mounted.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-send")[0]?.props.disabled;
  act(() => mounted.unmount());
  return disabled;
};

beforeEach(() => {
  previewData = data;
  previewIsError = false;
});

describe("#4573 Send follows the preview's error state", () => {
  test("a healthy preview: Send is enabled", () => {
    expect(sendDisabled()).toBe(false);
  });
  test("the refreshed preview failed (old data kept): Send is disabled", () => {
    previewIsError = true;
    expect(sendDisabled()).toBe(true);
  });
});
