/**
 * issue #3343 — a ticket card on the Tickets step read "— · max 6 / buyer".
 *
 * Found filming Scene 04 (2026-09-14). A new ticket inherits the event's
 * currency and carries none of its own, so the sub-line's price slot fell back
 * to the "no price" dash and was joined to the real details with " · " — while
 * the Price box on the same card already showed the right amount.
 *
 * The card sub-line now resolves the price with the event's currency, as the
 * Price box does, and leaves the slot out when there is still nothing to show.
 * The pre-bank rule (#962) holds: no currency is ever made up.
 *
 * Fails on revert: TicketTierCard back on formatTicketSubline renders
 * "— · max 6 / buyer" and a lone "—".
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { TicketStub } from "../../../store/draftEventStore";
import { formatTicketCardSubline } from "../../../utils/ticketDisplay";

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("MockGlassCard", null, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Pill", () => ({
  Pill: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("MockPill", null, children),
}));

// eslint-disable-next-line import/first
import { TicketTierCard } from "../TicketTierCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = {
  root: {
    findAll: (
      predicate: (node: { props: Record<string, unknown> }) => boolean,
    ) => { props: Record<string, unknown>; children: unknown[] }[];
  };
  toJSON: () => unknown;
  unmount: () => void;
};
// The repo intentionally carries no react-test-renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const draftTicket = (overrides: Partial<TicketStub> = {}): TicketStub =>
  ({
    id: "ticket-3343",
    name: "General Admission",
    priceGbp: 25000,
    capacity: 100,
    isFree: false,
    isUnlimited: false,
    visibility: "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    waitlistEnabled: false,
    minPurchaseQty: 1,
    maxPurchaseQty: 6,
    allowTransfers: true,
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    availableAt: "both",
    // A draft ticket inherits the event currency: no `currency` of its own.
    ...overrides,
  }) as TicketStub;

/** Every text string the card renders, in order. */
const texts = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node !== null && typeof node === "object") {
    texts((node as { children?: unknown }).children ?? null, out);
  }
  return out;
};

const mountCard = async (
  ticket: TicketStub,
  eventCurrency?: string,
): Promise<{ tree: Tree; shown: string[] }> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierCard
        ticket={ticket}
        index={0}
        isFirst
        isLast
        onEdit={() => undefined}
        onDuplicate={() => undefined}
        onDelete={() => undefined}
        onMoveUp={() => undefined}
        onMoveDown={() => undefined}
        eventCurrency={eventCurrency}
      />,
    );
  });
  return { tree, shown: texts(tree.toJSON()) };
};

const startsWithDashSeparator = (value: string): boolean => /^—\s*·/.test(value);

describe("#3343 ticket card sub-line", () => {
  test("a priced draft ticket uses the event currency: ₦25,000 · max 6 / buyer", async () => {
    const { tree, shown } = await mountCard(draftTicket(), "NGN");
    expect(shown).toContain("₦25,000 · max 6 / buyer");
    expect(shown.filter(startsWithDashSeparator)).toEqual([]);
    // Positive witness for the empty case below: the sub-line is findable.
    expect(
      tree.root.findAll((node) => node.props.testID === "ticket-tier-card-subline").length,
    ).toBeGreaterThan(0);
    await TestRenderer.act(() => tree.unmount());
  });

  test("no currency anywhere: the details stand alone, with no leading dash", async () => {
    const { tree, shown } = await mountCard(draftTicket());
    expect(shown).toContain("max 6 / buyer");
    expect(shown.filter(startsWithDashSeparator)).toEqual([]);
    // #962 — the Price box still refuses to invent a currency.
    expect(shown).toContain("Currency not set");
    expect(shown.join(" ")).not.toMatch(/£|GBP/);
    await TestRenderer.act(() => tree.unmount());
  });

  test("nothing to show: the card renders no sub-line at all, not a lone dash", async () => {
    const { tree, shown } = await mountCard(
      draftTicket({ priceGbp: null, maxPurchaseQty: null }),
    );
    const sublines = tree.root.findAll(
      (node) => node.props.testID === "ticket-tier-card-subline",
    );
    expect(sublines).toEqual([]);
    // Nothing sits between the ticket name and the Price box label.
    expect(shown.slice(0, 2)).toEqual(["General Admission", "Price"]);
    await TestRenderer.act(() => tree.unmount());
  });

  test("the helper: price first when known, omitted when not, null when empty", () => {
    expect(formatTicketCardSubline(draftTicket(), "NGN")).toBe("₦25,000 · max 6 / buyer");
    expect(formatTicketCardSubline(draftTicket({ currency: "USD", priceGbp: 35 }), "NGN")).toBe(
      "$35 · max 6 / buyer",
    );
    expect(formatTicketCardSubline(draftTicket({ currency: "  " }), "NGN")).toBe(
      "₦25,000 · max 6 / buyer",
    );
    expect(formatTicketCardSubline(draftTicket(), null)).toBe("max 6 / buyer");
    expect(
      formatTicketCardSubline(draftTicket({ isFree: true, priceGbp: null }), null),
    ).toBe("Free · max 6 / buyer");
    expect(
      formatTicketCardSubline(
        draftTicket({ priceGbp: null, maxPurchaseQty: null, approvalRequired: true }),
        "NGN",
      ),
    ).toBe("approval");
    expect(
      formatTicketCardSubline(draftTicket({ priceGbp: null, maxPurchaseQty: null }), "NGN"),
    ).toBeNull();
  });
});
