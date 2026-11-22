/**
 * #4541 T-38 (SC-38 UI, R5.5) and the wave 4 Push row (R3.1, R7.3): Ask and
 * Remind on the shared Blast text allowance.
 *
 *   - The lines, in order: "{left} of {cap} texts left this month", "Shared
 *     with your Blasts.", "This send uses {n} texts", "{today} of 300 form
 *     texts used in the last 24 hours.", then, when texts are off, why.
 *   - Over the allowance or today's 300 the send is never blocked: texts are
 *     off for that send and email and push still go.
 *   - Push (free) follows the server's switch: "Push: not available yet" while
 *     it is off, and push is never sent then.
 *   - The delivery log says "Not texted: no texts left this month".
 *
 * FAILS-ON-REVERT: dropping the textsOff line, blocking canSendRequest on the
 * cap again, sending push while `pushAvailable` is false, or dropping the
 * `notTexted` log words turns a named case RED.
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
const previewInputs: unknown[] = [];

jest.mock("../../../hooks/useBrandForms", () => ({
  useFormRequestPreview: (input: unknown) => {
    previewInputs.push(input);
    return { data: previewData, isLoading: false, isError: false, isFetching: false, error: null, refetch: jest.fn() };
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
import { FORM_REQUEST_COPY as COPY } from "../brandFormsCopy";
import { allowanceLines, canSendRequest, requestChannels } from "../../../utils/formRequestCost";
import { parseFormRequestPreview } from "../../../services/brandFormRequestService";
import { logLine } from "../../../utils/formRequestLog";

const preview = (over: Partial<Preview> = {}): Preview => ({
  selectedCount: 40,
  reachableCount: 38,
  throttledCount: 0,
  smsOptedOutCount: 1,
  unreachableCount: 1,
  perChannelReachable: { push: 12, sms: 22, email: 38 },
  smsCount: 22,
  smsSegments: 1,
  estimatedCostMinor: 440000,
  currency: "NGN",
  textsToday: 12,
  textCap: 300,
  overTextCap: false,
  textsWaitUntil: null,
  pushAvailable: false,
  monthlyTextCap: 500,
  textsLeftThisMonth: 412,
  textsThisSendUses: 22,
  textsTodayUsed: 12,
  dailyTextCap: 300,
  textsOff: null,
  ...over,
});

const texts = (root: Node): string[] =>
  root.findAll((n) => n.type === "Text").map((n) =>
    React.Children.toArray(n.props.children as React.ReactNode).filter((c) => typeof c === "string").join(""),
  );

const mount = (): { root: Node; unmount: () => void } => {
  let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
  act(() => {
    r = create(
      <FormRequestSheet visible onClose={() => undefined} formId="f1" eventId="e1" mode="ask" notify={() => undefined} />,
    );
  });
  if (r === null) throw new Error("not mounted");
  return r;
};

beforeEach(() => {
  previewData = undefined;
  mutate.mockReset();
  previewInputs.length = 0;
});

describe("#4541 R5.5 the shared allowance lines", () => {
  test("plenty: the month, shared with Blasts, this send, today; no texts-off line", () => {
    previewData = preview();
    const r = mount();
    const t = texts(r.root);
    const order = [
      "412 of 500 texts left this month",
      "Shared with your Blasts.",
      "This send uses 22 texts",
      "12 of 300 form texts used in the last 24 hours.",
    ].map((line) => t.indexOf(line));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).not.toContain(COPY.textsOffMonthly);
    r.unmount();
  });

  test("not enough this month: texts off with the reason, and Send stays on", () => {
    previewData = preview({
      textsLeftThisMonth: 12,
      textsThisSendUses: 0,
      smsCount: 0,
      estimatedCostMinor: 0,
      textsOff: { reason: "monthly_allowance", needed: 22, remaining: 12 },
    });
    const r = mount();
    const t = texts(r.root);
    expect(t).toContain("Not enough texts left this month, so this send goes by email and push only.");
    expect(t).toContain("This send uses 0 texts");
    expect(t).toContain(COPY.noCost);
    const send = r.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-send")[0];
    expect(send?.props.disabled).toBe(false);
    r.unmount();
  });

  test("today's 300 reached: its own reason", () => {
    expect(allowanceLines(preview({ textsOff: { reason: "daily_cap", needed: 22, remaining: 0 } }), true).textsOff)
      .toBe("Today's text limit is reached, so this send goes by email and push only.");
  });

  test("a text limit never blocks; only no one reachable does", () => {
    expect(canSendRequest(preview({ overTextCap: true, textsOff: { reason: "daily_cap", needed: 1, remaining: 0 } }), false)).toBe(true);
    expect(canSendRequest(preview({ reachableCount: 0 }), true)).toBe(false);
    expect(COPY.nobody).toBe("No one can be reached by the channels you picked.");
  });

  test("the preview parser reads the allowance fields, and an older server falls back to today's numbers", () => {
    const p = parseFormRequestPreview({
      ok: true, reachableCount: 3, smsCount: 2, textsToday: 7, textCap: 300, pushAvailable: true,
      monthlyTextCap: 500, textsLeftThisMonth: 40, textsThisSendUses: 2, textsTodayUsed: 7, dailyTextCap: 300,
      textsOff: { reason: "monthly_allowance", needed: 50, remaining: 30 }, perChannelReachable: { push: 1, sms: 2, email: 3 },
    });
    expect(p.textsOff).toEqual({ reason: "monthly_allowance", needed: 50, remaining: 30 });
    expect([p.pushAvailable, p.monthlyTextCap, p.textsLeftThisMonth]).toEqual([true, 500, 40]);
    expect(p.perChannelReachable).toEqual({ push: 1, sms: 2, email: 3 });
    const old = parseFormRequestPreview({ ok: true, smsCount: 4, textsToday: 9, textCap: 300, textsOff: { reason: "nope" } });
    expect([old.textsThisSendUses, old.textsTodayUsed, old.dailyTextCap, old.monthlyTextCap, old.textsOff, old.pushAvailable])
      .toEqual([4, 9, 300, null, null, false]);
  });

  test("the delivery log names a guest not texted because the month ran out", () => {
    const line = logLine({
      id: "s1", kind: "ask", subjectKind: "rsvp", subjectId: "r1", name: "Ada D.", channel: "email", status: "sent",
      reason: "no_texts_left", notBefore: null, createdAt: "2028-03-01T10:00:00Z", settledAt: null,
    });
    expect(line).toContain("Ada D. · Ask · Email · Sent · Not texted: no texts left this month");
  });
});

describe("#4541 R3.1 the Push channel follows the server's switch", () => {
  test("switch off: 'Push: not available yet', disabled, and push is never sent", () => {
    previewData = preview({ pushAvailable: false });
    const r = mount();
    const chip = r.root.findAll((n) => n.type === "Chip" && n.props.testID === "form-request-channel-push-unavailable")[0];
    expect(chip?.props.label).toBe("Push: not available yet");
    expect(chip?.props.disabled).toBe(true);
    expect(r.root.findAll((n) => n.type === "Chip" && n.props.testID === "form-request-channel-push")).toHaveLength(0);
    expect(requestChannels(["push", "sms", "email"], false)).toEqual(["sms", "email"]);
    act(() => {
      r.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-send")[0]?.props.onPress();
    });
    act(() => {
      r.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-confirm")[0]?.props.onPress();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    const sent = mutate.mock.calls[0]?.[0] as { channels: string[] };
    expect(sent.channels).not.toContain("push");
    r.unmount();
  });

  test("switch on: 'Push (free)' is ticked once, with the line about who gets it, and goes with the send", () => {
    previewData = preview({ pushAvailable: true });
    const r = mount();
    const chip = r.root.findAll((n) => n.type === "Chip" && n.props.testID === "form-request-channel-push")[0];
    expect(chip?.props.label).toBe("Push (free)");
    expect(chip?.props.selected).toBe(true);
    expect(texts(r.root)).toContain("Push (free) · app users on the latest version");
    act(() => {
      r.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-send")[0]?.props.onPress();
    });
    act(() => {
      r.root.findAll((n) => n.type === "Button" && n.props.testID === "form-request-confirm")[0]?.props.onPress();
    });
    const sent = mutate.mock.calls[0]?.[0] as { channels: string[] };
    expect(sent.channels).toContain("push");
    r.unmount();
  });
});
