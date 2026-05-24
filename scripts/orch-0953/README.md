# ORCH-0953 Connect Inventory Reconciliation

Operator-owned read-only probe for Phase E before the first live sale.

1. In Stripe Dashboard live mode, export or copy the live connected-account IDs.
2. In Supabase SQL editor using service role context, create and populate:

```sql
CREATE TEMP TABLE _live_stripe_accounts(stripe_account_id text PRIMARY KEY);
INSERT INTO _live_stripe_accounts(stripe_account_id)
VALUES ('acct_live_example');
```

3. Run `scripts/orch-0953/connect_inventory_reconciliation.sql`.
4. PASS means all three result sets return zero rows. Record the three counts in
   `Mingla_Artifacts/reports/EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md`.

Do not run this before live Dashboard activation, and do not mutate any Mingla
tables from this probe.
