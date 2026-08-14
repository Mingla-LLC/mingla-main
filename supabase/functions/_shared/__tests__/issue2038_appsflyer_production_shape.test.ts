import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../adAppReadinessProviders/appsflyer.ts";
import type { BindingRow, TargetRow } from "../adAppReadiness.ts";

const BUSINESS_ANDROID: TargetRow = {
  app_key: "business",
  os: "android",
  display_name: "Mingla Host",
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

function productionRow(overrides: Record<string, unknown> = {}) {
  return {
    pid: "tiktokglobal_int",
    general_params: {
      "Send all install events": "false",
      tiktok_app_id: "7673555244336300052",
    },
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": [{
        identifier: "Registration",
        name: "af_complete_registration",
        "send revenue": "false",
        "sending option": "This partner only",
      }],
    },
    ...overrides,
  };
}

async function check(
  row: Record<string, unknown>,
  target: TargetRow = BUSINESS_ANDROID,
) {
  const reader = createAppsFlyerMeasurementReader(
    () => "server-only-test-token",
    () => Promise.resolve(new Response(JSON.stringify([row]))),
  );
  return (await verifyAppsflyer(
    target,
    new AbortController().signal,
    "2026-08-13T20:00:00.000Z",
    reader,
    [{ ...BINDING, os: target.os }],
  )).tiktok;
}

Deno.test("#2038 proves the exact production-shaped Android AppsFlyer mapping", async () => {
  const result = await check(productionRow());
  assertEquals(result.status, "proven");
  assertEquals(result.source_class, "appsflyer_api");
  assertEquals(result.safe_id, "7673555244336300052");
});

Deno.test("#2038 fails closed on nested ID, postback, mapping, and iOS privacy gaps", async () => {
  const wrongId = await check(productionRow({
    general_params: { tiktok_app_id: "7673555244336300999" },
  }));
  assertEquals(wrongId.status, "action_required");
  assertEquals(wrongId.safe_id, "7673555244336300999");
  assertStringIncludes(wrongId.summary, "does not match");

  const falsePostback = await check(productionRow({
    in_app_postbacks_params: {
      "Send in-app events postbacks": "false",
      "mapped-in-app-events": [{
        identifier: "Registration",
        name: "af_complete_registration",
        "sending option": "This partner only",
      }],
    },
  }));
  assertEquals(falsePostback.status, "action_required");
  assertStringIncludes(falsePostback.summary, "postbacks are disabled");

  const malformedMapping = await check(productionRow({
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": [{
        identifier: "Registration",
        name: "af_complete_registration",
        "sending option": "Do not send",
      }],
    },
  }));
  assertEquals(malformedMapping.status, "action_required");
  assertStringIncludes(
    malformedMapping.summary,
    "no valid enabled event mapping",
  );

  const duplicateOnly = await check(productionRow({
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": [
        {
          identifier: "Registration",
          name: "af_complete_registration",
          "sending option": "This partner only",
        },
        {
          identifier: "Registration",
          name: "af_complete_registration",
          "sending option": "This partner only",
        },
      ],
    },
  }));
  assertEquals(duplicateOnly.status, "action_required");
  assertStringIncludes(duplicateOnly.summary, "no valid enabled event mapping");

  const ios = await check(productionRow(), {
    ...BUSINESS_ANDROID,
    os: "ios",
    store_identifier: "6768737367",
    appsflyer_app_id: "id6768737367",
  });
  assertEquals(ios.status, "action_required");
  assertStringIncludes(ios.summary, "iOS privacy/SKAN");
});
