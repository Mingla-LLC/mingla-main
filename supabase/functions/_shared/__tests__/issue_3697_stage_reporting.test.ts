import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdStageMetricTarget,
  parseMetaStageMetrics,
  parseSnapchatStageMetrics,
  parseTikTokStageMetrics,
} from "../adStageReporting.ts";

const traffic: AdStageMetricTarget = {
  id: "local-traffic",
  externalAdSetId: "provider-traffic",
  stage: "retarget",
  optimizationGoal: "LANDING_PAGE_VIEWS",
};
const sales: AdStageMetricTarget = {
  id: "local-sales",
  externalAdSetId: "provider-sales",
  stage: "abandoners",
  optimizationGoal: "PIXEL_PURCHASE",
};

Deno.test("#3697 Meta reporting is daily and keyed by the provider ad set", () => {
  const rows = parseMetaStageMetrics({
    data: [{
      adset_id: "provider-traffic",
      date_start: "2026-10-22",
      spend: "12.34",
      reach: "800",
      frequency: "1.5",
      impressions: "1200",
      actions: [{ action_type: "landing_page_view", value: "40" }],
    }],
  }, [traffic]);
  assertEquals(rows, [{
    ad_set_id: "local-traffic",
    stage: "retarget",
    metric_date: "2026-10-22",
    spend_cents: 1234,
    results: 40,
    result_type: "landing_page_view",
    cost_per_result_cents: 31,
    reach: 800,
    frequency: 1.5,
    impressions: 1200,
  }]);
});

Deno.test("#3697 TikTok reporting keeps the full 30-day ad-group span", () => {
  const list = Array.from({ length: 30 }, (_, index) => ({
    dimensions: {
      adgroup_id: "provider-sales",
      stat_time_day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    },
    metrics: {
      spend: "1.00",
      impressions: "100",
      reach: "50",
      conversion: "2",
    },
  }));
  const rows = parseTikTokStageMetrics({ list }, [sales]);
  assertEquals(rows.length, 30);
  assertEquals(rows[0].result_type, "complete_payment");
  assertEquals(rows[0].frequency, 2);
});

Deno.test("#3697 Snap reporting converts microcurrency and provider results", () => {
  const rows = parseSnapchatStageMetrics({
    timeseries_stats: [{
      timeseries_stat: {
        timeseries: [{
          start_time: "2026-10-22T00:00:00Z",
          stats: {
            spend: 2_500_000,
            impressions: 500,
            reach: 250,
            conversion_purchases: 5,
          },
        }],
      },
    }],
  }, sales);
  assertEquals(rows[0], {
    ad_set_id: "local-sales",
    stage: "abandoners",
    metric_date: "2026-10-22",
    spend_cents: 250,
    results: 5,
    result_type: "purchase",
    cost_per_result_cents: 50,
    reach: 250,
    frequency: 2,
    impressions: 500,
  });
});

Deno.test("#3697 unknown provider ad sets never attach to local stages", () => {
  assertEquals(
    parseMetaStageMetrics({
      data: [{ adset_id: "other", date_start: "2026-10-22", spend: "999" }],
    }, [traffic]),
    [],
  );
});
