import {
  assertEquals,
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
  verifyCanonicalBinding,
} from "../adAppReadinessProviders/common.ts";

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
  assertEquals(result.reason_code, "funding_missing");
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
