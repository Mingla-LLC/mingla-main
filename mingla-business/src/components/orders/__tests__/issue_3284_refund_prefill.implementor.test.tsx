/* eslint-disable import/first */
// issue #3284 [refund terms on events and experiences] — implementor happy-path
// regression for the organiser refund sheet (spec part 2 §C6; design §4.9).
//
// WHAT THIS FILE PINS
//   RP-*  the pure suggestion: the server's tier rule counted from the order's
//         earliest day, FLOOR(paid × pct / 100) capped at what is still
//         refundable, the three §4.9 captions (full / partial / none) with the
//         offering noun, and NO suggestion for no terms, unknown terms, a free
//         order or an unknown start.
//   RS-*  the REAL RefundSheet: the caption renders when the offering has terms,
//         nothing renders without them, and the lines + amount sent to
//         refund-order are exactly what they were before (display only).
//   RR-*  the order detail route hands the sheet the event's terms and start.
//
// FAILS-ON-REVERT: restore RefundSheet.tsx or app/event/[id]/orders/[oid]/index.tsx
// from origin/main (or remove utils/refundPolicyPrefill.ts) and this goes red.

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const mockMutateAsync = jest.fn(async (_input: unknown) => ({ amountCents: 5000 }));
jest.mock("../../../hooks/useEventOrders", () => ({
  useRefundOrder: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SheetProbe", props, props.children),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");
  return {
    ScrollView: R.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      R.createElement("ScrollView", { ...props, ref }, props.children),
    ),
  };
});

import {
  EVENT_STANDARD_POLICY,
  NO_REFUNDS_POLICY,
} from "../../../services/refundPolicyModel"; // [TEST-MOD-APPROVED #3284] path only
import type { OrderRecord } from "../../../store/orderStore";
import {
  computeRefundPolicySuggestion,
  resolveOrderRefundStartAt,
} from "../../../utils/refundPolicyPrefill";
import { RefundSheet, type RefundSheetRefundTerms } from "../RefundSheet";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const daysFromNow = (days: number, hours = 1): string =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

const suggest = (
  overrides: Partial<Parameters<typeof computeRefundPolicySuggestion>[0]> = {},
) =>
  computeRefundPolicySuggestion({
    policy: EVENT_STANDARD_POLICY, // 14+ → 100 · 7–13 → 50 · under 7 → 0
    offeringType: "event",
    startsAt: daysFromNow(10),
    paidCents: 5000,
    remainingCents: 5000,
    currency: "GBP",
    now: NOW,
    ...overrides,
  });

describe("RP — what the published terms give an order today", () => {
  test("RP-1 a partial window suggests FLOOR(paid × pct / 100) with its pct and window", () => {
    expect(suggest()).toEqual({
      pct: 50,
      suggestedCents: 2500,
      caption: "As of today, your refund policy suggests £25.00 (50% · 7–13 days before).",
    });
    expect(suggest({ paidCents: 4999, remainingCents: 4999 })?.suggestedCents).toBe(2499);
  });

  test("RP-2 the first window gives the full amount, worded with the offering noun", () => {
    expect(suggest({ startsAt: daysFromNow(20) })?.caption).toBe(
      "As of today, your refund policy gives the full £50.00 (14+ days before the event).",
    );
    expect(
      suggest({ startsAt: daysFromNow(20), offeringType: "experience" })?.caption,
    ).toBe("As of today, your refund policy gives the full £50.00 (14+ days before the experience).");
  });

  test("RP-3 0% gives no pre-fill amount and the no-refund caption", () => {
    expect(suggest({ startsAt: daysFromNow(3) })).toEqual({
      pct: 0,
      suggestedCents: 0,
      caption:
        "As of today, your refund policy gives no refund this close to the event. You can still refund any amount.",
    });
    expect(suggest({ policy: NO_REFUNDS_POLICY, offeringType: "experience" })?.caption).toBe(
      "As of today, your refund policy gives no refund this close to the experience. You can still refund any amount.",
    );
  });

  test("RP-4 never above what is still refundable", () => {
    expect(suggest({ startsAt: daysFromNow(20), remainingCents: 1200 })?.suggestedCents).toBe(1200);
  });

  test("RP-5 no terms, unknown terms, a free order or an unknown start → no suggestion", () => {
    expect(suggest({ policy: null })).toBeNull();
    expect(suggest({ policy: undefined })).toBeNull();
    expect(suggest({ paidCents: 0, remainingCents: 0 })).toBeNull();
    expect(suggest({ startsAt: null })).toBeNull();
    expect(suggest({ currency: null })).toBeNull();
  });

  test("RP-6 the window counts from the order's EARLIEST own day, else the first occurrence", () => {
    const occurrences = [
      { id: "day-1", startAt: "2026-10-01T18:00:00.000Z" },
      { id: "day-2", startAt: "2026-10-02T18:00:00.000Z" },
      { id: "day-3", startAt: "2026-10-03T18:00:00.000Z" },
    ];
    expect(
      resolveOrderRefundStartAt({
        orderDayIds: ["day-3", "day-2"],
        occurrences,
        fallbackStartAt: null,
      }),
    ).toBe("2026-10-02T18:00:00.000Z");
    expect(
      resolveOrderRefundStartAt({ orderDayIds: [], occurrences, fallbackStartAt: null }),
    ).toBe("2026-10-01T18:00:00.000Z");
    expect(
      resolveOrderRefundStartAt({
        orderDayIds: [],
        occurrences: [],
        fallbackStartAt: "2026-10-05T18:00:00.000Z",
      }),
    ).toBe("2026-10-05T18:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------

const collectText = (node: unknown, out: string[] = []): string[] => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  collectText((node as { children?: unknown }).children, out);
  return out;
};

const order = (): OrderRecord => ({
  id: "order-3284",
  eventId: "event-3284",
  brandId: "brand-3284",
  buyer: { name: "Ada", email: "ada@example.com", phone: "", marketingOptIn: false },
  lines: [
    {
      orderLineItemId: "line-1",
      ticketTypeId: "ticket-ga",
      ticketNameAtPurchase: "General admission",
      unitPriceGbpAtPurchase: 25,
      isFreeAtPurchase: false,
      quantity: 2,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
    },
  ],
  totalGbpAtPurchase: 50,
  totalCents: 5000,
  refundedAmountCents: 0,
  currency: "GBP",
  paymentMethod: "card",
  paidAt: "2026-09-01T12:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-09-01T12:00:00.000Z",
});

const mountSheet = async (refundTerms?: RefundSheetRefundTerms): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <RefundSheet
        visible
        mode="full"
        order={order()}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        refundTerms={refundTerms}
      />,
    );
  });
  return tree;
};

