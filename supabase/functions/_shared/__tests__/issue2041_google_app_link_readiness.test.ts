import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { BindingRow, TargetRow } from "../adAppReadiness.ts";
import {
  applyGoogleAppLinkEvidence,
  findExactGoogleAppLink,
  GOOGLE_APP_LINK_GAQL,
  parseGoogleAppLinks,
  verify,
} from "../adAppReadinessProviders/google.ts";
import { runAllowedProviderOperation } from "../adAppReadinessProviders/common.ts";
import { verifyCanonicalBinding } from "../adAppReadinessProviders/common.ts";

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
  provider: "google",
  payer_connection_id: "payer",
  public_identity_required: false,
  provider_app_id: TARGET.store_identifier,
  provider_measurement_id: "66CB20600C7FDA957E511684502DFFE3",
  active: true,
};

function link(overrides: Record<string, unknown> = {}) {
  const thirdPartyAppAnalytics = {
    appAnalyticsProviderId: "42",
    appId: TARGET.store_identifier,
    appVendor: "GOOGLE_APP_STORE",
    ...(overrides.thirdPartyAppAnalytics as Record<string, unknown> ?? {}),
  };
  return {
    accountLink: {
      status: "ENABLED",
      type: "THIRD_PARTY_APP_ANALYTICS",
      thirdPartyAppAnalytics,
      ...(overrides.accountLink as Record<string, unknown> ?? {}),
    },
    thirdPartyAppAnalyticsLink: {
      resourceName: "customers/3623860476/thirdPartyAppAnalyticsLinks/123",
      shareableLinkId: "66CB20600C7FDA957E511684502DFFE3",
      ...(overrides.thirdPartyAppAnalyticsLink as Record<string, unknown> ??
        {}),
    },
  };
}

Deno.test("#2041 production Google readiness owns the pre-campaign analytics-link query", () => {
  assertStringIncludes(
    GOOGLE_APP_LINK_GAQL,
    "FROM third_party_app_analytics_link",
  );
  assertStringIncludes(GOOGLE_APP_LINK_GAQL, "account_link.status = 'ENABLED'");
  assertStringIncludes(GOOGLE_APP_LINK_GAQL, "shareable_link_id");
  assertEquals(GOOGLE_APP_LINK_GAQL.includes("campaign"), false);
  assertStringIncludes(String(verify), "GOOGLE_APP_LINK_GAQL");
  assertStringIncludes(String(verify), "applyGoogleAppLinkEvidence");
  assertEquals(
    String(verify).includes("parseGoogleAppBindings(payload)"),
    false,
  );
  assertEquals(String(verify).includes("app-campaign"), false);
});

Deno.test("#2041 exact enabled app, vendor, provider, and Link ID prove without a campaign", () => {
  const parsed = parseGoogleAppLinks({ results: [link()] });
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].appAnalyticsProviderId, "42");
  assertEquals(
    parsed[0].shareableLinkId,
    "66CB20600C7FDA957E511684502DFFE3",
  );
  assertEquals(
    findExactGoogleAppLink(parsed, { target: TARGET, binding: BINDING }),
    parsed[0],
  );
  assertEquals(
    findExactGoogleAppLink(parsed, {
      target: TARGET,
      binding: {
        ...BINDING,
        provider_measurement_id: "595D7630DCA3E05A82CEADA049AD832E",
      },
    }),
    undefined,
  );
  assertEquals(
    findExactGoogleAppLink(parsed, {
      target: TARGET,
      binding: { ...BINDING, provider_app_id: "wrong.app" },
    }),
    undefined,
  );

  const context = {
    target: TARGET,
    binding: BINDING,
    connection: {
      id: "payer",
      platform: "google",
      lane: "consumer",
      display_name: "Google Ads",
      external_account_id: "3623860476",
      connected: true,
      status: "connected",
      account_status: "ENABLED",
      extra: {},
    },
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 15_000,
    checkedAt: "2026-08-13T18:00:00.000Z",
  };
  const evidence = applyGoogleAppLinkEvidence(
    verifyCanonicalBinding("google", context),
    context,
    { results: [link()] },
  );
  assertEquals(evidence.dimensions.binding.status, "proven");
  assertEquals(
    evidence.dimensions.binding.safe_id,
    "66CB20600C7FDA957E511684502DFFE3",
  );
  assertEquals(evidence.dimensions.funding.status, "action_required");
  assertEquals(evidence.reason_code, "funding_missing");
});

Deno.test("#2041 every non-enabled state and wrong link type fail closed", () => {
  const statuses = [
    "PENDING_APPROVAL",
    "REJECTED",
    "REMOVED",
    "REQUESTED",
    "REVOKED",
    "UNKNOWN",
    "UNSPECIFIED",
    undefined,
  ];
  for (const status of statuses) {
    assertEquals(
      parseGoogleAppLinks({
        results: [link({ accountLink: { status } })],
      }),
      [],
    );
  }
  assertEquals(
    parseGoogleAppLinks({
      results: [link({ accountLink: { type: "UNKNOWN" } })],
    }),
    [],
  );
});

Deno.test("#2041 malformed identities, wrong platform, and wrong app fail closed", () => {
  const invalidRows = [
    link({ thirdPartyAppAnalytics: { appAnalyticsProviderId: "" } }),
    link({ thirdPartyAppAnalytics: { appAnalyticsProviderId: "AppsFlyer" } }),
    link({ thirdPartyAppAnalytics: { appId: "" } }),
    link({ thirdPartyAppAnalytics: { appVendor: "UNKNOWN" } }),
    link({ thirdPartyAppAnalyticsLink: { resourceName: "" } }),
    link({ thirdPartyAppAnalyticsLink: { shareableLinkId: "" } }),
    link({ thirdPartyAppAnalyticsLink: { shareableLinkId: "not-hex" } }),
  ];
  for (const row of invalidRows) {
    assertEquals(parseGoogleAppLinks({ results: [row] }), []);
  }

  const wrongVendor = parseGoogleAppLinks({
    results: [
      link({ thirdPartyAppAnalytics: { appVendor: "APPLE_APP_STORE" } }),
    ],
  });
  assertEquals(
    findExactGoogleAppLink(wrongVendor, { target: TARGET, binding: BINDING }),
    undefined,
  );
  const wrongApp = parseGoogleAppLinks({
    results: [link({ thirdPartyAppAnalytics: { appId: "com.other.app" } })],
  });
  assertEquals(
    findExactGoogleAppLink(wrongApp, { target: TARGET, binding: BINDING }),
    undefined,
  );
});

Deno.test("#2041 Google remains confined to the exact allowlisted read-only search", async () => {
  let calls = 0;
  await runAllowedProviderOperation(
    "google",
    "app_bindings",
    "POST",
    "customers/{id}/googleAds:search",
    () => {
      calls += 1;
      return Promise.resolve({});
    },
  );
  await assertRejects(
    () =>
      runAllowedProviderOperation(
        "google",
        "app_bindings",
        "POST",
        "customers/{id}/googleAds:mutate",
        () => {
          calls += 100;
          return Promise.resolve({});
        },
      ),
    Error,
    "provider_operation_forbidden",
  );
  assertEquals(calls, 1);
});
