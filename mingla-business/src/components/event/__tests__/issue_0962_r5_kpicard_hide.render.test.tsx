/**
 * #962 [pre-bank currency de-GBP] Phase 2 — R5 TESTER adversarial RUNTIME render
 * proof (the angle the implementor explicitly deferred: "RN cannot render to a
 * host tree under the default node/ts-jest config — the tester's R5 owns the
 * runtime render").
 *
 * MOUNTS the REAL <EventDetailKpiCard> (the shared REVENUE/PAYOUT card fed by
 * BOTH the event dashboard N1 and the trip dashboard N2 via a nullable
 * `currency`) with react-test-renderer. A commit-time RangeError throws
 * synchronously from create(), so a clean mount IS the ORCH-1152 no-crash proof.
 *
 * Angles:
 *   - N1/N2 HIDE: currency={null} AND currency omitted → REVENUE + PAYOUT render
 *     "—", zero £/GBP. (Fails on a true revert of EventDetailKpiCard.tsx — the
 *     restored `currency = "GBP"` default renders "£0.00".)
 *   - honor-when-set: a REAL currency (USD/EUR/NGN) still renders its symbol.
 *   - crash-safety: an empty/whitespace currency mounts WITHOUT throwing and is
 *     still hidden ("—"), never a fabricated £.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { EventDetailKpiCard } from "../EventDetailKpiCard";

type KpiProps = {
  revenueGbp: number;
  payoutGbp: number | null;
  coveredGbp?: number | null;
  currency?: string | null;
};

function collectText(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, out);
    return;
  }
  if (typeof node === "object") {
    const children = (node as { children?: unknown }).children;
    if (children !== undefined) collectText(children, out);
  }
}

/** Mount the real card and return every text leaf, joined. Throws if render throws. */
function renderKpiText(props: KpiProps): string {
  let tr!: TestRenderer.ReactTestRenderer;
  act(() => {
    tr = TestRenderer.create(React.createElement(EventDetailKpiCard, props));
  });
  const out: string[] = [];
  collectText(tr.toJSON(), out);
  act(() => {
    tr.unmount();
  });
  return out.join(" | ");
}

describe("#962 R5 render — EventDetailKpiCard hides money when currency is null (N1/N2)", () => {
  test("currency={null}, zero revenue → REVENUE + PAYOUT both '—', no £/GBP", () => {
    let text = "";
    expect(() => {
      text = renderKpiText({ revenueGbp: 0, payoutGbp: 0, currency: null });
    }).not.toThrow();
    expect(text).toContain("REVENUE");
    expect(text).toContain("PAYOUT");
    expect(text).toContain("—");
    expect(text).not.toMatch(/£|GBP/);
    // No fabricated zero-money either.
    expect(text).not.toMatch(/[£$€₦]\s?0/);
  });

  test("currency OMITTED (undefined) → still hidden '—', NOT the old GBP default", () => {
    // This is the exact case the removed `currency = "GBP"` default used to
    // fabricate: an omitted currency now resolves null → "—".
    let text = "";
    expect(() => {
      text = renderKpiText({ revenueGbp: 0, payoutGbp: 0 });
    }).not.toThrow();
    expect(text).toContain("—");
    expect(text).not.toMatch(/£|GBP/);
  });
});

describe("#962 R5 render — honor-when-set (the hide logic did not nuke real currency)", () => {
  test.each([
    ["USD", "$"],
    ["EUR", "€"],
    ["NGN", "₦"],
  ])("currency=%s with data → the %s symbol renders", (code, symbol) => {
    let text = "";
    expect(() => {
      text = renderKpiText({ revenueGbp: 100, payoutGbp: 80, currency: code });
    }).not.toThrow();
    expect(text).toContain(symbol);
    expect(text).not.toContain("—"); // both REVENUE and PAYOUT have data
    expect(text).not.toMatch(/£|GBP/);
  });
});

describe("#962 R5 render — crash-safety on empty/whitespace currency (ORCH-1152 class)", () => {
  test.each(["", "   "])(
    "currency=%p mounts WITHOUT throwing and stays hidden ('—'), never £",
    (bad) => {
      let text = "";
      expect(() => {
        text = renderKpiText({ revenueGbp: 0, payoutGbp: 0, currency: bad });
      }).not.toThrow();
      expect(text).toContain("—");
      expect(text).not.toMatch(/£|GBP/);
    },
  );
});