const captionNodes = (tree: Renderer): TestInstance[] =>
  tree.root.findAll(
    (node) => node.type === "Text" && node.props.testID === "refund-sheet-policy-caption",
  );

describe("RS — the organiser refund sheet", () => {
  beforeEach(() => {
    mockMutateAsync.mockClear();
  });

  test("RS-1 an offering with terms shows today's caption under the summary", async () => {
    const startsAt = new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString();
    const tree = await mountSheet({ policy: EVENT_STANDARD_POLICY, offeringType: "event", startsAt });
    const caption = captionNodes(tree);
    expect(caption).toHaveLength(1);
    expect(collectText(caption[0].props.children).join("")).toBe(
      "As of today, your refund policy suggests £25.00 (50% · 7–13 days before).",
    );
    await act(async () => {
      tree.unmount();
    });
  });

  test("RS-2 no terms (or no terms passed) renders no caption", async () => {
    const none = await mountSheet({ policy: null, offeringType: "event", startsAt: "2030-01-01T00:00:00.000Z" });
    expect(captionNodes(none)).toHaveLength(0);
    const omitted = await mountSheet();
    expect(captionNodes(omitted)).toHaveLength(0);
  });

  test("RS-3 display only: refund-order still receives the full lines and amount the organiser confirms", async () => {
    const startsAt = new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString();
    const tree = await mountSheet({ policy: EVENT_STANDARD_POLICY, offeringType: "event", startsAt });
    const reason = tree.root.findAll(
      (node) => node.type === "TextInput" && node.props.accessibilityLabel === "Refund reason",
    )[0];
    await act(async () => {
      (reason.props.onChangeText as (v: string) => void)("Buyer can't make it any more");
    });
    const send = tree.root.findAll(
      (node) => node.type === "ButtonProbe" && node.props.label === "Send refund",
    )[0];
    await act(async () => {
      await (send.props.onPress as () => Promise<void>)();
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    const input = mockMutateAsync.mock.calls[0][0] as { lines: unknown };
    expect(input.lines).toEqual([
      { orderLineItemId: "line-1", quantity: 2, amountCents: 5000 },
    ]);
  });
});

describe("RR — the order detail route wires the sheet", () => {
  test("RR-1 the route passes the event's terms, type and the order's refund start", () => {
    const route = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app/event/[id]/orders/[oid]/index.tsx"),
      "utf8",
    );
    expect(route).toContain("refundTerms={refundTerms}");
    expect(route).toContain("policy: event.refundPolicy,");
    expect(route).toContain("resolveOrderRefundStartAt({");
    expect(route).toMatch(/eventType !== "event" && eventType !== "experience"/);
  });
});
