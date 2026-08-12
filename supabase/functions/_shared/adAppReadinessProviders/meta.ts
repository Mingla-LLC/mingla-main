import { evidence } from "../adAppReadiness.ts";
import {
  metaCheckPageAdvertiseTaskForIdentity,
  metaFetchAccount,
  metaFetchIgBusinessAccountForIdentity,
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
