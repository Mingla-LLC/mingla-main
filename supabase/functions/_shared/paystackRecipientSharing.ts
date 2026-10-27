/**
 * paystackRecipientSharing — the single owner of "is it safe to delete this
 * transfer recipient at Paystack?".
 *
 * Issue #3192. Paystack de-duplicates transfer recipients per integration:
 * creating one for a bank account that already exists returns the EXISTING
 * `recipient_code` with a success status, and nothing in the response marks it
 * as a de-duplicated hit. Proven against our own test integration on
 * 2026-09-11 — two creates on account `0000000000`/bank `057` under different
 * names both returned `RCP_zrf3vmf1kjg3q15`.
 *
 * Consequence: a `recipient_code` this code path is holding is not necessarily
 * "ours". Deleting it destroys the payout destination of every other holder,
 * whose database rows still reference the now-dead code — their payouts then
 * fail with nothing to explain why. That is exactly what happened in
 * production on 2026-09-11.
 *
 * CROSS-TABLE BY CONSTRUCTION. Brands (`brand_paystack_recipients`), Growth
 * Partners (`partner_paystack_accounts`) and referral payees
 * (`payee_accounts`) are different tables but share ONE Paystack integration,
 * so de-duplication crosses between them. A check that consulted only the
 * caller's own table would still delete another holder's recipient. All three
 * tables are always consulted.
 */

/** Identifies the row that is asking, so it can be excluded from the check. */
export type RecipientHolder =
  | { kind: "brand"; brandId: string }
  | { kind: "partner"; accountId: string }
  | { kind: "payee"; userId: string };

/**
 * Minimal client surface. `from` is intentionally loose: supabase-js query
 * builders are deeply-generic thenables (not Promises), and describing them
 * structurally makes the compiler give up with
 * "TS2589: Type instantiation is excessively deep". The runtime contract is
 * exercised by the tests in `__tests__/issue_3192_recipient_sharing.*.test.ts`,
 * which drive this function through fakes rather than the real client.
 */
export type PaystackRecipientClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

function hasRows(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

/**
 * True when `recipientCode` is referenced by any holder other than `holder`.
 *
 * Throws if either lookup errors. Callers MUST treat a throw as "unsafe to
 * delete" and skip the delete — never as "safe". Leaking a stray provider
 * object is always cheaper than breaking a live payout destination.
 */
export async function isPaystackRecipientShared(
  client: PaystackRecipientClient,
  recipientCode: string,
  holder: RecipientHolder,
): Promise<boolean> {
  // Brand side.
  const brandQuery = client
    .from("brand_paystack_recipients")
    .select("brand_id")
    .eq("recipient_code", recipientCode);
  const brandResult = holder.kind === "brand"
    ? await brandQuery.neq("brand_id", holder.brandId).limit(1)
    : await brandQuery.limit(1);
  if (brandResult.error) throw brandResult.error;
  if (hasRows(brandResult.data)) return true;

  // Partner side.
  const partnerQuery = client
    .from("partner_paystack_accounts")
    .select("account_id")
    .eq("recipient_code", recipientCode);
  const partnerResult = holder.kind === "partner"
    ? await partnerQuery.neq("account_id", holder.accountId).limit(1)
    : await partnerQuery.limit(1);
  if (partnerResult.error) throw partnerResult.error;
  if (hasRows(partnerResult.data)) return true;

  // #3872 R2 referral payees share the same Paystack integration too. A
  // de-duplicated code must remain live until brand, partner and payee holders
  // have all released it.
  const payeeQuery = client
    .from("payee_accounts")
    .select("user_id")
    .eq("paystack_recipient_code", recipientCode);
  const payeeResult = holder.kind === "payee"
    ? await payeeQuery.neq("user_id", holder.userId).limit(1)
    : await payeeQuery.limit(1);
  if (payeeResult.error) throw payeeResult.error;
  return hasRows(payeeResult.data);
}
