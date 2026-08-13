import { evidence } from "../adAppReadiness.ts";
import {
  metaCheckPageAdvertiseTaskForIdentity,
  metaFetchAccount,
  metaFetchIgBusinessAccountForIdentity,
  metaGraph,
  metaValidateOnlyCreativeProbeForIdentity,
  resolveMetaClient,
} from "../meta.ts";
import { evaluateMetaIdentityAuthority } from "../../admin-ad-app-identity-preflight/metaIdentityAuthority.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";

export interface MetaMobileAppSnapshot {
  id: string;
  platforms: string[];
  iosStoreId: string | null;
  androidPackage: string | null;
}
export function parseMetaMobileApp(
  payload: unknown,
): MetaMobileAppSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    platforms: Array.isArray(row.platforms)
      ? row.platforms.filter((x) => typeof x === "string").map(String)
      : [],
    iosStoreId: typeof row.ios_store_id === "string" ? row.ios_store_id : null,
    androidPackage: typeof row.android_package_name === "string"
      ? row.android_package_name
      : null,
  };
}
export function metaMobileAppMatches(
  snapshot: MetaMobileAppSnapshot | null,
  providerAppId: string | null,
  os: "ios" | "android",
  storeIdentifier: string,
): boolean {
  if (!snapshot || snapshot.id !== providerAppId) return false;
  if (os === "ios") {
    return snapshot.platforms.some((x) => x.toLowerCase() === "ios") &&
      snapshot.iosStoreId === storeIdentifier;
  }
  return snapshot.platforms.some((x) => x.toLowerCase() === "android") &&
    snapshot.androidPackage === storeIdentifier;
}
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("meta", ctx);
  if (!ctx.connection) return base;
  const client = resolveMetaClient(asAdConnectionRow(ctx.connection));
  const account = await runAllowedProviderOperation(
    "meta",
    "account",
    "GET",
    "ad_account",
    () => metaFetchAccount(client),
  );
  const payerMatches = account.id.replace(/^act_/, "") ===
    ctx.connection.external_account_id.replace(/^act_/, "");
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "Meta API returned the exact corporate ad account.",
      ctx.checkedAt,
      "provider_api",
      account.id,
    )
    : evidence(
      "blocked",
      "Meta returned a different ad account.",
      ctx.checkedAt,
      "provider_api",
    );
  base.dimensions.funding = account.hasPaymentMethod
    ? evidence(
      "proven",
      "Meta reports a current funding source.",
      ctx.checkedAt,
      "provider_api",
    )
    : evidence(
      "action_required",
      "Meta does not report a current funding source.",
      ctx.checkedAt,
      "provider_api",
    );
  const identity = ctx.identityRecord;
  const pageId = typeof identity?.meta_page_id === "string"
    ? identity.meta_page_id
    : null;
  const instagramUserId = typeof identity?.meta_instagram_user_id === "string"
    ? identity.meta_instagram_user_id
    : null;
  if (pageId && instagramUserId) {
    const authority = await evaluateMetaIdentityAuthority({
      pageId,
      instagramUserId,
    }, {
      checkPageAuthorization: (id) =>
        runAllowedProviderOperation(
          "meta",
          "page_authorization",
          "GET",
          "me/accounts",
          () => metaCheckPageAdvertiseTaskForIdentity(client, id),
        ),
      fetchPageLinkedInstagram: (id) =>
        runAllowedProviderOperation(
          "meta",
          "page_instagram",
          "GET",
          "page/instagram_business_account",
          () => metaFetchIgBusinessAccountForIdentity(client, id),
        ),
      validateExactIdentity: (exact) =>
        runAllowedProviderOperation(
          "meta",
          "exact_identity_validate_only",
          "POST",
          "ad_account/adcreatives:validate_only",
          () => metaValidateOnlyCreativeProbeForIdentity(client, exact),
        ),
    });
    base.dimensions.identity = authority.verdict === "ready"
      ? evidence(
        "proven",
        "Meta validated the exact Facebook Page and Instagram identity without creating an object.",
        ctx.checkedAt,
        "provider_api",
        instagramUserId,
      )
      : evidence(
        "blocked",
        "Meta could not validate the exact registered public identity.",
        ctx.checkedAt,
        "provider_api",
        instagramUserId,
      );
  } else {
    base.dimensions.identity = evidence(
      "blocked",
      "The exact Meta identity registry row is missing.",
      ctx.checkedAt,
    );
  }
  if (ctx.binding.provider_app_id) {
    const providerAppId = ctx.binding.provider_app_id;
    const mobileApp = await runAllowedProviderOperation(
      "meta",
      "mobile_app",
      "GET",
      "{app_id}",
      async () =>
        parseMetaMobileApp(
          await metaGraph(client, "GET", providerAppId, {
            fields: "id,name,platforms,ios_store_id,android_package_name",
          }),
        ),
    );
    if (base.dimensions.binding.status !== "proven") {
      base.dimensions.binding = metaMobileAppMatches(
          mobileApp,
          providerAppId,
          ctx.target.os,
          ctx.target.store_identifier,
        )
        ? evidence(
          "proven",
          "Meta returned the exact product app with the matching OS platform and store identity.",
          ctx.checkedAt,
          "provider_api",
          mobileApp?.id,
        )
        : evidence(
          "blocked",
          "Meta did not return the exact product app, OS platform, and store identity registered for this target.",
          ctx.checkedAt,
          "provider_api",
          ctx.binding.provider_app_id,
        );
    }
  }
  base.reason_code = !payerMatches
    ? "payer_mismatch"
    : base.dimensions.identity.status !== "proven"
    ? "public_identity_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : !account.hasPaymentMethod
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
