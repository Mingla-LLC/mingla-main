import { evidence } from "../adAppReadiness.ts";
import { googleFetchCustomer, resolveGoogleClient } from "../google.ts";
import type { VerifyContext } from "./common.ts";
import { asAdConnectionRow, verifyCanonicalBinding } from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("google", ctx);
  if (!ctx.connection) return base;
  const client = await resolveGoogleClient(asAdConnectionRow(ctx.connection));
  const customer = await googleFetchCustomer(client);
  const normalized = (value: string) => value.replace(/-/g, "");
  const payerMatches =
    normalized(customer.id) === normalized(ctx.connection.external_account_id);
  base.dimensions.payer =
    payerMatches && customer.status === "ENABLED" && !customer.testAccount
      ? evidence(
        "proven",
        "Google Ads returned the exact enabled production customer.",
        ctx.checkedAt,
        "provider_api",
        customer.id,
      )
      : evidence(
        "blocked",
        "Google Ads did not return the exact enabled production customer.",
        ctx.checkedAt,
        "provider_api",
      );
  base.dimensions.funding = evidence(
    "action_required",
    "Google billing is not exposed by this account-read response.",
    ctx.checkedAt,
    "provider_api",
  );
  base.reason_code = !payerMatches
    ? "payer_account_mismatch"
    : customer.status !== "ENABLED" || customer.testAccount
    ? "payer_inactive"
    : !ctx.binding.provider_app_id
    ? "native_binding_missing"
    : !ctx.binding.provider_measurement_id
    ? "measurement_missing"
    : "funding_missing";
  return base;
}
