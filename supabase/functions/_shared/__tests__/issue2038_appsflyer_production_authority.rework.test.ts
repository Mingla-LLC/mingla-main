import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../adAppReadinessProviders/appsflyer.ts";
import type { BindingRow, TargetRow } from "../adAppReadiness.ts";

const TARGET: TargetRow = {
  app_key: "business",
  os: "android",
  display_name: "Mingla Business",
  store_identifier: "com.sethogieva.minglabusiness",
  appsflyer_app_id: "com.sethogieva.minglabusiness",
  onelink_url: "https://biz.usemingla.com/ZSCW",
  active: true,
};

const BINDING: BindingRow = {
  app_key: "business",
  os: "android",
  provider: "tiktok",
  payer_connection_id: "corporate-tiktok",
  public_identity_required: true,
  provider_app_id: "7673555244336316436",
  provider_measurement_id: "7673555244336300052",
  active: true,
};

const MAPPING = {
  identifier: "Registration",
  name: "af_complete_registration",
  "sending option": "This partner only",
};

async function verify(row: Record<string, unknown>) {
  const read = createAppsFlyerMeasurementReader(
    () => "server-only-test-token",
    () => Promise.resolve(new Response(JSON.stringify([row]))),
  );
  return (await verifyAppsflyer(
    TARGET,
    new AbortController().signal,
    "2026-08-13T22:00:00.000Z",
    read,
    [BINDING],
  )).tiktok;
}

function productionRow(overrides: Record<string, unknown> = {}) {
  return {
    pid: "tiktokglobal_int",
    general_params: { tiktok_app_id: "7673555244336300052" },
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": [MAPPING],
    },
    ...overrides,
  };
}

Deno.test("#2038 rework gives explicit production postback false absolute authority", async () => {
  const result = await verify(productionRow({
    general_params: {
      tiktok_app_id: "7673555244336300052",
      unknown: { event_name: "install", enabled: true },
    },
    in_app_postbacks_params: {
      "Send in-app events postbacks": "false",
      "mapped-in-app-events": [MAPPING],
    },
  }));
  assertEquals(result.status, "action_required");
  assertStringIncludes(result.summary, "postbacks are disabled");
});

Deno.test("#2038 rework rejects top-level identity fallback for production rows", async () => {
  const result = await verify(productionRow({
    app_id: "7673555244336300052",
    general_params: {},
  }));
  assertEquals(result.status, "action_required");
  assertEquals(result.safe_id, undefined);
  assertStringIncludes(result.summary, "does not return its exact");
});

Deno.test("#2038 rework bounds production mapping arrays", async () => {
  const mappings = Array.from({ length: 5_000 }, (_, index) => ({
    identifier: `Event-${index}`,
    name: `af_event_${index}`,
    "sending option": "This partner only",
  }));
  const result = await verify(productionRow({
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": mappings,
    },
  }));
  assertEquals(result.status, "action_required");
  assertStringIncludes(result.summary, "no valid enabled event mapping");
});
