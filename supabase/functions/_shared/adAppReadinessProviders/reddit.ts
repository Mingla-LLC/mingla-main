import { evidence } from "../adAppReadiness.ts";
import { redditConnectPreflight } from "../reddit.ts";
import type { VerifyContext } from "./common.ts";
import { asAdConnectionRow, verifyCanonicalBinding } from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("reddit", ctx);
  if (!ctx.connection) return base;
  const snapshot = await redditConnectPreflight(
    asAdConnectionRow(ctx.connection),
    "consumer",
  );
  const payerMatches =
    snapshot.account.id === ctx.connection.external_account_id;
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "Reddit API returned the exact corporate ad account.",
      ctx.checkedAt,
      "provider_api",
      snapshot.account.id,
    )
    : evidence(
      "blocked",
      "Reddit returned a different ad account.",
      ctx.checkedAt,
      "provider_api",
    );
  base.dimensions.funding = snapshot.fundingInstrumentId
    ? evidence(
      "proven",
      "Reddit reports a servable funding instrument.",
      ctx.checkedAt,
      "provider_api",
      snapshot.fundingInstrumentId,
    )
    : evidence(
      "action_required",
      "Reddit does not report a servable funding instrument.",
      ctx.checkedAt,
      "provider_api",
    );
  base.reason_code = !payerMatches
    ? "payer_account_mismatch"
    : !ctx.binding.provider_app_id
    ? "native_binding_missing"
    : !ctx.binding.provider_measurement_id
    ? "measurement_missing"
    : !snapshot.fundingInstrumentId
    ? "funding_missing"
    : "all_required_dimensions_proven";
  return base;
}
