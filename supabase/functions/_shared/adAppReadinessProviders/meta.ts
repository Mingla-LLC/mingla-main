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
import { asAdConnectionRow, verifyCanonicalBinding } from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("meta", ctx);
  if (!ctx.connection) return base;
  const client = resolveMetaClient(asAdConnectionRow(ctx.connection));
  const account = await metaFetchAccount(client);
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
        metaCheckPageAdvertiseTaskForIdentity(client, id),
      fetchPageLinkedInstagram: (id) =>
        metaFetchIgBusinessAccountForIdentity(client, id),
      validateExactIdentity: (exact) =>
        metaValidateOnlyCreativeProbeForIdentity(client, exact),
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
    ? "payer_account_mismatch"
    : base.dimensions.identity.status !== "proven"
    ? "identity_not_verified"
    : !ctx.binding.provider_app_id
    ? "native_binding_missing"
    : !ctx.binding.provider_measurement_id
    ? "measurement_missing"
    : !account.hasPaymentMethod
    ? "funding_missing"
    : "all_required_dimensions_proven";
  return base;
}
