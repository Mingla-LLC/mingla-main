import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parseGoogleAppLinks } from "../adAppReadinessProviders/google.ts";

function link(
  shareableLinkId: unknown,
  appAnalyticsProviderId: unknown = "42",
) {
  return {
    accountLink: {
      status: "ENABLED",
      type: "THIRD_PARTY_APP_ANALYTICS",
      thirdPartyAppAnalytics: {
        appAnalyticsProviderId,
        appId: "com.sethogieva.minglabusiness",
        appVendor: "GOOGLE_APP_STORE",
      },
    },
    thirdPartyAppAnalyticsLink: {
      resourceName:
        "customers/3623860476/thirdPartyAppAnalyticsLinks/sanitized",
      shareableLinkId,
    },
  };
}

Deno.test("#2041 rework: a real-format 32-character hexadecimal Google Link ID is accepted exactly", () => {
  const linkId = "66CB20600C7FDA957E511684502DFFE3";
  const parsed = parseGoogleAppLinks({ results: [link(linkId)] });

  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].shareableLinkId, linkId);
  assertEquals(parsed[0].appAnalyticsProviderId, "42");
});

Deno.test("#2041 rework: malformed Link IDs fail closed while the analytics-provider ID remains numeric-only", () => {
  const invalidLinkIds: unknown[] = [
    "66CB20600C7FDA957E511684502DFFE",
    "66CB20600C7FDA957E511684502DFFE30",
    "66CB20600C7FDA957E511684502DFFEG",
    "66CB2060-0C7F-DA95-7E51-1684502DFFE3",
    "",
    null,
    66,
  ];
  for (const linkId of invalidLinkIds) {
    assertEquals(parseGoogleAppLinks({ results: [link(linkId)] }), []);
  }

  for (const providerId of ["AppsFlyer", "42A", "", null, 4.2]) {
    assertEquals(
      parseGoogleAppLinks({
        results: [
          link("66CB20600C7FDA957E511684502DFFE3", providerId),
        ],
      }),
      [],
    );
  }
});
