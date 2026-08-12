import { evidence } from "../adAppReadiness.ts";
import {
  resolveSnapchatClient,
  snapchatFetchAdAccount,
  snapchatFetchFundingSources,
} from "../snapchat.ts";
import type { VerifyContext } from "./common.ts";
import {
  asAdConnectionRow,
  runAllowedProviderOperation,
  verifyCanonicalBinding,
} from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("snapchat", ctx);
  if (!ctx.connection) return base;
  const client = await resolveSnapchatClient(asAdConnectionRow(ctx.connection));
  const account = await runAllowedProviderOperation(
    "snapchat",
    "account",
    "GET",
    "adaccounts/{id}",
    () => snapchatFetchAdAccount(client),
  );
  const payerMatches = account.id === ctx.connection.external_account_id;
  base.dimensions.payer = payerMatches
    ? evidence(
      "proven",
      "Snap API returned the exact corporate ad account.",
      ctx.checkedAt,
      "provider_api",
      account.id,
    )
    : evidence(
      "blocked",
      "Snap returned a different ad account.",
      ctx.checkedAt,
      "provider_api",
    );
  const organizationId = account.organizationId ?? client.organizationId;
  const funding = organizationId
    ? await runAllowedProviderOperation(
      "snapchat",
      "funding",
      "GET",
      "organizations/{id}/fundingsources",
      () => snapchatFetchFundingSources(client, organizationId),
    )
    : [];
  const activeFunding = funding.find((row) => row.status === "ACTIVE");
  base.dimensions.funding = activeFunding
    ? evidence(
      "proven",
      "Snap reports an active funding source.",
      ctx.checkedAt,
      "provider_api",
      activeFunding.id,
    )
    : evidence(
      "action_required",
      "Snap does not report an active funding source.",
      ctx.checkedAt,
      "provider_api",
    );
  base.reason_code = !payerMatches
    ? "payer_mismatch"
    : base.dimensions.binding.status !== "proven"
    ? "native_binding_missing"
    : !activeFunding
    ? "funding_missing"
    : "measurement_missing";
  return base;
}
