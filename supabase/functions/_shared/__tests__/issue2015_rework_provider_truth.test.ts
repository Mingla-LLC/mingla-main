import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../adAppReadinessProviders/appsflyer.ts";
import {
  GOOGLE_APP_BINDING_GAQL,
  parseGoogleAppBindings,
} from "../adAppReadinessProviders/google.ts";
import { parseRedditApps } from "../adAppReadinessProviders/reddit.ts";
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

const EXACT_INTEGRATION = {
  integrations: [{
    pid: "facebook_int",
    app_id: "123456789",
    privacy_status: "active",
    in_app_postbacks_params: [{
      event_name: "af_install",
      enabled: true,
    }],
  }],
};

function binding(measurementId: string | null): BindingRow {
  return {
    app_key: "business",
    os: "android",
    provider: "meta",
    payer_connection_id: "payer",
    public_identity_required: true,
    provider_app_id: "123456789",
    provider_measurement_id: measurementId,
    active: true,
  };
}

function readerFor(payload: unknown, headers?: HeadersInit) {
  return createAppsFlyerMeasurementReader(
    () => "server-token",
    () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), { status: 200, headers }),
      ),
  );
}

Deno.test("#2015 rework requires one exact canonical AppsFlyer measurement identity", async () => {
  const check = (measurementId: string | null) =>
    verifyAppsflyer(
      TARGET,
      new AbortController().signal,
      "2026-08-13T16:00:00.000Z",
      readerFor(EXACT_INTEGRATION),
      [binding(measurementId)],
    );

  assertEquals((await check(null)).meta.status, "action_required");
  assertEquals((await check("987654321")).meta.status, "action_required");
  const exact = (await check("123456789")).meta;
  assertEquals(exact.status, "proven");
  assertEquals(exact.safe_id, "123456789");
});

Deno.test("#2015 rework enforces the AppsFlyer byte ceiling without trusting Content-Length", async () => {
  const normal = await readerFor(EXACT_INTEGRATION)(
    TARGET,
    new AbortController().signal,
  );
  assertEquals(normal?.meta?.partnerActive, true);

  const oversizedBody = new Uint8Array(1_000_001).fill(32);
  const oversizedReader = (headers?: HeadersInit) =>
    createAppsFlyerMeasurementReader(
      () => "server-token",
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(oversizedBody.subarray(0, 700_000));
                controller.enqueue(oversizedBody.subarray(700_000));
                controller.close();
              },
            }),
            { status: 200, headers },
          ),
        ),
    );

  await assertRejects(
    () => oversizedReader()(TARGET, new AbortController().signal),
    Error,
    "appsflyer_response_invalid",
  );
  await assertRejects(
    () =>
      oversizedReader({ "content-length": "12" })(
        TARGET,
        new AbortController().signal,
      ),
    Error,
    "appsflyer_response_invalid",
  );
  await assertRejects(
    () =>
      readerFor(EXACT_INTEGRATION, { "content-length": "1000001" })(
        TARGET,
        new AbortController().signal,
      ),
    Error,
    "appsflyer_response_invalid",
  );
});

Deno.test("#2015 rework maps Reddit's official ID-only shape only through the exact canonical target", () => {
  assertEquals(
    parseRedditApps({ data: [{ id: "6760440898" }] }, {
      os: "ios",
      store_identifier: "6760440898",
    }),
    [{ appId: "6760440898", platform: "ios" }],
  );
  assertEquals(
    parseRedditApps({ data: [{ id: "com.mingla.app.v2" }] }, {
      os: "android",
      store_identifier: "com.mingla.app.v2",
    }),
    [{ appId: "com.mingla.app.v2", platform: "android" }],
  );
  assertEquals(
    parseRedditApps({ data: [{ id: "arbitrary-looking-id" }] }, {
      os: "android",
      store_identifier: "com.mingla.app.v2",
    }),
    [{ appId: "arbitrary-looking-id", platform: null }],
  );
});

Deno.test("#2015 rework excludes removed and null Google app bindings and keeps funding non-ready", () => {
  const campaign = (
    status: string,
    appId: string | null,
  ): Record<string, unknown> => ({
    campaign: {
      id: `${status}-campaign`,
      status,
      appCampaignSetting: {
        appId,
        appStore: "GOOGLE_APP_STORE",
      },
    },
  });
  assertEquals(
    parseGoogleAppBindings({
      results: [
        campaign("ENABLED", TARGET.store_identifier),
        campaign("PAUSED", TARGET.store_identifier),
        campaign("REMOVED", TARGET.store_identifier),
        campaign("ENABLED", null),
      ],
    }).map((row) => row.campaignId),
    ["ENABLED-campaign", "PAUSED-campaign"],
  );
  assertStringIncludes(GOOGLE_APP_BINDING_GAQL, "campaign.status != 'REMOVED'");
  assertStringIncludes(
    GOOGLE_APP_BINDING_GAQL,
    "campaign.app_campaign_setting.app_id IS NOT NULL",
  );
});
