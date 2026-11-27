// MINGLA-INVARIANT: I-4624-20 | issue #4624 | The Explorer cart's sale notices render exactly as the #3872 cart did (same text, buttons, order and styles; only a testID is added), and a code notice never falls back to sale wording, even when its ticket row or quote line is missing.
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4624 tester adversarial (retest): angles the implementor's render test does
 * not take.
 * - Sale notices are byte-identical to origin/main's TicketCartSheet block: the
 *   #3872 JSX is reproduced below verbatim (moved into a reference component)
 *   and both trees are compared as JSON, with only the new testID removed.
 * - Sale notices on two lines with the same sale stay independent (the key is
 *   `${discountId}:${lineRef}`, approved in spec 7206302208 item 1).
 * - A code notice whose ticket row is not in the cart, or whose quote line is
 *   missing, still uses code wording and offers no "Lower to" button.
 * - A sale notice with 0 remaining keeps the sold-out sentence and no Buy.
 * FAILS-ON-REVERT: render code notices with saleLimitedCopy (the #3872 cart) and
 * the missing-row test reads "at the sale price"; drop the per-line key and the
 * two-line sale test hides both notices.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import type {
  TicketQuote,
  TicketQuoteLine,
  TicketQuoteNotice,
} from "@mingla/offering-rendering/discountQuote";
import { saleLimitedCopy } from "@mingla/offering-rendering/saleLimitedCopy";
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

const STYLES = {
  notice: { backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 12 },
  text: { color: "#fde68a", fontSize: 13 },
  actions: { flexDirection: "row" as const, gap: 8 },
  button: { borderRadius: 10, minHeight: 38 },
  buttonText: { fontSize: 12, fontWeight: "700" as const },
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

type Quote = CartDiscountNoticesProps["quote"];
const quote = (lines: TicketQuoteLine[], notices: TicketQuoteNotice[], saleName: string | null): Quote => ({
  lines,
  notices,
  discounts: saleName === null
    ? []
    : ([{ discountId: "sale-1", kind: "sale_price", name: saleName, code: null, amountMinor: 0, units: 0 }] as TicketQuote["discounts"]),
});

interface Row {
  id: string;
  saleName?: string | null;
}

/**
 * origin/main's TicketCartSheet sale-notice block (#3872), verbatim except
 * that the closures it called are props here.
 */
function ReferenceSaleNotices(props: {
  quote: Quote;
  dismissedSaleNotices: string[];
  tickets: Row[];
  perDateActive: boolean;
}): React.ReactElement {
  const { quote: q, dismissedSaleNotices, tickets, perDateActive } = props;
  const styles = {
    saleNotice: STYLES.notice,
    saleNoticeText: STYLES.text,
    saleNoticeActions: STYLES.actions,
    saleNoticeButton: STYLES.button,
    saleNoticeButtonText: STYLES.buttonText,
  };
  const activeSaleNotices = (q?.notices ?? []).filter(
    (notice) => !dismissedSaleNotices.includes(notice.discountId),
  );
  return (
    <>
      {activeSaleNotices.map((notice) => {
        const quoteLine = q?.lines.find(
          (l) => l.ticketTypeId === notice.lineRef,
        );
        const ticket = tickets?.find((row) => row.id === notice.lineRef);
        const sale = q?.discounts.find(
          (discount) => discount.discountId === notice.discountId,
        );
        const name = sale?.name ?? ticket?.saleName ?? "sale";
        const currentQuantity = quoteLine?.quantity ?? 0;
        return (
          <View
            key={`${notice.discountId}:${notice.lineRef}`}
            style={styles.saleNotice}
          >
            <Text style={styles.saleNoticeText}>
              {saleLimitedCopy(name, notice.remaining)}
            </Text>
            <View style={styles.saleNoticeActions}>
              {notice.remaining > 0 &&
              ticket !== undefined &&
              !perDateActive ? (
                <Pressable
                  onPress={() => undefined}
                  accessibilityRole="button"
                  style={styles.saleNoticeButton}
                >
                  <Text style={styles.saleNoticeButtonText}>
                    {t("sale_limited.buy", {
                      count: notice.remaining,
                      sale: name,
                      defaultValue: `Buy ${notice.remaining} at ${name}`,
                    })}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => undefined}
                accessibilityRole="button"
                style={styles.saleNoticeButton}
              >
                <Text style={styles.saleNoticeButtonText}>
                  {t("sale_limited.keep", {
                    count: currentQuantity,
                    defaultValue: `Keep ${currentQuantity} at list`,
                  })}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </>
  );
}

function toJson(element: React.ReactElement): unknown {
  let tree: ReturnType<typeof TestRenderer.create> | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  if (tree === undefined) throw new Error("render failed");
  const json = tree.toJSON();
  const mounted = tree;
  TestRenderer.act(() => mounted.unmount());
  return json;
}

/**
 * The rendered tree as text, without the testID #4624 added (react-native-web
 * renders it as data-testid). Functions and symbols drop out of JSON.
 */
const serial = (node: unknown): string =>
  JSON.stringify(node, (key, value) => (key === "data-testid" || key === "testID" ? undefined : value));

function current(q: Quote, tickets: Row[], perDateActive: boolean, dismissedKeys: string[] = []): unknown {
  return toJson(
    <CartDiscountNotices
      quote={q}
      dismissedKeys={dismissedKeys}
      perDateActive={perDateActive}
      pickerQuantityByLineRef={Object.fromEntries(q.lines.map((l) => [l.ticketTypeId, perDateActive ? null : l.quantity]))}
      hasTicket={(ref) => tickets.some((row) => row.id === ref)}
      ticketSaleName={(ref) => tickets.find((row) => row.id === ref)?.saleName}
      onLower={() => undefined}
      onKeep={() => undefined}
      t={t}
      styles={STYLES}
    />,
  );
}

const sale = (lineRef: string, remaining: number, discountId = "sale-1"): TicketQuoteNotice => ({
  type: "sale_limited",
  discountId,
  lineRef,
  remaining,
});

describe("#4624 tester: Explorer cart notices", () => {
  const cases: Array<[string, Quote, Row[], boolean]> = [
    ["one sale notice", quote([line("ga", "General", 4)], [sale("ga", 2)], "Early bird"), [{ id: "ga" }], false],
    ["sold out (0 left)", quote([line("ga", "General", 4)], [sale("ga", 0)], "Early bird"), [{ id: "ga" }], false],
    ["name from the ticket row", quote([line("ga", "General", 3)], [sale("ga", 1)], null), [{ id: "ga", saleName: "Flash" }], false],
    ["no name anywhere", quote([line("ga", "General", 3)], [sale("ga", 1)], null), [{ id: "ga" }], false],
    ["ticket row missing", quote([line("ga", "General", 3)], [sale("ga", 1)], "Early bird"), [], false],
    ["picked by date", quote([line("ga", "General", 5)], [sale("ga", 2)], "Early bird"), [{ id: "ga" }], true],
    ["two lines", quote([line("ga", "General", 4), line("vip", "VIP", 3)], [sale("ga", 2), sale("vip", 1)], "Early bird"), [{ id: "ga" }, { id: "vip" }], false],
  ];

  test.each(cases)("sale notice is byte-identical to the #3872 cart: %s", (_label: string, q: Quote, tickets: Row[], perDate: boolean) => {
    const before = toJson(
      <ReferenceSaleNotices quote={q} dismissedSaleNotices={[]} tickets={tickets} perDateActive={perDate} />,
    );
    expect(serial(current(q, tickets, perDate))).toBe(serial(before));
  });

  test("Keep on one sale line leaves the same sale's notice on the other line", () => {
    const q = quote([line("ga", "General", 4), line("vip", "VIP", 3)], [sale("ga", 2), sale("vip", 1)], "Early bird");
    const json = JSON.stringify(current(q, [{ id: "ga" }, { id: "vip" }], false, ["sale-1:ga"]));
    expect(json).not.toContain("Only 2 left at the Early bird price.");
    expect(json).toContain("Only 1 left at the Early bird price.");
  });

  test("a code notice whose ticket row or quote line is missing never says sale", () => {
    const code: TicketQuoteNotice = { type: "sale_limited", discountId: "code-1", lineRef: "ga", remaining: 2, discountKind: "code" };
    const noRow = JSON.stringify(current(quote([line("ga", "General", 4)], [code], null), [], false));
    expect(noRow).toContain("Only 2 tickets left on this code. Lower the number to use it.");
    expect(noRow).not.toMatch(/sale price|Buy 2 at|at list|Lower to/);
    const noLine = JSON.stringify(current(quote([line("vip", "VIP", 1)], [code], null), [{ id: "ga" }], false));
    expect(noLine).toContain("Only 2 tickets left on this code.");
    expect(noLine).not.toMatch(/sale price|at list/);
  });

  test("a code notice with 0 left reads the rest-of-order sentence with no Lower button", () => {
    const code: TicketQuoteNotice = { type: "sale_limited", discountId: "code-1", lineRef: "vip", remaining: 0, discountKind: "code" };
    const json = JSON.stringify(
      current(quote([line("ga", "General", 3), line("vip", "VIP", 2)], [code], null), [{ id: "ga" }, { id: "vip" }], false),
    );
    expect(json).toContain("No tickets left on this code for the rest of your order.");
    expect(json).not.toContain("Lower to");
    expect(json).toContain("Keep 2 at full price");
  });
});
