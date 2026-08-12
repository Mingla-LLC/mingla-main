import { evidence } from "../adAppReadiness.ts";
import { normalizeIdentityUsername } from "../adAppIdentityRegistry.ts";
import {
  resolveTikTokClient,
  tiktokFetchAdvertiser,
  tiktokFetchIdentities,
} from "../tiktok.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("tiktok", ctx);
  if (!ctx.connection) return base;
  const client = resolveTikTokClient(asAdConnectionRow(ctx.connection));
  const [advertiser, identities] = await Promise.all([
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
