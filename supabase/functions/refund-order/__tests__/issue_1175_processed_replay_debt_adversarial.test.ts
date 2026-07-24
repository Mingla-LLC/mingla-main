function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const functionsRoot = new URL("../../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270110000004_issue_1175_paystack_refunds.sql",
    import.meta.url,
  ),
);

Deno.test("issue #1175 adversarial: synchronous processed replays cannot be downgraded to accepted", async () => {
  const handlers = [
    "refund-order/index.ts",
    "admin-refund-order/index.ts",
    "cancel-trip-booking/index.ts",
    "venue-reservation-cancel/index.ts",
  ];

  for (const path of handlers) {
    const source = await Deno.readTextFile(new URL(path, functionsRoot));
    assert(
      !source.includes('p_status: "accepted"'),
      `${path} hard-codes accepted and discards a reconciled processed status`,
    );
  }

  assert(
    migration.includes("IF p_status<>'processed' THEN"),
    "the debt RPC no longer proves why a processed replay must stay processed",
  );
});

Deno.test("issue #1175 adversarial: venue refund debt uses the checkout-session ledger identity", async () => {
  const ledgerMigration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
      import.meta.url,
    ),
  );
  const venueHandler = await Deno.readTextFile(
    new URL("venue-reservation-cancel/index.ts", functionsRoot),
  );
  const webhookRouter = await Deno.readTextFile(
    new URL("_shared/paystackRefundRouter.ts", functionsRoot),
  );

  assert(
    ledgerMigration.includes(
      "SELECT 'venue_reservation',s.id,b.payment_provider",
    ),
    "the test no longer reflects the ledger's checkout-session source identity",
  );
  assert(
    !venueHandler.includes("p_source_id: reservation.id"),
    "venue cancellation records the reservation id, but the payout ledger keys the checkout-session id",
  );
  assert(
    webhookRouter.includes('from("reservation_checkout_sessions")'),
    "the webhook path does not translate a reservation marker to its checkout-session ledger identity",
  );
});
