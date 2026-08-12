import { evidence } from "../adAppReadiness.ts";
import { redditConnectPreflight } from "../reddit.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("reddit", ctx);
  if (!ctx.connection) return base;
  const connection = ctx.connection;
  const snapshot = await runAllowedProviderOperation(
    "reddit",
    "preflight",
    "GET",
    "read_only_preflight",
    () => redditConnectPreflight(asAdConnectionRow(connection), "consumer"),
  );
  const payerMatches = snapshot.account.id === connection.external_account_id;
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
    ? "payer_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : !snapshot.fundingInstrumentId
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
