import { evidence } from "../adAppReadiness.ts";
import { googleAdsRequest, resolveGoogleClient } from "../google.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";

export const GOOGLE_APP_BINDING_GAQL =
  "SELECT campaign.id, campaign.status, campaign.app_campaign_setting.app_id, " +
  "campaign.app_campaign_setting.app_store FROM campaign " +
  "WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL' " +
  "AND campaign.status != 'REMOVED' " +
  "AND campaign.app_campaign_setting.app_id IS NOT NULL";

export interface GoogleAppBinding {
  appId: string;
  appStore: "APPLE_APP_STORE" | "GOOGLE_APP_STORE" | null;
  campaignId: string | null;
}

export function parseGoogleAppBindings(payload: unknown): GoogleAppBinding[] {
  const results =
    Array.isArray((payload as Record<string, unknown> | null)?.results)
      ? (payload as Record<string, unknown>).results as Record<
        string,
        unknown
      >[]
      : [];
  return results.flatMap((row) => {
    const campaign = row.campaign as Record<string, unknown> | undefined;
    const status = campaign?.status;
    if (
      status !== undefined && status !== "ENABLED" && status !== "PAUSED"
    ) return [];
    const setting = campaign?.appCampaignSetting as
      | Record<string, unknown>
      | undefined;
    const appId = setting?.appId;
    if (typeof appId !== "string" || appId.length === 0) return [];
    const rawStore = setting?.appStore;
    return [{
      appId,
      appStore:
        rawStore === "APPLE_APP_STORE" || rawStore === "GOOGLE_APP_STORE"
          ? rawStore
          : null,
      campaignId:
        typeof campaign?.id === "string" || typeof campaign?.id === "number"
          ? String(campaign.id)
          : null,
    }];
  });
}

export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("google", ctx);
  if (!ctx.connection) return base;
  const client = await resolveGoogleClient(asAdConnectionRow(ctx.connection));
  const { payload } = await runAllowedProviderOperation(
    "google",
    "app_bindings",
    "POST",
    "customers/{id}/googleAds:search",
    () =>
      googleAdsRequest(
        client,
        `customers/${client.customerId}/googleAds:search`,
        { query: GOOGLE_APP_BINDING_GAQL },
      ),
  );
  const expectedStore = ctx.target.os === "ios"
    ? "APPLE_APP_STORE"
    : "GOOGLE_APP_STORE";
  const exact = parseGoogleAppBindings(payload).find((row) =>
    row.appId === ctx.target.store_identifier && row.appStore === expectedStore
  );
  base.dimensions.payer = evidence(
    "proven",
    "Google Ads accepted a read-only query for the exact corporate customer.",
    ctx.checkedAt,
    "provider_api",
    ctx.connection.external_account_id,
  );
  base.dimensions.binding = exact
    ? evidence(
      "proven",
      "Google Ads returned the exact store app and platform from an existing app-campaign binding.",
      ctx.checkedAt,
      "provider_api",
      exact.appId,
    )
    : evidence(
      "action_required",
      "Google Ads returned no existing app-campaign binding for this exact store app and platform; a Google Ads Link ID is still required in AppsFlyer.",
      ctx.checkedAt,
      "provider_api",
      ctx.target.store_identifier,
    );
  base.dimensions.funding = evidence(
    "action_required",
    "Google Ads does not expose a truthful current funding signal through this read-only app-binding query.",
    ctx.checkedAt,
    "provider_api",
  );
  base.reason_code = exact ? "funding_missing" : "native_binding_missing";
  return base;
}
