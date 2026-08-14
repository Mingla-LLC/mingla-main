import {
  assertEquals,
  assertNotMatch,
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

async function verify(row: Record<string, unknown>) {
  const read = createAppsFlyerMeasurementReader(
    () => "server-only-test-token",
    () => Promise.resolve(new Response(JSON.stringify([row]))),
  );
  return (await verifyAppsflyer(
    TARGET,
    new AbortController().signal,
    "2026-08-13T21:00:00.000Z",
    read,
    [BINDING],
  )).tiktok;
}

function row(postbackValue: unknown, extra: Record<string, unknown> = {}) {
  return {
    pid: "tiktokglobal_int",
    general_params: { tiktok_app_id: "7673555244336300052" },
    in_app_postbacks_params: {
      "Send in-app events postbacks": postbackValue,
      "mapped-in-app-events": [{
        identifier: "Registration",
        name: "af_complete_registration",
        "sending option": "This partner only",
      }],
    },
    ...extra,
  };
}

Deno.test("#2038 adversarial parser rejects truthy impostors and never echoes raw payload fields", async () => {
  for (const impostor of ["false", "1", "yes", 1, {}, [true]]) {
    const result = await verify(row(impostor, {
      raw_token: "must-never-escape",
      device_id: "must-never-escape",
    }));
    assertEquals(result.status, "action_required");
    assertStringIncludes(result.summary, "postbacks are disabled");
    assertNotMatch(JSON.stringify(result), /must-never-escape/);
  }

  const unknownIdKey = await verify({
    ...row("true"),
    general_params: { arbitrary_app_id: "7673555244336300052" },
  });
  assertEquals(unknownIdKey.status, "action_required");
  assertStringIncludes(unknownIdKey.summary, "does not return its exact");

  const unknownSendingOption = await verify({
    ...row("true"),
    in_app_postbacks_params: {
      "Send in-app events postbacks": "true",
      "mapped-in-app-events": [{
        identifier: "Registration",
        name: "af_complete_registration",
        "sending option": "Definitely enabled, trust me",
      }],
    },
  });
  assertEquals(unknownSendingOption.status, "action_required");
  assertStringIncludes(
    unknownSendingOption.summary,
    "no valid enabled event mapping",
  );
});
