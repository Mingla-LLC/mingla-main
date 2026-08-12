import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  deriveFreshVerdict,
  type DimensionEvidence,
  DIMENSIONS,
  evidence,
  READINESS_PROVIDERS,
  reduceVerdict,
  sanitizeUrl,
  targetKey,
} from "../adAppReadiness.ts";
import {
  assertReadOnlyProviderRequest,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "../adAppReadinessProviders/common.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../adAppReadinessProviders/appsflyer.ts";

function all(
  status: "proven" | "action_required" | "blocked",
): DimensionEvidence {
  const at = "2026-08-12T12:00:00.000Z";
  return Object.fromEntries(
    DIMENSIONS.map((name) => [name, evidence(status, `${name} evidence`, at)]),
  ) as DimensionEvidence;
}

Deno.test("#1950 Ready requires every current required dimension and exact N/A matrix", () => {
  for (const provider of READINESS_PROVIDERS) {
    const dimensions = all("proven");
    if (!["meta", "tiktok"].includes(provider)) {
      dimensions.identity = evidence(
        "not_applicable",
        "No social identity is shown.",
        "2026-08-12T12:00:00.000Z",
      );
    }
    assertEquals(reduceVerdict(provider, dimensions), "ready");
    dimensions.measurement = evidence(
      "action_required",
      "Missing measurement.",
      "2026-08-12T12:00:00.000Z",
    );
    assertEquals(reduceVerdict(provider, dimensions), "action_required");
  }
  const invalidMeta = all("proven");
  invalidMeta.identity = evidence(
    "not_applicable",
    "Wrong.",
    "2026-08-12T12:00:00.000Z",
  );
  assertEquals(reduceVerdict("meta", invalidMeta), "blocked");
});

Deno.test("#1950 freshness boundary is strict and sibling target keys never collide", () => {
  const staleAt = "2026-08-12T12:15:00.000Z";
  assertEquals(
    deriveFreshVerdict("ready", staleAt, "2026-08-12T12:14:59.999Z"),
    "ready",
  );
  assertEquals(deriveFreshVerdict("ready", staleAt, staleAt), "stale");
  const keys = new Set(
    ["explorer", "business"].flatMap((app) =>
      ["ios", "android"].flatMap((os) =>
        READINESS_PROVIDERS.map((provider) =>
          `${targetKey(app as never, os as never)}:${provider}`
        )
      )
    ),
  );
  assertEquals(keys.size, 20);
});

Deno.test("#1950 canonical verifier cannot manufacture Ready from stored setup", () => {
  const result = verifyCanonicalBinding("meta", {
    target: {
      app_key: "business",
      os: "ios",
      display_name: "Mingla Business",
      store_identifier: "6768737367",
      appsflyer_app_id: "id6768737367",
      onelink_url: "https://biz.usemingla.com/ZSCW",
      active: true,
    },
    binding: {
      app_key: "business",
      os: "ios",
      provider: "meta",
      payer_connection_id: "payer",
      public_identity_required: true,
      provider_app_id: "app",
      provider_measurement_id: "measurement",
      active: true,
    },
    connection: {
      id: "payer",
      platform: "meta",
      lane: "consumer",
      display_name: "Mingla",
      external_account_id: "act_1",
      connected: true,
      status: "connected",
      account_status: "ACTIVE",
      extra: { has_payment_method: true },
    },
    identitySafeId: "17841422359567322",
    signal: new AbortController().signal,
    deadlineMs: 8000,
    checkedAt: "2026-08-12T12:00:00.000Z",
  });
  assertEquals(result.reason_code, "native_binding_missing");
  assertEquals(result.dimensions.binding.status, "action_required");
  assertEquals(result.dimensions.binding.source_class, "canonical_registry");
  assertEquals(result.dimensions.measurement.status, "action_required");
  assertEquals(
    result.dimensions.measurement.source_class,
    "canonical_registry",
  );
  assertEquals(result.dimensions.funding.status, "action_required");
});

Deno.test("#1950 provider method guard rejects every write method except named Meta validate-only", () => {
  assertThrows(
    () => assertReadOnlyProviderRequest("POST"),
    Error,
    "provider_write_forbidden",
  );
  assertThrows(
    () => assertReadOnlyProviderRequest("PATCH"),
    Error,
    "provider_write_forbidden",
  );
  assertThrows(
    () => assertReadOnlyProviderRequest("DELETE"),
    Error,
    "provider_write_forbidden",
  );
  assertReadOnlyProviderRequest("GET");
  assertReadOnlyProviderRequest("POST", "meta_exact_identity_validate_only");
});

Deno.test("#1950 action URLs strip query/fragment and reject unsafe hosts", () => {
  assertEquals(
    sanitizeUrl("https://ads.google.com/billing?token=secret#x"),
    "https://ads.google.com/billing",
  );
  assertEquals(sanitizeUrl("javascript:alert(1)"), undefined);
  assertEquals(sanitizeUrl("http://ads.google.com/billing"), undefined);
  assertEquals(sanitizeUrl("https://evil.example/billing"), undefined);
});

Deno.test("#1950 AppsFlyer defaults non-ready and only an injected read authority can prove measurement", async () => {
  const target = {
    app_key: "business",
    os: "ios",
    display_name: "Mingla Business",
    store_identifier: "6768737367",
    appsflyer_app_id: "id6768737367",
    onelink_url: "https://biz.usemingla.com/ZSCW",
    active: true,
  } as const;
  const signal = new AbortController().signal;
  const missing = await verifyAppsflyer(
    target,
    signal,
    "2026-08-12T12:00:00.000Z",
  );
  assertEquals(missing.meta.status, "action_required");
  assertEquals(missing.meta.source_class, "canonical_registry");
  const proven = await verifyAppsflyer(
    target,
    signal,
    "2026-08-12T12:00:00.000Z",
    () =>
      Promise.resolve({
        meta: { partnerActive: true, installEventMapped: true },
      }),
  );
  assertEquals(proven.meta.status, "proven");
  assertEquals(proven.meta.source_class, "appsflyer_api");
  assertEquals(proven.tiktok.status, "action_required");
});

Deno.test("#1950 production AppsFlyer reader uses one bounded GET and never the S2S token", async () => {
  const requests: Request[] = [];
  const reader = createAppsFlyerMeasurementReader(
    () => "read-token",
    (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            integrations: [{
              pid: "facebook_int",
              general_params: {
                event_name: "af_install",
                enabled: true,
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );
  const snapshot = await reader({
    app_key: "business",
    os: "ios",
    display_name: "Mingla Business",
    store_identifier: "6768737367",
    appsflyer_app_id: "id6768737367",
    onelink_url: "https://biz.usemingla.com/ZSCW",
    active: true,
  }, new AbortController().signal);
  const request = requests[0];
  assertEquals(request.method, "GET");
  assertEquals(
    request.url,
    "https://hq1.appsflyer.com/api/app-integrations/v1/integrations/id6768737367",
  );
  assertEquals(request.headers.get("authorization"), "Bearer read-token");
  assertEquals(snapshot?.meta, {
    partnerActive: true,
    installEventMapped: true,
  });
  assertEquals(snapshot?.tiktok?.partnerActive, false);
});

Deno.test("#1950 operation guard is on the execution path and rejects method/path drift", async () => {
  let calls = 0;
  await runAllowedProviderOperation(
    "tiktok",
    "advertiser",
    "GET",
    "advertiser/info/",
    () => {
      calls += 1;
      return Promise.resolve("ok");
    },
  );
  assertEquals(calls, 1);
  await assertRejects(
    () =>
      runAllowedProviderOperation(
        "tiktok",
        "advertiser",
        "POST",
        "advertiser/info/",
        () => {
          calls += 1;
          return Promise.resolve("bad");
        },
      ),
    Error,
    "provider_operation_forbidden",
  );
  assertEquals(calls, 1);
});

Deno.test("#1950 exact current dashboard attestation can prove binding but stored or expired evidence cannot", () => {
  const context = {
    target: {
      app_key: "business",
      os: "ios",
      display_name: "Mingla Business",
      store_identifier: "6768737367",
      appsflyer_app_id: "id6768737367",
      onelink_url: "https://biz.usemingla.com/ZSCW",
      active: true,
    },
    binding: {
      app_key: "business",
      os: "ios",
      provider: "meta",
      payer_connection_id: "payer",
      public_identity_required: true,
      provider_app_id: "meta-app-business-ios",
      provider_measurement_id: "facebook_int",
      native_binding_attested_at: "2026-08-12T12:00:00.000Z",
      native_binding_attestation_expires_at: "2026-08-12T12:15:00.000Z",
      native_binding_attestation_safe_id: "meta-app-business-ios",
      native_binding_attestation_provenance: "provider_dashboard",
      native_binding_attested_by: "admin",
      active: true,
    },
    connection: {
      id: "payer",
      platform: "meta",
      lane: "consumer",
      display_name: "Mingla",
      external_account_id: "act_1",
      connected: true,
      status: "connected",
      account_status: "ACTIVE",
      extra: {},
    },
    signal: new AbortController().signal,
    deadlineMs: 8000,
    checkedAt: "2026-08-12T12:14:59.999Z",
  } as const;
  const current = verifyCanonicalBinding("meta", context);
  assertEquals(current.dimensions.binding.status, "proven");
  assertEquals(
    current.dimensions.binding.source_class,
    "dashboard_attestation",
  );
  const expired = verifyCanonicalBinding("meta", {
    ...context,
    checkedAt: "2026-08-12T12:15:00.000Z",
  });
  assertEquals(expired.dimensions.binding.status, "action_required");
  const mismatch = verifyCanonicalBinding("meta", {
    ...context,
    binding: {
      ...context.binding,
      native_binding_attestation_safe_id: "different-app",
    },
  });
  assertEquals(mismatch.dimensions.binding.status, "action_required");
});

Deno.test("#1950 a cell becomes Ready only after current external and attested authority agree", () => {
  const at = "2026-08-12T12:14:59.999Z";
  const dimensions: DimensionEvidence = {
    payer: evidence("proven", "Exact live payer.", at, "provider_api"),
    identity: evidence("proven", "Exact live identity.", at, "provider_api"),
    binding: evidence(
      "proven",
      "Exact current binding attestation.",
      at,
      "dashboard_attestation",
      "meta-app-business-ios",
    ),
    measurement: evidence(
      "proven",
      "Exact AppsFlyer partner and event mapping.",
      at,
      "appsflyer_api",
      "id6768737367",
    ),
    funding: evidence("proven", "Current live funding.", at, "provider_api"),
  };
  assertEquals(reduceVerdict("meta", dimensions), "ready");
  dimensions.binding = evidence(
    "action_required",
    "Stored app ID only.",
    at,
    "canonical_registry",
  );
  assertEquals(reduceVerdict("meta", dimensions), "action_required");
});

Deno.test("#1950 production entry injects the safe AppsFlyer reader instead of the null default", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-app-readiness/index.ts", import.meta.url),
  );
  assertEquals(source.includes("createAppsFlyerMeasurementReader"), true);
  assertEquals(
    source.includes('resolveCapiToken("APPSFLYER_API_V2_TOKEN")'),
    true,
  );
  assertEquals(source.includes("checks: {"), true);
  assertEquals(source.includes("readAppsFlyerMeasurement"), true);
  assertEquals(source.includes("APPSFLYER_S2S_TOKEN"), false);
});
