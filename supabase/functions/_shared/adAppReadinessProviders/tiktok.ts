import { evidence } from "../adAppReadiness.ts";
import { normalizeIdentityUsername } from "../adAppIdentityRegistry.ts";
import {
  resolveTikTokClient,
  tiktokApi,
  tiktokFetchAdvertiser,
  tiktokFetchIdentities,
} from "../tiktok.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";

export interface TikTokAppSnapshot {
  appId: string;
  tiktokAppId: string | null;
  platform: "ios" | "android" | null;
  storeIdentifier: string | null;
  measurementPartner: string | null;
}

export function parseTikTokApps(payload: unknown): TikTokAppSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list = Array.isArray(root.list)
    ? root.list
    : Array.isArray(root.apps)
    ? root.apps
    : root.app_id !== undefined
    ? [root]
    : [];
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const id = row.app_id;
    if (typeof id !== "string" && typeof id !== "number") return [];
    const rawPlatform = String(row.platform ?? row.app_type ?? "")
      .toLowerCase();
    const platform = rawPlatform.includes("ios")
      ? "ios" as const
      : rawPlatform.includes("android")
      ? "android" as const
      : null;
    const store = [
      row.store_id,
      row.app_store_id,
      row.package_name,
      row.bundle_id,
    ]
      .find((value) => typeof value === "string");
    const partner = [row.measurement_partner, row.mmp, row.tracking_type]
      .find((value) => typeof value === "string");
    const tiktokId = row.tiktok_app_id ?? row.tiktok_appid;
    return [{
      appId: String(id),
      tiktokAppId: typeof tiktokId === "string" || typeof tiktokId === "number"
        ? String(tiktokId)
        : null,
      platform,
      storeIdentifier: typeof store === "string" ? store : null,
      measurementPartner: typeof partner === "string"
        ? partner.toUpperCase()
        : null,
    }];
  });
}

export function findExactTikTokApp(
  apps: TikTokAppSnapshot[],
  providerAppId: string | null,
  providerMeasurementId: string | null,
  os: "ios" | "android",
  storeIdentifier: string,
) {
  return apps.find((app) =>
    app.appId === providerAppId &&
    app.tiktokAppId === providerMeasurementId && app.platform === os &&
    app.storeIdentifier === storeIdentifier &&
    (app.measurementPartner === "APPSFLYER" ||
      app.measurementPartner === "APPS FLYER")
  );
}
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("tiktok", ctx);
  if (!ctx.connection) return base;
  const client = resolveTikTokClient(asAdConnectionRow(ctx.connection));
  const [advertiser, identities, appList] = await Promise.all([
    runAllowedProviderOperation(
      "tiktok",
      "advertiser",
      "GET",
      "advertiser/info/",
      () => tiktokFetchAdvertiser(client),
    ),
    runAllowedProviderOperation(
      "tiktok",
      "identities",
      "GET",
      "identity/get/",
      () => tiktokFetchIdentities(client),
    ),
    runAllowedProviderOperation(
      "tiktok",
      "app_list",
      "GET",
      "app/list/",
      async () =>
        parseTikTokApps(
          await tiktokApi(client, "GET", "app/list/", {
            advertiser_id: client.advertiserId,
          }),
        ),
    ),
  ]);
  const payerMatches =
    advertiser.advertiserId === ctx.connection.external_account_id;
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "TikTok API returned the exact corporate advertiser.",
      ctx.checkedAt,
      "provider_api",
      advertiser.advertiserId,
    )
    : evidence(
      "blocked",
      "TikTok returned a different advertiser.",
      ctx.checkedAt,
      "provider_api",
    );
  const expected = ctx.identityRecord;
  const identityId = typeof expected?.tiktok_identity_id === "string"
    ? expected.tiktok_identity_id
    : null;
  const identityType = typeof expected?.tiktok_identity_type === "string"
    ? expected.tiktok_identity_type
    : null;
  const expectedUsername = normalizeIdentityUsername(
    expected?.expected_username,
  );
  const exact = identities.find((row) =>
    row.identityId === identityId && row.identityType === identityType
  );
  const identityReady = Boolean(
    exact && exact.availableStatus === "AVAILABLE" &&
      (normalizeIdentityUsername(exact.username) === null ||
        normalizeIdentityUsername(exact.username) === expectedUsername),
  );
  base.dimensions.identity = identityReady
    ? evidence(
      "proven",
      "TikTok returned the exact available public identity.",
      ctx.checkedAt,
      "provider_api",
      identityId ?? undefined,
    )
    : evidence(
      "blocked",
      "TikTok did not return the exact available public identity.",
      ctx.checkedAt,
      "provider_api",
      identityId ?? undefined,
    );
  // TikTok's advertiser balance is blind to Advanced Payment portfolios. A
  // positive balance is proof; every other value stays action-required.
  base.dimensions.funding =
    advertiser.balance !== null && advertiser.balance > 0
      ? evidence(
        "proven",
        "TikTok reports a positive advertiser balance.",
        ctx.checkedAt,
        "provider_api",
      )
      : evidence(
        "action_required",
        "TikTok funding is not proven by the advertiser API response.",
        ctx.checkedAt,
        "provider_api",
      );
  const listed = appList.find((app) =>
    app.appId === ctx.binding.provider_app_id
  );
  let exactApp = findExactTikTokApp(
    appList,
    ctx.binding.provider_app_id,
    ctx.binding.provider_measurement_id,
    ctx.target.os,
    ctx.target.store_identifier,
  );
  if (listed && !exactApp) {
    const detail = await runAllowedProviderOperation(
      "tiktok",
      "app_info",
      "GET",
      "app/info/",
      async () =>
        parseTikTokApps(
          await tiktokApi(client, "GET", "app/info/", {
            advertiser_id: client.advertiserId,
            app_id: listed.appId,
          }),
        ),
    );
    exactApp = findExactTikTokApp(
      detail,
      ctx.binding.provider_app_id,
      ctx.binding.provider_measurement_id,
      ctx.target.os,
      ctx.target.store_identifier,
    );
  }
  if (base.dimensions.binding.status !== "proven") {
    base.dimensions.binding = exactApp
      ? evidence(
        "proven",
        "TikTok returned the exact per-platform app, store identity, TikTok App ID, and AppsFlyer partner.",
        ctx.checkedAt,
        "provider_api",
        exactApp.appId,
      )
      : evidence(
        ctx.binding.provider_app_id ? "blocked" : "action_required",
        ctx.binding.provider_app_id
          ? "TikTok did not return the exact registered app, OS, store identity, TikTok App ID, and AppsFlyer partner."
          : "No exact TikTok app is registered for this target.",
        ctx.checkedAt,
        "provider_api",
        ctx.binding.provider_app_id ?? undefined,
      );
  }
  base.reason_code = !payerMatches
    ? "payer_mismatch"
    : !identityReady
    ? "public_identity_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : base.dimensions.funding.status !== "proven"
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
