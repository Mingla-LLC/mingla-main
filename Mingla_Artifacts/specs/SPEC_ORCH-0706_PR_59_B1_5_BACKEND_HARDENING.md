# SPEC — ORCH-0706 (PR #59 B1.5 backend hardening)

**Mode:** SPEC (forensics complete — see [reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md](../reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md))
**Severity:** S1 — "must address before any production write" per reviewer
**Surface:** Supabase backend (single new migration)
**Estimated wall:** IMPL ~1–1.5h SQL · TESTER ~30min RLS+trigger live-fire
**Source PR head:** `836ce108054800aba1573d8bc30684f5728a86ce` (`Mingla-LLC/mingla-main` PR #59 — verified line-by-line against the live migration source)
**Dispatch:** [prompts/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md](../prompts/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)

---

## 1 — Scope summary

5 must-fix items (SF-1..SF-5). Pure hardening migration: **adds triggers + CHECK constraints + COMMENT updates**. Does NOT modify RLS, columns, or schema shape.

| Item | Action | LOC est |
|------|--------|---------|
| SF-1 | New `biz_prevent_brand_slug_change` trigger fn + `BEFORE UPDATE` trigger on `brands` | ~15 |
| SF-2 | New `biz_prevent_event_slug_change` trigger fn + `BEFORE UPDATE` trigger on `events` | ~15 |
| SF-3 | New `biz_prevent_event_created_by_change` trigger fn + `BEFORE UPDATE` trigger on `events` | ~15 |
| SF-4 | Update `COMMENT ON TABLE` for `audit_log` + `scan_events` (Option B — see §4) | ~6 |
| SF-5 | `ALTER TABLE … ADD CONSTRAINT` for `refunds.status` + `door_sales_ledger.payment_method` | ~10 |
| GRANT/REVOKE | Grant new functions to `authenticated` + `service_role`; revoke from PUBLIC | ~12 |
| **Total** | Single migration file | **~75 LOC + comments** |

**Out of scope (deferred to ORCH-0707 / B2):** all 6 HF items + all 6 OB items from reviewer report. Do NOT touch RLS, jsonb shape validation, anon column-level grants, or `creator_accounts` policies.

---

## 2 — Migration filename + ordering

**File:** `supabase/migrations/<TIMESTAMP>_b1_5_pr_59_hardening.sql`

`<TIMESTAMP>` MUST be later than `20260502100000` (PR #59's migration timestamp). Recommended: `20260502120000` (2 hours after PR #59 baseline). Implementor picks final timestamp at write time — must be `> 20260502100000`.

**Sequencing constraint:** This migration depends on PR #59 being merged + applied first (its triggers reference `public.brands`, `public.events`, `public.audit_log`, `public.scan_events`, `public.refunds`, `public.door_sales_ledger` — all created by PR #59). If PR #59 is rebased, re-verify the migration timestamp ordering before deploying.

**Deployment:** User runs `supabase db push` after PR #59 deploys. Per memory rule `feedback_supabase_mcp_workaround` — implementor writes `.sql` file ONLY; do NOT use `mcp__supabase__apply_migration`.

---

## 3 — Per-item SQL specification

### SF-1 — `brands.slug` immutability

**Current state (PR #59 line 90):** `slug text NOT NULL` — mutable; only `CONSTRAINT brands_slug_nonempty CHECK (length(trim(slug)) > 0)` and the unique-active-slug index guard the column. No trigger.

**Consumer invariant violated:** I-17 (`mingla-business/src/store/currentBrandStore.ts:271–283` — *"FROZEN at brand creation per I-17. NEVER add an edit path"*). Cycle 7 share URLs at `/b/{brandSlug}` 404 if mutated.

**Verbatim SQL:**

```sql
CREATE OR REPLACE FUNCTION public.biz_prevent_brand_slug_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'brands.slug is immutable (I-17 — Cycle 7 share URLs depend on permanence; create a new brand instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_immutable_slug ON public.brands;
CREATE TRIGGER trg_brands_immutable_slug
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_brand_slug_change();

COMMENT ON TRIGGER trg_brands_immutable_slug ON public.brands IS
  'I-17 — brand slug FROZEN at creation. Cycle 7 /b/{brandSlug} share URLs and IG-bio links depend on permanence. Mirrors biz_prevent_brand_account_id_change.';
```

### SF-2 — `events.slug` immutability

**Current state (PR #59 line 409):** `slug text NOT NULL`. Idem.

**Consumer invariant violated:** Cycle 7 public-event URLs at `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` resolve events by `(brandSlug, eventSlug)` tuple. Renamed slug → 404 every shared link.

**Verbatim SQL:**

```sql
CREATE OR REPLACE FUNCTION public.biz_prevent_event_slug_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'events.slug is immutable (Cycle 7 share URLs depend on permanence; create a new event instead of renaming)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_slug ON public.events;
CREATE TRIGGER trg_events_immutable_slug
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_slug_change();

COMMENT ON TRIGGER trg_events_immutable_slug ON public.events IS
  'Event slug FROZEN at creation. Cycle 7 /e/{brandSlug}/{eventSlug} share URLs depend on permanence. Mirrors biz_prevent_brand_account_id_change.';
```

### SF-3 — `events.created_by` immutability

**Current state (PR #59 line 406):** `created_by uuid NOT NULL REFERENCES auth.users (id)` — mutable. RLS at `event_manager+` allows UPDATE. Attribution forgery vector.

**Verbatim SQL:**

```sql
CREATE OR REPLACE FUNCTION public.biz_prevent_event_created_by_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'events.created_by is immutable (audit-trail integrity)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_created_by ON public.events;
CREATE TRIGGER trg_events_immutable_created_by
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_created_by_change();

COMMENT ON TRIGGER trg_events_immutable_created_by ON public.events IS
  'events.created_by FROZEN — audit-trail integrity. Even event_manager+ cannot rewrite who created an event.';
```

### SF-4 — Append-only carve-out resolution (Option B default)

**Current state (PR #59 lines 1305–1318 + 1538–1551):**

```sql
-- biz_scan_events_block_mutate
IF auth.uid() IS NULL THEN
  RETURN COALESCE(NEW, OLD);
END IF;
RAISE EXCEPTION 'scan_events is append-only for clients';

-- biz_audit_log_block_mutate (identical pattern)
IF auth.uid() IS NULL THEN
  RETURN COALESCE(NEW, OLD);
END IF;
RAISE EXCEPTION 'audit_log is append-only for clients';
```

The short-circuit lets `service_role` (which has `auth.uid() = NULL`) freely UPDATE/DELETE. Combined with table COMMENTs that don't acknowledge this, the append-only contract is silently broken.

**Decision: Option B (documented carve-out).** Rationale: reconciliation jobs are real operational need (partial scanner sync, double-charged refund, mis-attributed door sale). Option A (strict-no-mutations-ever) creates real pain when bad rows land. Option B costs only a comment string. **If PR-author replies that the short-circuit was an oversight, flip to Option A** — see §6 contingency.

**Verbatim SQL (Option B — keep short-circuit, fix the lie in COMMENTs):**

```sql
-- Functions left UNTOUCHED (PR #59 already correct under Option B semantics).
-- Only the table comments need to honestly reflect the carve-out.

COMMENT ON TABLE public.audit_log IS
  'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. (B1.5 — ORCH-0706 SF-4)';

COMMENT ON TABLE public.scan_events IS
  'Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs (e.g., partial scanner sync repair) and migration scripts. Application code MUST NOT mutate; new scan rows via INSERT only. (B1.5 — ORCH-0706 SF-4)';
```

**Option A contingency (if PR-author flips intent):** Drop the short-circuit. Replace lines 1307–1309 + 1540–1542 with no-op (delete the `IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;` block). Then `RAISE EXCEPTION` fires for all roles including `service_role`. COMMENTs become: *"Strictly append-only for ALL roles including service_role. Mutations only via direct SQL run with `SET ROLE postgres` in migration scripts."* If Option A is chosen, the migration must also `CREATE OR REPLACE` the two trigger functions verbatim from PR #59 minus the short-circuit — exact 8-line replacement per function.

### SF-5 — Missing CHECK constraints

**Current state — `refunds.status`** (PR #59 line 1628): `status text NOT NULL DEFAULT 'pending'` — no CHECK. Peer table `orders.payment_status` (line 856–866) has CHECK across `('pending','paid','failed','refunded','partial_refund')`.

**Current state — `door_sales_ledger.payment_method`** (PR #59 line 1644): `payment_method text NOT NULL` — no CHECK. Peer column `orders.payment_method` (line 845–855) has CHECK across `('online_card','nfc','card_reader','cash','manual')`. Door sales by definition exclude `'online_card'` (only counter-side payments).

**Verbatim SQL:**

```sql
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE public.door_sales_ledger
  ADD CONSTRAINT door_sales_ledger_payment_method_check
    CHECK (payment_method IN ('cash', 'card_reader', 'nfc', 'manual'));
```

**Allowed-value rationale:**
- `refunds.status` — mirrors Stripe's Refund Object status enum (`pending`, `succeeded`, `failed`, `cancelled`). Implementor verifies against Stripe SDK + B-cycle Stripe wiring spec at SPEC drafting time. If consumer code lands a 5th value (e.g., `'reversed'`), update the CHECK before deploy.
- `door_sales_ledger.payment_method` — strict subset of `orders.payment_method` excluding `'online_card'` (door sales are physical-presence). Implementor verifies door-sales spec at SPEC drafting time before locking the list.

**Implementor pre-flight check:** before generating the migration, grep the consumer code (`mingla-business/src/store/orderStore.ts`, any refund-related types) for the exact refund status union. If consumer set is broader than `('pending','succeeded','failed','cancelled')`, expand the CHECK to match. Do NOT shrink the consumer set silently.

### GRANT/REVOKE block (mirrors PR #59 pattern lines 2088–2142)

```sql
REVOKE ALL ON FUNCTION public.biz_prevent_brand_slug_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_prevent_event_slug_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_prevent_event_created_by_change() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.biz_prevent_brand_slug_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_slug_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_created_by_change() TO authenticated;

GRANT EXECUTE ON FUNCTION public.biz_prevent_brand_slug_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_slug_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_prevent_event_created_by_change() TO service_role;
```

---

## 4 — Implementation order (for the implementor)

Single migration file. Wrap in a transaction:

```sql
BEGIN;

-- 1. SF-1: brands.slug immutability (function + trigger + GRANT/REVOKE)
-- 2. SF-2: events.slug immutability
-- 3. SF-3: events.created_by immutability
-- 4. SF-4: audit_log + scan_events COMMENT ON TABLE updates
-- 5. SF-5: refunds.status + door_sales_ledger.payment_method CHECK constraints

COMMIT;
```

Per-step contents enumerated verbatim in §3. No reordering allowed — locks are independent, but keeping order matches reviewer's findings and makes the diff easy to audit.

---

## 5 — Success criteria (for the tester)

Tester runs via Supabase Management API direct SQL per memory rule `feedback_supabase_mcp_workaround`. Pattern:

```bash
curl -X POST \
  -H "Authorization: Bearer ${SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  -d '{"query": "<SQL HERE>"}' \
  https://api.supabase.com/v1/projects/<PROJECT_REF>/database/query
```

| SC | Test SQL | Expected |
|----|----------|----------|
| **SC-1** | `UPDATE public.brands SET slug = 'forbidden-test' WHERE id = (SELECT id FROM public.brands LIMIT 1);` | Error: `brands.slug is immutable (I-17 — …)` |
| **SC-2** | `UPDATE public.events SET slug = 'forbidden-test' WHERE id = (SELECT id FROM public.events LIMIT 1);` | Error: `events.slug is immutable (Cycle 7 share URLs depend on permanence; …)` |
| **SC-3** | `UPDATE public.events SET created_by = (SELECT id FROM auth.users WHERE id != events.created_by LIMIT 1) WHERE id = (SELECT id FROM public.events LIMIT 1);` | Error: `events.created_by is immutable (audit-trail integrity)` |
| **SC-4a** (Option B) | `\d+ public.audit_log` (psql) — read the table comment | Comment includes "Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs" |
| **SC-4b** (Option B) | `\d+ public.scan_events` — read the table comment | Comment includes the same disclosure |
| **SC-4c** (Option B) | From an authenticated session: `UPDATE public.audit_log SET ...` | Error: `audit_log is append-only for clients` (unchanged from PR #59) |
| **SC-4d** (Option B) | From service role: `UPDATE public.audit_log SET ...` | Succeeds (carve-out confirmed). |
| **SC-4** (Option A — if flipped) | From service role: `UPDATE public.audit_log SET ...` | Error: `audit_log is append-only` (no role-bypass) |
| **SC-5a** | `INSERT INTO public.refunds (order_id, amount_cents, status) VALUES ((SELECT id FROM public.orders LIMIT 1), 100, 'bogus_status');` | Error: `refunds_status_check` violation |
| **SC-5b** | `INSERT INTO public.refunds (order_id, amount_cents, status) VALUES (..., 'pending');` | Succeeds (regression check — valid value still allowed) |
| **SC-6a** | `INSERT INTO public.door_sales_ledger (event_id, payment_method, amount_cents) VALUES ((SELECT id FROM public.events LIMIT 1), 'venmo', 100);` | Error: `door_sales_ledger_payment_method_check` violation |
| **SC-6b** | `INSERT INTO public.door_sales_ledger (event_id, payment_method, amount_cents) VALUES (..., 'cash', 100);` | Succeeds (regression check) |
| **SC-7** | All PR #59 RLS regression tests (existing repo tests if any; otherwise spot-check `SELECT` on `brands` from authenticated session) | All pass — RLS surface untouched |
| **SC-8** | Re-run migration twice (idempotency) | Second run is no-op (no errors, no duplicate triggers) |

**Live-fire gate:** Tester MUST run SC-1, SC-2, SC-3, SC-5a, SC-6a from a real Supabase environment (not local mock). Memory rule `feedback_headless_qa_rpc_gap` — code-forensic alone insufficient for trigger RAISE EXCEPTION verification.

---

## 6 — Invariant registrations

Implementor MUST add the following entries to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as part of this cycle (verify next-available number at write time; placeholders below):

### I-17 (existing — promote)

**Before:** "Brand slug FROZEN at creation per consumer-side convention (`currentBrandStore.ts:271–283`)."
**After:** "Brand slug FROZEN at creation. **DB-enforced** via `trg_brands_immutable_slug` (PR #59 + ORCH-0706 hardening). Cycle 7 `/b/{brandSlug}` share URLs depend on permanence. Origin: ORCH-0706 (2026-05-02)."

### I-22 (NEW)

**Statement:** "Event slug FROZEN at creation. DB-enforced via `trg_events_immutable_slug`. Cycle 7 `/e/{brandSlug}/{eventSlug}` public URLs depend on permanence — a renamed slug 404s every shared event link."
**Origin:** ORCH-0706 (2026-05-02)
**Enforcement:** `BEFORE UPDATE` trigger on `public.events`
**Test:** SC-2

### I-23 (NEW)

**Statement:** "`events.created_by` FROZEN at creation. Even `event_manager+` cannot rewrite who created an event. Protects audit-trail integrity."
**Origin:** ORCH-0706 (2026-05-02)
**Enforcement:** `BEFORE UPDATE` trigger on `public.events`
**Test:** SC-3

### I-24 (NEW)

**Statement (Option B — default):** "`audit_log` and `scan_events` are append-only for non-service-role callers. Service role (auth.uid() IS NULL) MAY mutate for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. Documented disclosure in `COMMENT ON TABLE`."
**Statement (Option A — if flipped):** "`audit_log` and `scan_events` are strictly append-only for ALL roles including service_role. Mutations only via direct SQL with explicit role override in migration scripts."
**Origin:** ORCH-0706 (2026-05-02)
**Enforcement:** `BEFORE UPDATE OR DELETE` triggers on both tables
**Test:** SC-4a/b/c/d

---

## 7 — Decision log entry — DEC-088

Implementor MUST add to `Mingla_Artifacts/DECISION_LOG.md`:

```
## DEC-088 — Audit-log + scan-events append-only carve-out (Option B)

**Date:** 2026-05-02
**ORCH:** ORCH-0706
**Decision:** audit_log and scan_events tables remain append-only for non-service-role
callers, but service_role retains UPDATE/DELETE permission for reconciliation jobs and
migration scripts. The carve-out is documented verbatim in COMMENT ON TABLE for both
tables.

**Rationale:** Reconciliation jobs are an operational reality (partial scanner sync,
double-charged refund, mis-attributed door sale). Strict-no-mutations-ever creates
real on-call pain the first time bad data lands and we cannot fix it without dropping
and recreating triggers. The cost of Option B is one comment string; the cost of
Option A is a midnight-emergency migration.

**Reversal cost:** Low — flipping to Option A is an 8-line trigger function rewrite.

**Reverses:** None (formalises ambiguous PR #59 state).
**Reversed by:** None.
```

**If PR-author replies that the service-role short-circuit was an oversight (Q2 reply),** flip Option A: rewrite DEC-088 to ratify Option A, swap §3.SF-4 SQL to drop the short-circuit, and update I-24 to the Option A statement. SPEC writer / implementor decides at SPEC review time based on PR-author reply.

---

## 8 — Constraints

- **No RLS changes.** This migration adds triggers + CHECK constraints + COMMENT updates only.
- **No new tables, no new columns, no schema reshape.**
- **Idempotent on re-apply.** All `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS … CREATE TRIGGER`. CHECK constraints use `ALTER TABLE … ADD CONSTRAINT` — wrap in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block to guard re-apply.
- **No `mcp__supabase__apply_migration`.** Implementor writes `.sql` only.
- **Migration timestamp > `20260502100000`** (PR #59 baseline).
- **Single transaction (BEGIN/COMMIT)** so a single CHECK violation rolls back the entire hardening.
- **GRANT/REVOKE block at end** — mirrors PR #59 lines 2088–2142 ordering.

---

## 9 — Cross-references

- Reviewer report (forensics): [reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md](../reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md)
- Reviewer paste-ready PR comment: [reports/PR_59_REVIEW_COMMENTS.md](../reports/PR_59_REVIEW_COMMENTS.md)
- PR #59 author-question comment posted: https://github.com/Mingla-LLC/mingla-main/pull/59#issuecomment-4364474041
- Dispatch prompt: [prompts/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md](../prompts/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)
- I-17 origin: `mingla-business/src/store/currentBrandStore.ts:271–283`
- Cycle 7 share URL consumers: `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` + `mingla-business/app/b/[brandSlug].tsx` + `mingla-business/src/components/ui/ShareModal.tsx`
- Peer trigger pattern (verbatim mirror): PR #59 line 123–140 (`biz_prevent_brand_account_id_change`)
- Peer CHECK pattern: PR #59 line 845–855 (`orders.payment_method`)
- PR #59 head ref: `836ce108054800aba1573d8bc30684f5728a86ce`

---

## 10 — Implementor handoff checklist

When implementor picks this up:

- [ ] Verify PR #59 has merged + deployed before writing migration. If not, work is blocked.
- [ ] Verify PR-author Q2 reply on https://github.com/Mingla-LLC/mingla-main/pull/59. If reply says "oversight," flip to Option A per §3.SF-4 contingency. If no reply, proceed with Option B default.
- [ ] Pre-flight grep consumer code for `refund.status` allowed values. If union differs from `('pending','succeeded','failed','cancelled')`, expand SC-5 + §3.SF-5 CHECK before locking.
- [ ] Pre-flight grep consumer code for door-sales `payment_method` allowed values. If union differs from `('cash','card_reader','nfc','manual')`, expand SC-6 + §3.SF-5 CHECK before locking.
- [ ] Write migration file to `supabase/migrations/<TIMESTAMP>_b1_5_pr_59_hardening.sql`. Do NOT use `mcp__supabase__apply_migration`.
- [ ] Update INVARIANT_REGISTRY (I-17 promote, I-22, I-23, I-24 — verify next-available numbers).
- [ ] Update DECISION_LOG (DEC-088 — verify next-available number).
- [ ] Self-verify all 13 SCs pass via Supabase Management API SQL (memory rule).
- [ ] Tester dispatch: live-fire SC-1/2/3/5a/6a in real Supabase environment.

---

## 11 — Cleanup note

Implementor may delete the temp file `.tmp/pr59_migration.sql` (created during SPEC drafting to verify exact line numbers + peer patterns from PR #59 head). Not part of the deliverable.
