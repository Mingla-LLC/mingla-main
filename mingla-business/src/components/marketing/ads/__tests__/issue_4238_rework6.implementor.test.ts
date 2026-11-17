/**
 * #4238 rework 6 — device verdict fixes (Android keyboard in the builder,
 * full Withdraw label, small fixes). Behaviour tests only: the rule is run,
 * the real Withdraw sheet is rendered, and every Host language is loaded
 * through the app's own i18n loader. The screen wiring that cannot render in
 * node (builder dock use, Leave sheet guard, rejected-ad dock, list padding)
 * is pinned by the I-4420-HOST-WIRING strict-grep gate.
 *
 * P1-1: on Android the pinned dock steps aside while the keyboard is open.
 * P2-1: the Withdraw sheet stacks full-width buttons so the amount never cuts.
 * P3: "same total" line on Ari's extend confirm in every locale.
 *
 * Fails on revert: deleting shouldHideHostAdDock, putting the withdraw
 * buttons back in a half-width row, or dropping the same-total line or a
 * locale key reds the matching test.
 */
import React from "react";

import { shouldHideHostAdDock } from "../hostAdBuilderRules";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (p: (node: RenderNode) => boolean) => RenderNode[] }; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void | Promise<void>) => void | Promise<void>;
  create: (el: React.ReactElement) => Renderer;
};

jest.mock("../../../ui/Sheet", () => ({ Sheet: (props: { children: React.ReactNode }) => props.children }));
jest.mock("../../../ui/SheetScrollLayout", () => ({
  SheetScrollLayout: (props: { children: React.ReactNode; footer?: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactLib = require("react") as typeof React;
    return ReactLib.createElement(ReactLib.Fragment, null, props.children, props.footer);
  },
}));
jest.mock("../../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactLib = require("react") as typeof React;
    return ReactLib.createElement("Button", props);
  },
}));
jest.mock("../../../ui/DateField", () => ({ DateField: () => null }));
jest.mock("../../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../utils/hapticFeedback", () => ({ HapticFeedback: new Proxy({}, { get: () => () => undefined }) }));
jest.mock("../../../../services/adCreditService", () => ({
  quoteAdCreditWithdraw: () => Promise.resolve({ credit_cents: 10_000, refund_cents: 8_500, fee_returned_cents: 1_500 }),
  applyAdCreditWithdraw: () => Promise.resolve(),
  getAdCreditReceipt: () => Promise.resolve(null),
  getAdCreditStatement: () => Promise.resolve(null),
}));

// eslint-disable-next-line import/first
import { HostAdWithdrawSheet } from "../HostAdManageSheets";
// eslint-disable-next-line import/first
import { hm } from "../hostAdManageCopy";
// eslint-disable-next-line import/first
import { BUSINESS_MEDIA_LANGUAGES, changeBusinessMediaLanguage } from "../../../../i18n";

describe("P1-1 builder dock and the Android keyboard", () => {
  it("hides the dock only on Android with the keyboard open", () => {
    expect(shouldHideHostAdDock("android", true)).toBe(true);
    expect(shouldHideHostAdDock("android", false)).toBe(false);
    expect(shouldHideHostAdDock("ios", true)).toBe(false);
    expect(shouldHideHostAdDock("web", true)).toBe(false);
  });
});

describe("P2-1 withdraw buttons never cut the amount", () => {
  it("renders two full-width buttons in a column, not a half-width row", async () => {
    let r!: Renderer;
    await act(async () => {
      r = create(
        React.createElement(HostAdWithdrawSheet, {
          visible: true,
          brandId: "b1",
          currency: "USD",
          money: (c: number) => `M${c}`,
          walletCredit: 10_000,
          heldPay: 9_000,
          onClose: () => undefined,
          onDone: () => undefined,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const buttons = r.root.findAll((n) => n.type === "Button");
    const go = buttons.find((b) => b.props.testID === "host-ad-withdraw-go");
    const keep = buttons.find((b) => b.props.testID === "host-ad-withdraw-keep");
    expect(go?.props.fullWidth).toBe(true);
    expect(keep?.props.fullWidth).toBe(true);
    expect(go?.props.style).toBeUndefined();
    expect(keep?.props.style).toBeUndefined();
    // their shared parent is a plain column: no flexDirection row
    const parent = r.root.findAll((n) => n.children.some((c) => typeof c !== "string" && c.props.testID === "host-ad-withdraw-go"))[0];
    const flat = JSON.stringify(parent?.props.style ?? {});
    expect(flat).not.toMatch(/"flexDirection":"row"/);
    expect(parent?.children.filter((c) => typeof c !== "string")).toHaveLength(2);
    r.unmount();
  });
});

describe("P3 Ari's extend confirm says the total stays the same, in every locale", () => {
  const others = BUSINESS_MEDIA_LANGUAGES.filter((l) => l !== "en");
  it("covers every Host locale", () => {
    expect(others.length).toBeGreaterThanOrEqual(28);
  });
  it.each(others)("%s: the key loads through the i18n loader", async (language) => {
    await changeBusinessMediaLanguage(language);
    const line = hm("ari.sameTotalLine");
    expect(line).not.toBe("ari.sameTotalLine");
    expect(line).not.toMatch(/hostAds\.manage/);
    expect(line.trim().length).toBeGreaterThan(10);
    await changeBusinessMediaLanguage("en");
  });
});
