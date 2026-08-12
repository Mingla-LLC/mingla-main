import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdAppProviderIdentityRow,
  type DiscoveredTikTokIdentity,
  parseAdvertisingApp,
  parseProviderIdentity,
  resolvePayerConnection,
  selectExactTikTokIdentity,
} from "../adAppIdentityRegistry.ts";

const EXPLORER_ID = "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5";
const BUSINESS_ID = "5ee9bdcb-7520-554d-8452-b32e2f9f43ea";

function tiktokRow(
  appKey: "explorer" | "business",
): AdAppProviderIdentityRow {
  const business = appKey === "business";
  return {
    id: business ? "business-row" : "explorer-row",
    app_key: appKey,
    provider: "tiktok",
    payer_lane: "consumer",
    expected_username: business ? "minglahost" : "usemingla",
    meta_page_id: null,
    meta_instagram_user_id: null,
    tiktok_identity_id: business ? BUSINESS_ID : EXPLORER_ID,
    tiktok_identity_type: business ? "BC_AUTH_TT" : "TT_USER",
    active: true,
  };
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [Array.from(values)];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map( (
      remainder,
    ) => [value, ...remainder])
  );
}

Deno.test("#1928 tester guard: every provider-list permutation selects the exact app identity, never an attractive decoy", () => {
  const inventory: DiscoveredTikTokIdentity[] = [
    {
      identityId: "available-decoy-first",
      identityType: "TT_USER",
      username: "usemingla",
      displayName: "plausible Explorer decoy",
      availableStatus: "AVAILABLE",
    },
    {
      identityId: BUSINESS_ID,
      identityType: "BC_AUTH_TT",
      username: "@MinglaHost",
      displayName: "Host with Mingla",
      availableStatus: "AVAILABLE",
    },
    {
      identityId: EXPLORER_ID,
      identityType: "TT_USER",
      username: "@UseMingla",
      displayName: "Mingla",
      availableStatus: "AVAILABLE",
    },
  ];

  for (const appKey of ["explorer", "business"] as const) {
    const parsed = parseProviderIdentity([tiktokRow(appKey)], appKey, "tiktok");
    assert(parsed.identity?.provider === "tiktok");
    for (const candidateOrder of permutations(inventory)) {
      const selected = selectExactTikTokIdentity(candidateOrder, parsed.identity);
      assertEquals(selected.reason, null);
      assertEquals(selected.identity?.identityId, parsed.identity.tiktok_identity_id);
      assertEquals(selected.identity?.identityType, parsed.identity.tiktok_identity_type);
    }
  }
});

Deno.test("#1928 tester guard: exact ID is insufficient when type, status, or supplied username is wrong", () => {
  const parsed = parseProviderIdentity([tiktokRow("business")], "business", "tiktok");
  assert(parsed.identity?.provider === "tiktok");
  const exact: DiscoveredTikTokIdentity = {
    identityId: BUSINESS_ID,
    identityType: "BC_AUTH_TT",
    username: "minglahost",
    displayName: null,
    availableStatus: "AVAILABLE",
  };

  assertEquals(
    selectExactTikTokIdentity([{ ...exact, identityType: "TT_USER" }], parsed.identity).reason,
    "identity_type_mismatch",
  );
  assertEquals(
    selectExactTikTokIdentity([{ ...exact, availableStatus: "ACTIVE" }], parsed.identity).reason,
    "identity_unavailable",
  );
  assertEquals(
    selectExactTikTokIdentity([{ ...exact, username: "usemingla" }], parsed.identity).reason,
    "identity_username_mismatch",
  );
  assertEquals(
    selectExactTikTokIdentity([{ ...exact, username: null }], parsed.identity).reason,
    null,
  );
});

Deno.test("#1928 tester guard: duplicate/missing/inactive/malformed registry and payer rows fail closed", () => {
  const explorer = tiktokRow("explorer");
  assertEquals(parseAdvertisingApp([], "explorer").reason, "app_registry_missing");
  assertEquals(
    parseAdvertisingApp([
      { app_key: "explorer", display_name: "Mingla Explorer", active: true },
      { app_key: "explorer", display_name: "duplicate", active: true },
    ], "explorer").reason,
    "app_registry_missing",
  );
  assertEquals(
    parseProviderIdentity([explorer, { ...explorer, id: "duplicate" }], "explorer", "tiktok").reason,
    "identity_registry_missing",
  );
  assertEquals(
    parseProviderIdentity([{ ...explorer, active: false }], "explorer", "tiktok").reason,
    "identity_registry_inactive",
  );
  assertEquals(
    parseProviderIdentity([{ ...explorer, expected_username: "@UseMingla" }], "explorer", "tiktok").reason,
    "identity_registry_invalid",
  );

  const parsed = parseProviderIdentity([explorer], "explorer", "tiktok");
  assert(parsed.identity?.provider === "tiktok");
  const payer = {
    id: "payer-1",
    platform: "tiktok",
    lane: "consumer",
    external_account_id: "7627974536397766673",
    status: "connected",
    connected: true,
  };
  assertEquals(resolvePayerConnection([], parsed.identity).reason, "payer_connection_missing");
  assertEquals(
    resolvePayerConnection([payer, { ...payer, id: "payer-2" }], parsed.identity).reason,
    "payer_connection_missing",
  );
  assertEquals(
    resolvePayerConnection([{ ...payer, status: "invalid" }], parsed.identity).reason,
    "payer_connection_inactive",
  );
  assertEquals(
    resolvePayerConnection([{ ...payer, lane: "business" }], parsed.identity).reason,
    "payer_connection_missing",
  );
});
