import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { BindingRow, TargetRow } from "../adAppReadiness.ts";
import {
  applyGoogleAppLinkEvidence,
  findExactGoogleAppLink,
  parseGoogleAppLinks,
} from "../adAppReadinessProviders/google.ts";
import { verifyCanonicalBinding } from "../adAppReadinessProviders/common.ts";

type SupportedOs = "ios" | "android";

const FIXTURES: Record<
  SupportedOs,
  { appId: string; vendor: "APPLE_APP_STORE" | "GOOGLE_APP_STORE" }
> = {
  ios: { appId: "6768737367", vendor: "APPLE_APP_STORE" },
  android: {
    appId: "com.sethogieva.minglabusiness",
    vendor: "GOOGLE_APP_STORE",
  },
};

function target(os: SupportedOs): TargetRow {
  const fixture = FIXTURES[os];
  return {
    app_key: "business",
    os,
    display_name: "Mingla Host",
    store_identifier: fixture.appId,
    appsflyer_app_id: os === "ios" ? `id${fixture.appId}` : fixture.appId,
    onelink_url: "https://biz.usemingla.com/ZSCW",
    active: true,
  };
}

function binding(
  os: SupportedOs,
  linkId = "66CB20600C7FDA957E511684502DFFE3",
): BindingRow {
  return {
    app_key: "business",
    os,
    provider: "google",
    payer_connection_id: "payer",
    public_identity_required: false,
    provider_app_id: FIXTURES[os].appId,
    provider_measurement_id: linkId,
    active: true,
  };
}

function link(
  os: SupportedOs,
  overrides: {
    appId?: string;
    vendor?: "APPLE_APP_STORE" | "GOOGLE_APP_STORE";
    providerId?: string;
    shareableLinkId?: string;
    resourceName?: string;
  } = {},
) {
  const fixture = FIXTURES[os];
  return {
    accountLink: {
      status: "ENABLED",
      type: "THIRD_PARTY_APP_ANALYTICS",
      thirdPartyAppAnalytics: {
        appAnalyticsProviderId: overrides.providerId ?? "42",
        appId: overrides.appId ?? fixture.appId,
        appVendor: overrides.vendor ?? fixture.vendor,
      },
    },
    thirdPartyAppAnalyticsLink: {
      resourceName: overrides.resourceName ??
        "customers/3623860476/thirdPartyAppAnalyticsLinks/123",
      shareableLinkId: overrides.shareableLinkId ??
        "66CB20600C7FDA957E511684502DFFE3",
    },
  };
}

function context(os: SupportedOs, canonicalBinding = binding(os)) {
  return {
    target: target(os),
    binding: canonicalBinding,
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
    checkedAt: "2026-08-13T19:00:00.000Z",
  };
}

Deno.test("#2041 tester: hostile near-matches cannot shadow the exact iOS or Android link", () => {
  for (const os of ["ios", "android"] as const) {
    const oppositeVendor = os === "ios"
      ? "GOOGLE_APP_STORE"
      : "APPLE_APP_STORE";
    const payload = {
      results: [
        link(os, {
          shareableLinkId: "595D7630DCA3E05A82CEADA049AD832E",
        }),
        link(os, { appId: "com.attacker.near.match" }),
        link(os, { vendor: oppositeVendor }),
        link(os),
      ],
    };
    const parsed = parseGoogleAppLinks(payload);
    assertEquals(parsed.length, 4);
    const exact = findExactGoogleAppLink(parsed, {
      target: target(os),
      binding: binding(os),
    });
    assertEquals(
      exact?.shareableLinkId,
      "66CB20600C7FDA957E511684502DFFE3",
    );
    assertEquals(exact?.appVendor, FIXTURES[os].vendor);

    const ctx = context(os);
    const result = applyGoogleAppLinkEvidence(
      verifyCanonicalBinding("google", ctx),
      ctx,
      payload,
    );
    assertEquals(result.dimensions.binding.status, "proven");
    assertEquals(
      result.dimensions.binding.safe_id,
      "66CB20600C7FDA957E511684502DFFE3",
    );
    assertEquals(result.dimensions.funding.status, "action_required");
    assertEquals(result.reason_code, "funding_missing");
  }
});

Deno.test("#2041 tester: a plausible but non-canonical link stays non-ready and exposes only the store ID", () => {
  const ctx = context("android");
  const providerOnlyResource =
    "customers/3623860476/thirdPartyAppAnalyticsLinks/attacker";
  const result = applyGoogleAppLinkEvidence(
    verifyCanonicalBinding("google", ctx),
    ctx,
    {
      results: [
        link("android", {
          providerId: "777777",
          shareableLinkId: "595D7630DCA3E05A82CEADA049AD832E",
          resourceName: providerOnlyResource,
        }),
      ],
    },
  );

  assertEquals(result.dimensions.binding.status, "action_required");
  assertEquals(result.dimensions.binding.safe_id, FIXTURES.android.appId);
  assertEquals(result.dimensions.funding.status, "action_required");
  assertEquals(result.reason_code, "native_binding_missing");
  const safeEvidence = JSON.stringify(result);
  assertEquals(safeEvidence.includes(providerOnlyResource), false);
  assertEquals(safeEvidence.includes("777777"), false);
  assertEquals(
    safeEvidence.includes("595D7630DCA3E05A82CEADA049AD832E"),
    false,
  );
});

Deno.test("#2041 tester: invalid top-level provider shapes never fabricate a link", () => {
  for (
    const payload of [null, undefined, {}, [], { results: null }, {
      results: "not-an-array",
    }]
  ) {
    assertEquals(parseGoogleAppLinks(payload), []);
  }
});
