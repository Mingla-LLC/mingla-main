type QueryResult = { data: unknown; error: unknown };

interface QueryCall {
  table: string;
  selected: string;
  filters: Array<[string, ...unknown[]]>;
  orders: Array<[string, unknown]>;
  range?: [number, number];
  limit?: number;
  terminal: "range" | "limit" | "maybeSingle";
  resultCount: number;
}

interface MockRuntime {
  calls: QueryCall[];
  rpcCalls: string[];
  resolve: (call: Omit<QueryCall, "resultCount">) => QueryResult;
  health: QueryResult;
}

let mockRuntime: MockRuntime;

class MockQuery {
  private selected = "";
  private readonly filters: Array<[string, ...unknown[]]> = [];
  private readonly orders: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select(columns: string): this {
    this.selected = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push(["eq", column, value]);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push(["gte", column, value]);
    return this;
  }

  in(column: string, value: unknown): this {
    this.filters.push(["in", column, value]);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push(["not", column, operator, value]);
    return this;
  }

  order(column: string, options: unknown): this {
    this.orders.push([column, options]);
    return this;
  }

  range(from: number, to: number): Promise<QueryResult> {
    return this.execute("range", { range: [from, to] });
  }

  limit(limit: number): Promise<QueryResult> {
    return this.execute("limit", { limit });
  }

  maybeSingle(): Promise<QueryResult> {
    return this.execute("maybeSingle", {});
  }

  private async execute(
    terminal: QueryCall["terminal"],
    page: Pick<QueryCall, "range" | "limit">,
  ): Promise<QueryResult> {
    const query = {
      table: this.table,
      selected: this.selected,
      filters: [...this.filters],
      orders: [...this.orders],
      ...page,
      terminal,
    };
    const result = mockRuntime.resolve(query);
    mockRuntime.calls.push({
      ...query,
      resultCount: Array.isArray(result.data)
        ? result.data.length
        : result.data == null
        ? 0
        : 1,
    });
    return result;
  }
}

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn((table: string) => new MockQuery(table)),
    rpc: jest.fn((name: string) => {
      mockRuntime.rpcCalls.push(name);
      return Promise.resolve(mockRuntime.health);
    }),
  },
}));

import {
  getMarketingOverview,
  rollupFunnel,
} from "../marketingOverviewService";
import { getCampaignReport } from "../marketingReportService";

const brandId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const trackedAt = "2026-08-27T12:00:00.000Z";

const healthy = {
  data: [{ delivery_healthy: true, open_healthy: true }],
  error: null,
};

function installRuntime(
  resolve: MockRuntime["resolve"],
  health: QueryResult = healthy,
): MockRuntime {
  mockRuntime = { calls: [], rpcCalls: [], resolve, health };
  return mockRuntime;
}

function slicePage<T>(rows: T[], call: Omit<QueryCall, "resultCount">): T[] {
  if (call.range === undefined) return rows;
  return rows.slice(call.range[0], call.range[1] + 1);
}

interface MockMessage {
  id: string;
  recipient_email: string;
  status: "sent";
  sent_at: string;
  click_count: number;
  failure_reason: null;
  delivery_tracking_eligible_at: string | null;
  open_tracking_eligible_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
}

function message(index: number): MockMessage {
  return {
    id: `message-${String(index).padStart(4, "0")}`,
    recipient_email: `person-${index}@example.com`,
    status: "sent" as const,
    sent_at: trackedAt,
    click_count: index < 2 ? 1 : 0,
    failure_reason: null,
    delivery_tracking_eligible_at: trackedAt,
    open_tracking_eligible_at: trackedAt,
    delivered_at: trackedAt,
    opened_at: index === 2 ? trackedAt : null,
  };
}

function metricRows(): MockMessage[] {
  const rows = Array.from({ length: 1_205 }, (_, index) => message(index));
  rows[0] = {
    ...rows[0],
    delivery_tracking_eligible_at: null,
    open_tracking_eligible_at: null,
    delivered_at: trackedAt,
    opened_at: trackedAt,
  };
  rows[1] = {
    ...rows[1],
    delivered_at: null,
    opened_at: trackedAt,
  };
  return rows;
}

function campaignRow() {
  return {
    id: campaignId,
    account_id: brandId,
    brand_id: brandId,
    name: "Measured campaign",
    status: "sent",
    sent_at: trackedAt,
    created_at: trackedAt,
  };
}

function overviewResolver(
  rows: MockMessage[],
): MockRuntime["resolve"] {
  return (call) => {
    if (call.table === "marketing_campaigns" && call.terminal === "range") {
      return { data: [campaignRow()], error: null };
    }
    if (call.table === "marketing_campaigns" && call.terminal === "limit") {
      return { data: [campaignRow()], error: null };
    }
    if (call.table === "marketing_messages") {
      return { data: slicePage(rows, call), error: null };
    }
    if (call.table === "marketing_clicks") return { data: [], error: null };
    throw new Error(`Unexpected overview query: ${call.table} ${call.selected}`);
  };
}

