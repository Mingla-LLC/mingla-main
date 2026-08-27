jest.mock("../../supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { rollupFunnel } from "../marketingOverviewService";

const timestamp = "2026-08-27T12:00:00.000Z";

describe("#2714 tester adversarial cohort truth", () => {
  it("keeps historical delivery and open evidence outside the tracked cohort", () => {
    const result = rollupFunnel(
      [{ status: "opened", delivered_at: timestamp, opened_at: timestamp }],
      0,
    );

    expect(result.delivered).toBe(0);
    expect(result.opened).toBe(0);
    expect(result.trackedDelivered).toBe(0);
    expect(result.hasDeliveryCoverage).toBe(false);
    expect(result.hasOpenCoverage).toBe(false);
  });

  it("does not count an open before eligible delivery establishes the denominator", () => {
    const result = rollupFunnel(
      [{
        status: "opened",
        delivery_tracking_eligible_at: timestamp,
        open_tracking_eligible_at: timestamp,
        delivered_at: null,
        opened_at: timestamp,
      }],
      0,
    );

    expect(result.delivered).toBe(0);
    expect(result.opened).toBe(0);
    expect(result.trackedDelivered).toBe(0);
    expect(result.hasDeliveryCoverage).toBe(true);
    expect(result.hasOpenCoverage).toBe(false);
  });

  it("withholds otherwise valid values when reconciliation health is stale", () => {
    const result = rollupFunnel(
      Array.from({ length: 1_205 }, (_, index) => ({
        id: `message-${String(index).padStart(4, "0")}`,
        status: "delivered" as const,
        delivery_tracking_eligible_at: timestamp,
        open_tracking_eligible_at: timestamp,
        delivered_at: timestamp,
        opened_at: index === 0 ? timestamp : null,
      })),
      7,
      { delivery_healthy: false, open_healthy: false },
    );

    expect(result.delivered).toBe(1_205);
    expect(result.trackedDelivered).toBe(1_205);
    expect(result.opened).toBe(1);
    expect(result.hasDeliveryCoverage).toBe(false);
    expect(result.hasOpenCoverage).toBe(false);
  });
});
