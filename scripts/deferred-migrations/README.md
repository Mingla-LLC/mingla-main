# Deferred Migrations

Migrations in this folder are **intentionally outside the `supabase/migrations/` apply
path**. They are scheduled to be introduced at a future date.

## 20260502000001_orch_0640_final_archive_drop.sql

**Schedule:** 2026-05-02 (7 days post-cutover; cutover applied 2026-04-23 evening).
**What it does:** Drops `_archive_card_pool` and `_archive_card_pool_stops` — the rollback
safety archive created by migration `20260425000010`.
**Why deferred:** The migration file's own header comment specifies a 7-day soak period
after cutover with no rollback signal. The safety net must remain intact through that
window so any unforeseen post-cutover bug can be rolled back by un-archiving.

### Restore procedure (on or after 2026-05-02)

1. Confirm no open post-cutover bug reports tied to ORCH-0640 requiring rollback.
2. Confirm tester verification PASSED with the `TESTER_ORCH-0640_DEMOLITION_AND_REBUILD`
   prompt and no blocking failures remain.
3. Move the file back:
   ```bash
   mv scripts/deferred-migrations/20260502000001_orch_0640_final_archive_drop.sql \
      supabase/migrations/
   ```
4. Apply:
   ```bash
   cd supabase && supabase db push
   ```
5. If the DROP hits a lock timeout (cron holding reader lock on the archive), the
   migration may need `SET LOCAL statement_timeout = 0;` + `SET LOCAL lock_timeout = 0;`
   at the top, same pattern as `20260425000003_orch_0640_rebuild_admin_place_pool_mv.sql`.

### Emergency rollback during the 7-day soak

If a critical post-cutover bug surfaces and the fix path requires the archived tables:

- Rename the archives back to live names:
  ```sql
  ALTER TABLE public._archive_card_pool RENAME TO card_pool;
  ALTER TABLE public._archive_card_pool_stops RENAME TO card_pool_stops;
  ```
- Revert the mobile + admin OTAs to a pre-ORCH-0640 commit.
- Consider reverting migrations 20260425000010..000014 via a down migration.

This is destructive-reverse territory. Contact the orchestrator before attempting.
