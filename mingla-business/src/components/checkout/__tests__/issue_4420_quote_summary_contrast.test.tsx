/**
 * #4420 journey — the checkout order summary showed "$35.00 →" and nothing
 * else: the discounted amount, the fees line and the whole total row were
 * invisible on the dark checkout card (text painted with a SURFACE token).
 * The same summary also mounts inside the light "Your total changed" review
 * panel, which takes `onPaper` and switches to the paper inks.
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-
 * SOURCE-PIN); now renders the real TicketQuoteSummary and TicketCheckoutReviewPanel
 * and reads the flattened colour of every text node.
 *
 * FAILS ON REVERT: an amount, the total label or the total value paints with a
 * surface token again, or the review panel stops passing `onPaper`.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { StyleSheet } from "react-native";

import { color } from "../../../constants/designSystem";

jest.mock("../../../analytics/discountAnalytics", () => ({ captureDiscountEvent: () => undefined }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, any>; children: unknown[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { TicketQuoteSummary, TicketCheckoutReviewPanel } = require("../TicketQuoteSummary") as typeof import("../TicketQuoteSummary");

const QUOTE = {
  currency: "USD",
  lines: [{ ticketTypeId: "t1", ticketName: "GA", quantity: 1, lineListCents: 4000, lineNetCents: 3500 }],
  extras: [],
  discounts: [{ discountId: "d1", name: "Early bird", amountMinor: 500 }],
  netSubtotalCents: 3500,
  dueTodayNetCents: 3500,
  buyerTotalCents: 3900,
  buyerFeeCents: 300,
  taxCents: 100,
} as unknown as import("@mingla/offering-rendering/discountQuote").TicketQuote;

function mount(element: React.ReactElement): Tree {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Tree;
}

/** text node content -> its flattened colour */
function textColours(tree: Tree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of tree.root.findAll((x) => typeof x.type === "string" && x.type === "Text")) {
    const text = (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children ?? "")).trim();
    out[text] = (StyleSheet.flatten(n.props.style) as { color?: unknown } | undefined)?.color;
  }
  return out;
}

const SURFACES = [color.card, color.card2, color.card3, color.canvas];

describe("#4420 journey — quote summary text is readable on the checkout card", () => {
  const colours = textColours(mount(<TicketQuoteSummary quote={QUOTE} />));

  test("amounts, the fees line and the total use the light text token", () => {
    expect(colours["$35.00"]).toBe(color.text1);
    expect(colours["$4.00"]).toBe(color.text1); // fees & tax
    expect(colours["Total"]).toBe(color.text1);
    expect(colours["$39.00"]).toBe(color.text1);
  });

  test("no text node paints with a surface token", () => {
    const entries = Object.entries(colours);
    expect(entries.length).toBeGreaterThan(5);
    for (const [, c] of entries) expect(SURFACES).not.toContain(c);
  });

  test("the light review panel renders the summary with the paper inks", () => {
    const review = {
      quote: QUOTE,
      previousTotalCents: 3000,
      detail: "price_changed",
    } as unknown as import("@mingla/offering-rendering/discountQuote").TicketCheckoutReview;
    const paper = textColours(
      mount(<TicketCheckoutReviewPanel review={review} onAccept={() => undefined} onBack={() => undefined} />),
    );
    expect(paper["Total"]).toBe(color.ink);
    expect(paper["$39.00"]).toBe(color.ink);
    expect(paper["$35.00"]).toBe(color.ink);
    for (const c of Object.values(paper)) expect(SURFACES).not.toContain(c);
  });
});
