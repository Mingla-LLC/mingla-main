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

/**
 * Compatibility-only campaign query retained for the append-only #2015
 * regression suite. Production readiness uses GOOGLE_APP_LINK_GAQL below:
 * campaign existence is neither required nor sufficient to prove an app link.
 */

export const GOOGLE_APP_LINK_GAQL =
  "SELECT third_party_app_analytics_link.resource_name, " +
  "third_party_app_analytics_link.shareable_link_id, account_link.status, " +
  "account_link.type, " +
  "account_link.third_party_app_analytics.app_analytics_provider_id, " +
  "account_link.third_party_app_analytics.app_id, " +
  "account_link.third_party_app_analytics.app_vendor " +
  "FROM third_party_app_analytics_link " +
  "WHERE account_link.type = 'THIRD_PARTY_APP_ANALYTICS' " +
  "AND account_link.status = 'ENABLED'";

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

export interface GoogleAppLink {
  resourceName: string;
  shareableLinkId: string;
  status: "ENABLED";
  type: "THIRD_PARTY_APP_ANALYTICS";
  appAnalyticsProviderId: string;
  appId: string;
  appVendor: "APPLE_APP_STORE" | "GOOGLE_APP_STORE";
}

function numericId(value: unknown): string | null {
  const normalized = typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : "";
  return /^[0-9]+$/.test(normalized) ? normalized : null;
}

export function parseGoogleAppLinks(payload: unknown): GoogleAppLink[] {
  const results =
    Array.isArray((payload as Record<string, unknown> | null)?.results)
      ? (payload as Record<string, unknown>).results as Record<
        string,
        unknown
      >[]
      : [];
  return results.flatMap((row) => {
    const accountLink = row.accountLink as Record<string, unknown> | undefined;
    const analyticsLink = row.thirdPartyAppAnalyticsLink as
      | Record<string, unknown>
      | undefined;
    const analytics = accountLink?.thirdPartyAppAnalytics as
      | Record<string, unknown>
      | undefined;
    const resourceName = analyticsLink?.resourceName;
    const shareableLinkId = numericId(analyticsLink?.shareableLinkId);
    const appAnalyticsProviderId = numericId(
      analytics?.appAnalyticsProviderId,
    );
    const appId = analytics?.appId;
    const appVendor = analytics?.appVendor;
    if (
      accountLink?.status !== "ENABLED" ||
      accountLink?.type !== "THIRD_PARTY_APP_ANALYTICS" ||
      typeof resourceName !== "string" || resourceName.length === 0 ||
      !shareableLinkId || !appAnalyticsProviderId ||
      typeof appId !== "string" || appId.length === 0 ||
      (appVendor !== "APPLE_APP_STORE" &&
        appVendor !== "GOOGLE_APP_STORE")
    ) return [];
    return [{
      resourceName,
      shareableLinkId,
      status: "ENABLED",
      type: "THIRD_PARTY_APP_ANALYTICS",
      appAnalyticsProviderId,
      appId,
      appVendor,
    }];
  });
}

export function findExactGoogleAppLink(
  links: GoogleAppLink[],
  ctx: Pick<VerifyContext, "target" | "binding">,
): GoogleAppLink | undefined {
  const expectedVendor = ctx.target.os === "ios"
    ? "APPLE_APP_STORE"
    : "GOOGLE_APP_STORE";
  return links.find((row) =>
    row.appId === ctx.target.store_identifier &&
    row.appId === ctx.binding.provider_app_id &&
    row.appVendor === expectedVendor &&
    row.shareableLinkId === ctx.binding.provider_measurement_id
  );
}

export function applyGoogleAppLinkEvidence(
  base: ReturnType<typeof verifyCanonicalBinding>,
  ctx: VerifyContext & { connection: NonNullable<VerifyContext["connection"]> },
  payload: unknown,
) {
  const exact = findExactGoogleAppLink(parseGoogleAppLinks(payload), ctx);
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
      "Google Ads returned the exact enabled third-party analytics link for this store app and platform.",
      ctx.checkedAt,
      "provider_api",
      exact.shareableLinkId,
    )
    : evidence(
      "action_required",
      "Google Ads returned no exact enabled third-party analytics link matching this store app, platform, and AppsFlyer Link ID.",
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
        { query: GOOGLE_APP_LINK_GAQL },
      ),
  );
  return applyGoogleAppLinkEvidence(base, {
    ...ctx,
    connection: ctx.connection,
  }, payload);
}
