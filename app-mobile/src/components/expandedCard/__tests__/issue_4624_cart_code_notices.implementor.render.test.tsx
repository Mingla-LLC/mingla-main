// MINGLA-INVARIANT: I-4624-16 | issue #4624 | The Explorer cart never shows sale wording for a ticket-capped code notice; it uses the code copy with "Lower to N" / "Keep N at full price", and Keep hides only that line's notice.
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4624 item 1 — the Explorer cart's discount notices, rendered.
 * Runs under app-mobile/jest.issue2774.render.cjs (react-native-web).
 *
 * FAILS-ON-REVERT: render every notice with saleLimitedCopy again (the #3872
 * cart) and the code notice reads "Only 3 left at the sale price." with a
 * "Buy 3 at sale" button, so the code-copy assertions fail.
 */
import React from "react";
import type {
  TicketQuote,
  TicketQuoteLine,
  TicketQuoteNotice,
} from "@mingla/offering-rendering/discountQuote";
import {
  CartDiscountNotices,
  type CartDiscountNoticesProps,
} from "../CartDiscountNotices";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const discounts = require("../../../i18n/locales/en/discounts.json") as Record<
  string,
  Record<string, string>
>;
const t = (key: string, options: Record<string, string | number>): string => {
  const [group, leaf] = key.split(".");
  const template = discounts[group]?.[leaf] ?? String(options.defaultValue ?? key);
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) =>
    name in options ? String(options[name]) : `{{${name}}}`,
  );
};

const line = (ticketTypeId: string, ticketName: string, quantity: number): TicketQuoteLine => ({
  ticketTypeId,
  ticketName,
  quantity,
  listUnitCents: 2500,
  netUnitCents: 2500,
  lineListCents: 2500 * quantity,
  lineNetCents: 2500 * quantity,
  discountCents: 0,
  discounts: [],
});

const codeNotice = (lineRef: string, remaining: number): TicketQuoteNotice => ({
  type: "sale_limited",
  discountId: "code-1",
  lineRef,
  remaining,
  discountKind: "code",
});

type Quote = CartDiscountNoticesProps["quote"];
const quote = (
  lines: TicketQuoteLine[],
  notices: TicketQuoteNotice[],
  saleName: string | null = null,
): Quote => ({
  lines,
  notices,
  discounts: saleName === null
    ? []
    : ([{ discountId: "sale-1", kind: "sale_price", name: saleName, code: null, amountMinor: 0, units: 0 }] as TicketQuote["discounts"]),
});

interface Harness {
  json: string;
  lower: jest.Mock;
  keep: jest.Mock;
  tree: { root: { findAll: (p: (n: { props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> } };
  unmount: () => void;
}

function render(props: Partial<CartDiscountNoticesProps> & { quote: Quote }): Harness {
  const lower = jest.fn();
  const keep = jest.fn();
  const styles = { notice: {}, text: {}, actions: {}, button: {}, buttonText: {} };
  let tree: ReturnType<typeof TestRenderer.create> | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <CartDiscountNotices
        dismissedKeys={[]}
        perDateActive={false}
        pickerQuantityByLineRef={{}}
        hasTicket={() => true}
        ticketSaleName={() => null}
        onLower={lower}
        onKeep={keep}
        t={t}
        styles={styles}
        {...props}
      />,
    );
  });
  if (tree === undefined) throw new Error("render failed");
  const mounted = tree;
  return {
    json: JSON.stringify(mounted.toJSON()),
    lower,
    keep,
    tree: mounted as unknown as Harness["tree"],
    unmount: () => TestRenderer.act(() => mounted.unmount()),
  };
}

const press = (h: Harness, testID: string): void => {
  const node = h.tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${testID}`);
  TestRenderer.act(() => (node.props.onPress as () => void)());
};

describe("#4624 Explorer cart code notices", () => {
  test("a code notice uses the code copy with Lower to N and Keep N at full price", () => {
    const h = render({
      quote: quote([line("ga", "General admission", 4)], [codeNotice("ga", 3)]),
      pickerQuantityByLineRef: { ga: 4 },
    });
    expect(h.json).toContain("Only 3 tickets left on this code. Lower the number to use it.");
    expect(h.json).toContain("Lower to 3");
    expect(h.json).toContain("Keep 4 at full price");
    expect(h.json).not.toMatch(/sale price|Buy 3 at|at list/);
    press(h, "cart-code-notice-lower-ga");
    expect(h.lower).toHaveBeenCalledWith("ga", 3, "code");
    press(h, "cart-code-notice-keep-ga");
    expect(h.keep).toHaveBeenCalledWith("code-1:ga", "code");
    h.unmount();
  });

  test("a code notice and a sale notice together: sale wording unchanged, the code line named", () => {
    const h = render({
      quote: quote(
        [line("ga", "General admission", 4), line("vip", "VIP", 3)],
        [
          codeNotice("ga", 3),
          { type: "sale_limited", discountId: "sale-1", lineRef: "vip", remaining: 2 },
        ],
        "Early bird",
      ),
      pickerQuantityByLineRef: { ga: 4, vip: 3 },
    });
    expect(h.json).toContain("Only 3 tickets left on this code. Lower General admission to 3 to use it.");
    expect(h.json).toContain("Only 2 left at the Early bird price.");
    expect(h.json).toContain("Buy 2 at Early bird");
    expect(h.json).toContain("Keep 3 at list");
    expect(h.json).toContain("Keep 4 at full price");
    h.unmount();
  });

  test("Keep on one line leaves the same code's notice on the other line", () => {
    const q = quote(
      [line("ga", "General admission", 3), line("vip", "VIP", 3)],
      [codeNotice("ga", 2), codeNotice("vip", 2)],
    );
    const h = render({ quote: q, dismissedKeys: ["code-1:vip"] });
    expect(h.json).toContain("Lower General admission to 2 to use it.");
    expect(h.json).not.toContain("Lower VIP to 2");
    h.unmount();
  });

  test("no Lower button when no whole number fits or the line is picked date by date", () => {
    // Per-day: 1 person x 3 days = 3 tickets, 2 left -> lowerTo 0.
    const perDay = render({
      quote: quote([line("fest", "Festival day", 3)], [codeNotice("fest", 2)]),
      pickerQuantityByLineRef: { fest: 1 },
    });
    expect(perDay.json).toContain(
      "Only 2 tickets left on this code. That's not enough for every day you picked.",
    );
    expect(perDay.json).not.toContain("Lower to");
    expect(perDay.json).toContain("Keep 1 at full price");
    perDay.unmount();
    const byDate = render({
      quote: quote([line("ga", "General admission", 5)], [codeNotice("ga", 3)]),
      perDateActive: true,
      pickerQuantityByLineRef: { ga: null },
    });
    expect(byDate.json).not.toContain("Lower to");
    expect(byDate.json).toContain("Only 3 tickets left on this code. Lower the number to use it.");
    byDate.unmount();
  });
});
