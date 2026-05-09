import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildRetryChildRows,
  classifyPlaceIntelFailure,
  deriveCityCoverage,
  selectFailedRowsForRetry,
} from "./placeIntelRetryCoverage.ts";

Deno.test("classifyPlaceIntelFailure marks Raleigh-style retryable failures", () => {
  const quota = classifyPlaceIntelFailure(`Gemini 429: {
    "error": {
      "message": "Your prepayment credits are depleted.",
      "status": "RESOURCE_EXHAUSTED"
    }
  }`);
  const malformed = classifyPlaceIntelFailure(
    "Gemini returned no function_call for evaluate_against_existing_signals (finishReason=MALFORMED_FUNCTION_CALL)",
  );
  const transient = classifyPlaceIntelFailure(
    "trial row update failed: TypeError: error sending request for https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/place_intelligence_trial_runs: connection reset",
  );

  assertEquals(quota, {
    failureClass: "gemini_quota_or_billing",
    retryable: true,
  });
  assertEquals(malformed, {
    failureClass: "malformed_function_call",
    retryable: true,
  });
  assertEquals(transient, {
    failureClass: "transient_infra_or_db",
    retryable: true,
  });
});

Deno.test("classifyPlaceIntelFailure keeps prerequisites_missing nonretryable by default", () => {
  const result = classifyPlaceIntelFailure(
    "prerequisites_missing: photo_collage_url is null — fetch_reviews + compose_collage must run before run_trial_for_place",
  );

  assertEquals(result, {
    failureClass: "prep_prerequisites_missing",
    retryable: false,
  });
});

Deno.test("deriveCityCoverage de-dupes completed places across runs", () => {
  const result = deriveCityCoverage(4, [
    { place_pool_id: "p1" },
    { place_pool_id: "p1" },
    { place_pool_id: "p2" },
    { place_pool_id: null },
  ]);

  assertEquals(result, {
    servable_count: 4,
    scored_count: 2,
    unscored_count: 2,
    scored_percent: 50,
  });
});

Deno.test("selectFailedRowsForRetry selects retryable rows and preserves source lineage", () => {
  const rows = [
    {
      id: "source-1",
      place_pool_id: "place-1",
      error_message: "Gemini 429 RESOURCE_EXHAUSTED",
    },
    {
      id: "source-2",
      place_pool_id: "place-2",
      error_message: "prerequisites_missing: photo_collage_url is null",
    },
    {
      id: "source-3",
      place_pool_id: "place-3",
      error_message: "MALFORMED_FUNCTION_CALL",
    },
  ];

  const selection = selectFailedRowsForRetry(rows);
  assertEquals(selection.failedCount, 3);
  assertEquals(selection.retryableCount, 2);
  assertEquals(selection.nonretryableCount, 1);
  assertEquals(selection.selectedRows.map((row) => row.id), [
    "source-1",
    "source-3",
  ]);

  const retryRows = buildRetryChildRows({
    runId: "retry-run",
    cityId: "city-1",
    rows: selection.selectedRows,
    promptVersion: "v4",
    model: "gemini-2.5-flash",
  });

  assertEquals(retryRows.map((row) => row.source_trial_run_id), [
    "source-1",
    "source-3",
  ]);
  assertEquals(retryRows.map((row) => row.status), ["pending", "pending"]);
  assertEquals(retryRows.map((row) => row.prep_status), [null, null]);
});
