function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sql = await Deno.readTextFile(
  new URL("../20270110000004_issue_1175_paystack_refunds.sql", import.meta.url),
);

Deno.test("issue #1175 migration: refund attempt identity and service-role boundary are enforced", () => {
  assert(
    sql.includes("CREATE TABLE public.paystack_refund_attempts"),
    "refund attempt ledger missing",
  );
  assert(
    sql.includes("idempotency_key text NOT NULL UNIQUE"),
    "refund attempt idempotency is not database-enforced",
  );
  assert(
    sql.includes(
      "REVOKE ALL ON public.paystack_refund_attempts FROM PUBLIC, anon, authenticated",
    ),
    "refund attempts are exposed to clients",
  );
  assert(
    sql.includes("TO service_role"),
    "service-role grant missing",
  );
});

Deno.test("issue #1175 migration: only processed refunds create permanent debt", () => {
  assert(
    sql.includes("IF p_status<>'processed' THEN"),
    "accepted/failed refunds can create debt before provider completion",
  );
  assert(
    sql.includes("'post_release_refund'"),
    "post-release refund adjustment/debt kind missing",
  );
  assert(
    sql.includes("public.convert_postponement_debt_to_permanent"),
    "temporary postponement debt is not converted",
  );
  assert(
    sql.includes("v_target_liability>v_debt.principal_cents"),
    "later partial refunds cannot extend the permanent debt exactly once",
  );
  assert(
    sql.includes("amount_cents>converted_cents"),
    "converted withholding applications are not protected from reuse",
  );
  assert(
    sql.includes("payout_debt_applications_direct_once_idx") &&
      sql.includes("WHERE idempotency_key LIKE 'debt-apply:%'"),
    "direct debt applications lost their one-per-release guard",
  );
});

Deno.test("issue #1175 migration: pre-release refunds never fabricate brand debt", () => {
  assert(
    sql.includes("AND r.status='released'"),
    "debt lookup is not restricted to already released money",
  );
  assert(
    sql.includes(
      "least(p_amount_cents,v_release.organiser_cash_delivered_cents)",
    ),
    "debt is not bounded by organiser cash actually delivered",
  );
  assert(
    sql.includes("ON CONFLICT(idempotency_key) DO NOTHING"),
    "adjustment replay is not idempotent",
  );
});
