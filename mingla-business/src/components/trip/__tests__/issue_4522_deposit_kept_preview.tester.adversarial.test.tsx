/**
 * issue #4522 rework (tester F7) — a traveler cancelling a trip whose host set
 * "Deposit is non-refundable" is told the deposit is kept, and the kept
 * deposit is never read as a payment row.
 *
 * The cancel edge sends `depositKeptCents` and payment entries only (it reads
 * both database shapes: cancel-trip-booking/refundEntries.ts and its test);
 * the service passes the number through and the preview body shows the
 * spec's line.
 *
 * Fails on revert: the service drops the kept amount and the body never says
 * the deposit is non-refundable.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<(name: string, options: unknown) => Promise<{ data: unknown; error: null }>>();
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: (name: string, options: unknown) => invoke(name, options) } },
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null }),
  { virtual: true },
);
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

// eslint-disable-next-line import/first
import { previewBuyerCancel } from "../../../services/cancelTripBookingService";
// eslint-disable-next-line import/first
import { RefundPreviewBody } from "../RefundPreviewBody";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const visibleStrings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => visibleStrings(child, out));
  else if (node !== null && typeof node === "object") {
    const host = node as { children?: unknown };
    visibleStrings(host.children ?? null, out);
  }
  return out;
};

const render = async (element: React.ReactElement): Promise<string> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  const shown = visibleStrings(tree.toJSON()).join(" ");
  await TestRenderer.act(() => tree.unmount());
  return shown;
};

const base = {
  mode: "preview",
  orderId: "order-4522",
  eventId: "trip-4522",
  quotedAt: "2026-11-22T12:00:00Z",
  tripStart: "2027-03-12T09:00:00Z",
  daysRemaining: 109,
  tierPct: 100,
  tierKind: "none",
  paidTotalCents: 101_400_000,
  refundTotalCents: 71_400_000,
  currency: "NGN",
  installmentsToCancel: 3,
};
const flexRow = {
  installment_id: "11111111-1111-4111-8111-111111111111",
  ordinal: 4,
  source_pi: "ps_flex",
  paid_cents: 71_400_000,
  refund_cents: 71_400_000,
  currency: "NGN",
};
const depositRow = {
  installment_id: null,
  ordinal: 0,
  source_pi: "pi_deposit",
  paid_cents: 30_000_000,
  refund_cents: 0,
  currency: "NGN",
  note: "deposit",
};

describe("#4522 F7 — the kept deposit", () => {
  test("new server shape: own key, two payment rows, and the line is shown", async () => {
    invoke.mockResolvedValueOnce({
      data: { ...base, perPaymentRefund: [flexRow, depositRow], depositKeptCents: 30_000_000 },
      error: null,
    });
    const preview = await previewBuyerCancel("order-4522", "token");
    expect(preview.perPaymentRefund).toHaveLength(2);
    expect(preview.depositKeptCents).toBe(30_000_000);
    const shown = await render(<RefundPreviewBody preview={preview} mode="buyer" />);
    expect(shown).toContain("Deposit is non-refundable");
    expect(shown).toMatch(/Deposit is non-refundable ₦300,000\.00\s+kept/);
  });

  test("nothing kept: no line, no key", async () => {
    invoke.mockResolvedValueOnce({
      data: { ...base, perPaymentRefund: [flexRow, depositRow] },
      error: null,
    });
    const preview = await previewBuyerCancel("order-4522", "token");
    expect(preview.depositKeptCents).toBeUndefined();
    const shown = await render(<RefundPreviewBody preview={preview} mode="buyer" />);
    expect(shown).not.toContain("Deposit is non-refundable");
  });
});
