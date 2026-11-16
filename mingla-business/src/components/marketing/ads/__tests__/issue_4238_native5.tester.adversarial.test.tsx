/**
 * #4238 tester final native 4 (after rework 6) — adversarial, different angle
 * from issue_4238_rework6.implementor.test.ts. Behaviour test: the real
 * Withdraw and Ari confirm sheets are rendered, and every Host language is
 * loaded through the app's own i18n loader (changeBusinessMediaLanguage).
 *
 *  - every locale's withdraw label still carries {{amount}} exactly once, and
 *    the rendered full-width button shows the back-pay amount;
 *  - the same-total line is rendered with NO variables, so a locale that put a
 *    {{placeholder}} in it would show raw braces; it must be non-empty,
 *    placeholder-free everywhere;
 *  - the line shows ONLY on an extend-the-end-date suggestion, never on a
 *    raise or lower suggestion (where the total does change).
 *
 * FAILS-ON-REVERT of rework 6: dropping the extend_end-only line from the
 * sheet, widening it to every suggestion, or dropping the amount from the
 * withdraw label reds the rendered checks.
 */
import React from "react";

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
jest.mock("../../../../utils/hapticFeedback", () => ({ HapticFeedback: new Proxy({}, { get: () => () => undefined }) }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../services/adCreditService", () => ({
  quoteAdCreditWithdraw: () => Promise.resolve({ credit_cents: 10_000, refund_cents: 8_500, fee_returned_cents: 1_500 }),
  applyAdCreditWithdraw: () => Promise.resolve(),
  getAdCreditReceipt: () => Promise.resolve(null),
  getAdCreditStatement: () => Promise.resolve(null),
}));

// eslint-disable-next-line import/first
import { HostAdSuggestionConfirmSheet, HostAdWithdrawSheet } from "../HostAdManageSheets";
// eslint-disable-next-line import/first
import { BUSINESS_MEDIA_LANGUAGES, changeBusinessMediaLanguage } from "../../../../i18n";

const otherLanguages = BUSINESS_MEDIA_LANGUAGES.filter((l) => l !== "en");
const money = (cents: number): string => `M${cents}`;
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const byId = (r: Renderer, id: string): RenderNode[] => r.root.findAll((n) => n.props.testID === id && typeof n.type === "string");

async function renderWithdraw(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = create(
      <HostAdWithdrawSheet visible brandId="b1" currency="USD" money={money} walletCredit={10_000} heldPay={9_000} onClose={() => undefined} onDone={() => undefined} />,
    );
  });
  await flush();
  return r;
}

function renderConfirm(kind: "extend_end" | "raise_budget" | "lower_budget"): Renderer {
  let r!: Renderer;
  act(() => {
    r = create(
      <HostAdSuggestionConfirmSheet
        visible
        suggestion={{
          suggestion_id: "s1",
          kind,
          apply_action: "change_live",
          ends_at: "2026-12-01T00:00:00Z",
          money: { now_total_pay_cents: 5000, new_total_pay_cents: kind === "extend_end" ? 5000 : 7000, fee_pay_cents: 100 } as never,
          days_live: 3,
          basis: { results: 1, cost_per_result_cents: null, guidance_mid_cents: null, guidance_high_cents: null, stock_left: null },
        }}
        money={money}
        dateText={(iso) => iso}
        busy={false}
        error={null}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );
  });
  return r;
}

describe("withdraw label shows the amount in every language", () => {
  it("covers every Host locale", () => {
    expect(otherLanguages.length).toBeGreaterThanOrEqual(28);
  });

  it.each(otherLanguages)("%s: the rendered full-width button carries the back-pay amount once", async (language) => {
    await changeBusinessMediaLanguage(language);
    const r = await renderWithdraw();
    const go = byId(r, "host-ad-withdraw-go")[0];
    expect(go).toBeDefined();
    const label = String(go.props.label);
    expect(label.split("M8500").length - 1).toBe(1);
    expect(label).not.toMatch(/\{\{|\}\}/);
    expect(go.props.fullWidth).toBe(true);
    expect(byId(r, "host-ad-withdraw-keep")[0].props.fullWidth).toBe(true);
    // really translated, not the English fallback
    expect(label).not.toBe("Withdraw M8500");
    r.unmount();
    await changeBusinessMediaLanguage("en");
  });

  it("English shows 'Withdraw <amount>'", async () => {
    await changeBusinessMediaLanguage("en");
    const r = await renderWithdraw();
    expect(String(byId(r, "host-ad-withdraw-go")[0].props.label)).toBe("Withdraw M8500");
    r.unmount();
  });
});

describe("same-total line is plain text everywhere", () => {
  it.each(otherLanguages)("%s: the extend confirm shows a real, placeholder-free line", async (language) => {
    await changeBusinessMediaLanguage(language);
    const r = renderConfirm("extend_end");
    const line = byId(r, "host-ad-ari-same-total")[0];
    expect(line).toBeDefined();
    const text = line.children.filter((c): c is string => typeof c === "string").join("");
    expect(text.trim().length).toBeGreaterThan(10);
    expect(text).not.toMatch(/\{\{|\}\}/);
    r.unmount();
    await changeBusinessMediaLanguage("en");
  });
});

describe("same-total line only on an extend suggestion", () => {
  it("shows on extend_end, never on raise or lower", () => {
    const extend = renderConfirm("extend_end");
    const raise = renderConfirm("raise_budget");
    const lower = renderConfirm("lower_budget");
    expect(byId(extend, "host-ad-ari-same-total")).toHaveLength(1);
    expect(byId(raise, "host-ad-ari-same-total")).toHaveLength(0);
    expect(byId(lower, "host-ad-ari-same-total")).toHaveLength(0);
  });
});