function reportResolver(
  rows: MockMessage[],
  clicks: Array<{
    id: string;
    destination_url: string;
    clicked_at: string | null;
    message_id: string | null;
  }> = [],
): MockRuntime["resolve"] {
  return (call) => {
    if (call.table === "marketing_campaigns") {
      return { data: campaignRow(), error: null };
    }
    if (call.table === "marketing_messages" && call.terminal === "range") {
      return { data: slicePage(rows, call), error: null };
    }
    if (call.table === "marketing_messages" && call.terminal === "limit") {
      return { data: rows.slice(0, call.limit ?? 0), error: null };
    }
    if (call.table === "marketing_clicks") {
      return { data: slicePage(clicks, call), error: null };
    }
    throw new Error(`Unexpected report query: ${call.table} ${call.selected}`);
  };
}

function pagedCalls(runtime: MockRuntime, table: string): QueryCall[] {
  return runtime.calls.filter((call) =>
    call.table === table && call.terminal === "range"
  );
}

function expectDeterministicPages(
  calls: QueryCall[],
  expectedRanges: number[][],
): void {
  expect(calls.map((call) => call.range)).toEqual(expectedRanges);
  for (const call of calls) {
    expect(call.orders).toContainEqual(["id", { ascending: true }]);
  }
}

describe("#2714 executable campaign measurement", () => {
  it("keeps delivery and open cohorts independent and uses only eligible delivered mail", () => {
    const historical = rollupFunnel([{
      status: "opened",
      delivered_at: trackedAt,
      opened_at: trackedAt,
    }], 0);
    expect(historical.sent).toBe(1);
    expect(historical.delivered).toBe(0);
    expect(historical.opened).toBe(0);
    expect(historical.trackedDelivered).toBe(0);
    expect(historical.hasDeliveryCoverage).toBe(false);
    expect(historical.hasOpenCoverage).toBe(false);

    const deliveryOnly = rollupFunnel([{
      status: "delivered",
      delivery_tracking_eligible_at: trackedAt,
      delivered_at: trackedAt,
    }], 0);
    expect(deliveryOnly.hasDeliveryCoverage).toBe(true);
    expect(deliveryOnly.hasOpenCoverage).toBe(false);

    const unopened = rollupFunnel([message(9)], 0);
    expect(unopened.opened).toBe(0);
    expect(unopened.trackedDelivered).toBe(1);
    expect(unopened.hasOpenCoverage).toBe(true);

    const mixed = rollupFunnel([
      message(2),
      { ...message(3), delivered_at: null, opened_at: trackedAt },
      { ...message(4), open_tracking_eligible_at: null, opened_at: trackedAt },
    ], 0);
    expect(mixed.trackedDelivered).toBe(1);
    expect(mixed.opened).toBe(1);
    expect(mixed).toHaveProperty("hasDeliveryCoverage", true);
    expect(mixed).toHaveProperty("hasOpenCoverage", true);
    expect(mixed).toHaveProperty("trackedDelivered", 1);
    expect(mixed).not.toHaveProperty("hasEventCoverage");
  });

  it("executes all overview pages, health, and the complete tracked denominator", async () => {
    const rows = metricRows();
    const runtime = installRuntime(overviewResolver(rows));
    const result = await getMarketingOverview({ brand_id: brandId });

    expect(result.funnel.sent).toBe(1_205);
    expect(result.funnel.delivered).toBe(1_203);
    expect(result.funnel.trackedDelivered).toBe(1_203);
    expect(result.funnel.opened).toBe(1);
    expect(result.funnel.hasDeliveryCoverage).toBe(true);
    expect(result.funnel.hasOpenCoverage).toBe(true);
    expect(result.funnel).not.toHaveProperty("hasEventCoverage");
    expect(runtime.rpcCalls).toEqual(["mkt_campaign_email_event_health"]);

    const messageCalls = pagedCalls(runtime, "marketing_messages");
    expectDeterministicPages(messageCalls, [
      [0, 499],
      [500, 999],
      [1_000, 1_499],
    ]);
    expect(messageCalls.map((call) => call.resultCount)).toEqual([500, 500, 205]);
  });

  it("withholds only unhealthy overview coverage without rewriting counts", async () => {
    const runtime = installRuntime(
      overviewResolver([message(2)]),
      { data: [{ delivery_healthy: false, open_healthy: true }], error: null },
    );
    const result = await getMarketingOverview({ brand_id: brandId });

    expect(result.funnel.delivered).toBe(1);
    expect(result.funnel.opened).toBe(1);
    expect(result.funnel.trackedDelivered).toBe(1);
    expect(result.funnel.hasDeliveryCoverage).toBe(false);
    expect(result.funnel.hasOpenCoverage).toBe(true);
    expect(runtime.rpcCalls).toEqual(["mkt_campaign_email_event_health"]);
  });

  it("executes all report metric/click pages while keeping recipients capped", async () => {
    const rows = metricRows();
    const clicks = Array.from({ length: 501 }, (_, index) => ({
      id: `click-${String(index).padStart(4, "0")}`,
      destination_url: index < 400
        ? "https://example.com/a"
        : "https://example.com/b",
      clicked_at: trackedAt,
      message_id: index % 2 === 0 ? "message-0002" : "message-0003",
    }));
    const runtime = installRuntime(reportResolver(rows, clicks));
    const result = await getCampaignReport(campaignId);

    expect(result.recipientStats.total).toBe(1_205);
    expect(result.recipientStats.delivered).toBe(1_203);
    expect(result.recipientStats.trackedDelivered).toBe(1_203);
    expect(result.recipientStats.opened).toBe(1);
    expect(result.recipientStats.hasDeliveryCoverage).toBe(true);
    expect(result.recipientStats.hasOpenCoverage).toBe(true);
    expect(result.recipientStats).not.toHaveProperty("hasEventCoverage");
    expect(result.recipients).toHaveLength(500);
    expect(result.clickStats.total_clicks).toBe(501);
    expect(result.clickStats.unique_clickers).toBe(2);
    expect(result.clickStats.top_links[0]).toEqual({
      destination_url: "https://example.com/a",
      clicks: 400,
    });
    expect(runtime.rpcCalls).toEqual(["mkt_campaign_email_event_health"]);

    const messageCalls = pagedCalls(runtime, "marketing_messages");
    expectDeterministicPages(messageCalls, [
      [0, 499],
      [500, 999],
      [1_000, 1_499],
    ]);
    expect(messageCalls.map((call) => call.resultCount)).toEqual([500, 500, 205]);
    expectDeterministicPages(pagedCalls(runtime, "marketing_clicks"), [
      [0, 499],
      [500, 999],
    ]);
    const presentation = runtime.calls.find((call) =>
      call.table === "marketing_messages" && call.terminal === "limit"
    );
    expect(presentation?.limit).toBe(500);
    expect(presentation?.resultCount).toBe(500);
  });

  it("withholds only unhealthy report coverage without rewriting counts", async () => {
    const runtime = installRuntime(
      reportResolver([message(2)]),
      { data: [{ delivery_healthy: true, open_healthy: false }], error: null },
    );
    const result = await getCampaignReport(campaignId);

    expect(result.recipientStats.delivered).toBe(1);
    expect(result.recipientStats.opened).toBe(1);
    expect(result.recipientStats.trackedDelivered).toBe(1);
    expect(result.recipientStats.hasDeliveryCoverage).toBe(true);
    expect(result.recipientStats.hasOpenCoverage).toBe(false);
    expect(runtime.rpcCalls).toEqual(["mkt_campaign_email_event_health"]);
  });

  it.each([
    ["overview", () => getMarketingOverview({ brand_id: brandId }), overviewResolver],
    ["report", () => getCampaignReport(campaignId), reportResolver],
  ])("%s rejects health errors and missing health rows", async (
    _name,
    invoke,
    resolver,
  ) => {
    installRuntime(resolver([message(2)]), {
      data: null,
      error: new Error("health failed"),
    });
    await expect(invoke()).rejects.toThrow("health failed");

    installRuntime(resolver([message(2)]), { data: [], error: null });
    await expect(invoke()).rejects.toThrow("Campaign email health unavailable");
  });

  it.each([
    ["overview", () => getMarketingOverview({ brand_id: brandId }), overviewResolver],
    ["report", () => getCampaignReport(campaignId), reportResolver],
  ])("%s rejects a middle metric page instead of returning partial truth", async (
    _name,
    invoke,
    baseResolver,
  ) => {
    const rows = Array.from({ length: 1_205 }, (_, index) => message(index));
    const resolve = baseResolver(rows);
    const failure = new Error("middle page failed");
    installRuntime((call) => {
      if (
        call.table === "marketing_messages" &&
        call.terminal === "range" &&
        call.range?.[0] === 500
      ) return { data: null, error: failure };
      return resolve(call);
    });

    await expect(invoke()).rejects.toBe(failure);
    expect(
      pagedCalls(mockRuntime, "marketing_messages").map((call) => call.range),
    ).toEqual([
      [0, 499],
      [500, 999],
    ]);
    expect(mockRuntime.rpcCalls).toEqual([]);
  });
});
