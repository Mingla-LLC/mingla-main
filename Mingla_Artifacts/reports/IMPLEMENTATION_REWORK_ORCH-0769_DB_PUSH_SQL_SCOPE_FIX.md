# Implementation Rework: ORCH-0769 DB push SQL scope fix

**Date:** 2026-05-09
**Status:** implemented, partially verified
**Trigger:** Operator ran `supabase db push` for `20260515000009_orch_0769_app_wide_currency.sql` and Postgres rejected migration SQL during remote application.

## Failure 1: update target alias scope

Remote migration failed while applying the event currency backfill:

```text
ERROR: invalid reference to FROM-clause entry for table "e" (SQLSTATE 42P01)
There is an entry for table "e", but it cannot be referenced from this part of the query.
```

The failing shape was:

```sql
UPDATE public.events e
...
FROM public.brands b
LEFT JOIN ticket_currency ON ticket_currency.event_id = e.id
WHERE b.id = e.brand_id;
```

Postgres does not allow the `UPDATE` target alias `e` to be referenced inside that `JOIN ... ON` clause.

## Fix

Updated `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` to keep the same backfill behavior while moving the ticket-currency lookup into a correlated scalar subquery in the `SET` expression:

```sql
COALESCE(
  (
    SELECT tc.currency
    FROM ticket_currency tc
    WHERE tc.event_id = e.id
  ),
  b.default_currency::text,
  'GBP'
)
```

This preserves the intended precedence:

1. Existing single active ticket currency for the event.
2. Brand default currency.
3. GBP fallback.

## Verification

- Searched the migration for remaining target-alias-in-join patterns.
- `git diff --check -- supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` passed.

## Not Verified

- I did not rerun `supabase db push`; the operator owns DB push.
- Edge function deploys remain blocked until the migration applies successfully.

## Next Operator Action

Rerun:

```bash
supabase db push
```

If that succeeds, proceed with the previously documented edge deploy sequence for ORCH-0769.

## Failure 2: view column order extension

The next operator retry passed the earlier update block, then failed at `CREATE OR REPLACE VIEW public.business_management_events_view`:

```text
ERROR: cannot change name of view column "visibility" to "currency" (SQLSTATE 42P16)
```

Root cause: Postgres `CREATE OR REPLACE VIEW` cannot insert a new column into the middle of an existing view column list. The ORCH-0769 migration inserted `e.currency` before existing `visibility`; Postgres interpreted that as trying to rename the old `visibility` column to `currency`.

Patch applied:

- Moved `e.currency` to the end of `business_management_events_view`, after existing `management_theme`.
- Moved `e.currency` to the end of `business_public_events_view`, after existing `public_theme`.

This keeps all pre-existing view column names and positions stable while appending the new currency field.

Updated verification:

- Prior migrations confirm `management_theme` and `public_theme` were the last columns before ORCH-0769.
- `git diff --check -- supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` passes.

Updated next operator action:

```bash
supabase db push
```
