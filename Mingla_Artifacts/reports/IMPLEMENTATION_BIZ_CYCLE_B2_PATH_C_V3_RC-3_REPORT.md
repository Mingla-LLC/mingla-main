---
title: B2a Path C V3 — RC-3 Brand Owner team_member auto-create trigger
status: implemented, unverified (operator must run `supabase db push` + retest)
implementor: mingla-implementor
created: 2026-05-07
dispatch_prompt: Mingla_Artifacts/prompts/IMPL_B2A_PATH_C_V3_RC-3_OWNER_TEAM_MEMBER_TRIGGER.md
investigation: Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_E2E_PIPELINE.md
files_changed: 1 new SQL migration (zero client/edge fn changes)
---

# Layman summary

Created a Postgres trigger that automatically inserts the owner's `brand_team_members` row whenever a new brand is created, plus a one-time backfill for any owner rows that slipped through between the prior backfill (2026-05-13) and this deploy. After `supabase db push`, the V3 ToS edge function will always find a row to update — no more 5xx on first ToS acceptance for newly-created brands. New owners still must traverse the ToS gate (the trigger leaves `mingla_tos_accepted_at = NULL` intentionally, per I-PROPOSED-U).

Status: **implemented, unverified.** Operator must run `supabase db push`, then retap ToS on the existing failing brand `22a18413…` (the migration's one-time backfill catches it) or delete + recreate a brand (trigger fires) to confirm the fix.

# Files changed

## NEW: `supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql`

**What it did before:** N/A (new file)

**What it does now:**
- Defines `public.biz_create_brand_owner_team_member()` — a `plpgsql` `SECURITY DEFINER` trigger function with locked `search_path TO 'public', 'pg_temp'`. Inserts one `brand_team_members` row per (NEW.id, NEW.account_id) with `role = 'account_owner'`, `invited_at = accepted_at = NEW.created_at`, `mingla_tos_accepted_at = NULL`, `mingla_tos_version_accepted = NULL`. Guarded by `IF NEW.account_id IS NOT NULL` (defensive) and `IF NOT EXISTS (...)` (idempotent — no unique constraint exists, so this guard replaces `ON CONFLICT`).
- Creates `AFTER INSERT FOR EACH ROW` trigger `biz_brand_owner_team_member_after_insert` on `public.brands` invoking the function.
- One-time backfill `INSERT … SELECT … FROM brands b LEFT JOIN brand_team_members tm WHERE tm.user_id IS NULL AND b.account_id IS NOT NULL AND b.deleted_at IS NULL`. Mirrors the prior backfill's join pattern but writes `mingla_tos_accepted_at = NULL` (post-V3 owners must traverse ToS gate, NOT grandfathered). Catches the operator's failing brand `22a18413…` and any other brands inserted between 2026-05-13 and now.
- Three verification probes (function exists, trigger attached, zero remaining orphans) raise exceptions on failure so `supabase db push` fails loudly rather than silently shipping a broken migration.

**Why:** Closes the deferred fix flagged at `20260513000001_b2a_v3_owner_team_members_backfill.sql:12-15` ("Future brand creates should also create this row — separate fix in the brand creation flow (not this migration)"). Resolves Symptom 3 / RC-3 of B2a Path C V3 Phase 16 device smoke.

**Lines added:** ~165 (file is heavily-commented for future-Claude readability per `feedback_forensic_thoroughness` + the migration-chain rule).

# Spec traceability

| # | Criterion | Status | Verification |
|---|-----------|--------|--------------|
| S-01 | Migration file exists at exact path | ✅ PASS | File at `supabase/migrations/20260514000000_b2a_v3_brand_owner_team_member_trigger.sql` |
| S-02 | SECURITY DEFINER + search_path `'public', 'pg_temp'` | ✅ PASS | Lines 67-69 of the migration |
| S-03 | `AFTER INSERT ON public.brands FOR EACH ROW` trigger | ✅ PASS | Lines 113-118 of the migration |
| S-04 | `IF NOT EXISTS` guard in trigger fn | ✅ PASS | Lines 81-89 of the migration |
| S-05 | `IF NEW.account_id IS NOT NULL` defensive guard | ✅ PASS | Lines 73-77 of the migration |
| S-06 | One-time backfill with `WHERE NOT EXISTS` (LEFT JOIN ... IS NULL pattern) | ✅ PASS | Lines 130-149 of the migration |
| S-07 | Header comment cites prior backfill + edge fn + I-PROPOSED-U | ✅ PASS | Lines 1-46 of the migration |
| S-08 | Implementation report written | ✅ PASS | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_V3_RC-3_REPORT.md` |

# Schema constraints satisfied (verified by reading baseline)

- `brand_team_members_role_check` allows `'account_owner'` (verified at `20260505000000_baseline_squash_orch_0729.sql:7750`)
- `brand_team_members_accepted_removed_excl` (`removed_at IS NULL OR accepted_at IS NOT NULL`) — trigger sets `accepted_at = NEW.created_at` (NOT NULL) and `removed_at = NULL`, so both branches are satisfied (verified at `20260505000000:7749`)
- No unique constraint on `(brand_id, user_id)` — `IF NOT EXISTS` is the correct idempotency guard, mirroring the prior backfill's `LEFT JOIN ... WHERE NULL` reasoning at `20260513000001:20-23`

# Invariant verification

| Invariant | Preserved? | How |
|-----------|------------|-----|
| **I-PROPOSED-U (Mingla ToS gate before Stripe Connect ops)** | ✅ Y | Trigger leaves `mingla_tos_accepted_at = NULL` for new owners, forcing them to traverse the ToS gate exactly like other admins. Pre-existing owners' grandfathering from the prior backfill is untouched. |
| **I-PROPOSED-T/V/W (Stripe controls)** | ✅ Y | No edge fn / Stripe call touched. |
| **I-PROPOSED-Y (platform web URL)** | ✅ Y | No URL handling touched. |
| **Constitutional #2 (one owner per truth)** | ⚠️ Same-as-before | The brand-owner concept is now stored in two places (`brands.account_id` AND `brand_team_members(role=account_owner)`). This is pre-existing duplication — the trigger doesn't introduce it; it ensures consistency between the two stores. Future cleanup may unify, but is out of scope. |
| **Constitutional #3 (no silent failures)** | ✅ Y | Verification probes raise on missing function/trigger or remaining orphans. |
| **Constitutional #7 (label temporary fixes)** | ✅ Y | No `[TRANSITIONAL]` markers introduced. The grandfathering in `20260513000001` was pre-existing. |
| **Constitutional #8 (subtract before adding)** | ✅ Y | The trigger replaces the deferred-fix promise from the prior backfill, not a working code path. |

# Parity check

- **Solo / collab**: mingla-business has no collab mode. N/A.
- **app-mobile**: separate codebase; uses different `accounts` table; not affected.
- **mingla-admin**: reads brand state but does not interact with `brand_team_members.mingla_tos_accepted_at`. Not affected.

# Cache safety

No React Query cache impact. The change is server-side only:
- New brand insert → trigger fires server-side → row exists when ToS edge fn fires → mutation succeeds → existing `useMinglaToSAcceptance` invalidation logic continues to work unchanged.
- Existing brands with the orphan-owner state get their row backfilled in the migration's one-time block. Next ToS gate read after deploy reflects the new state.

# Regression surface

The 3-5 adjacent flows the tester should verify:

1. **Brand create on new install** — first-ever brand for a new user. Trigger fires; team_member row appears; ToS gate path works. (Highest priority — the original symptom path.)
2. **Brand create when user already owns another brand** — multiple brands, multiple owner team_member rows; no constraint conflict; each brand's ToS state is independent.
3. **Brand soft-delete then recreate** — operator-reproducible scenario from the bug report. The backfill block + trigger combined must yield exactly one team_member row per active brand.
4. **Existing brands with grandfathered ToS** — must remain grandfathered (not flipped to NULL by this migration). The backfill explicitly only touches owners with NO existing row, so grandfathered rows are untouched. Verify via `SELECT count(*) FROM brand_team_members WHERE role='account_owner' AND mingla_tos_version_accepted='pre-v3-grandfathered'` before and after.
5. **Stripe Connect onboarding for the failing brand `22a18413…`** — should now proceed past the ToS gate after `supabase db push`. (V-01 from the investigation's verification matrix.)

# Constitutional compliance

Quick-scan against the 14 principles:

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | N/A — backend trigger only |
| 2 | One owner per truth | ⚠️ Pre-existing dual-source (brands.account_id + team_members.account_owner). Not introduced here. |
| 3 | No silent failures | ✅ Verification probes raise; trigger inserts unconditionally on new brand. |
| 4 | One query key per entity | N/A |
| 5 | Server state stays server-side | ✅ Pure DB |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | ✅ No new transitional markers |
| 8 | Subtract before adding | ✅ Closes a documented deferred-fix |
| 9 | No fabricated data | ✅ All inserted values derive from NEW row columns |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | ✅ Trigger fires AFTER INSERT — row is real |
| 13 | Exclusion consistency | ✅ Same INSERT shape as prior backfill, only ToS state differs intentionally |
| 14 | Persisted-state startup | N/A |

# Operator post-deploy verification commands

After `supabase db push`:

1. **Confirm migration applied:**
   ```bash
   supabase migration list --project-ref gqnoajqerqhnvulmnyvv | grep 20260514000000
   ```
   Expected: row appears in `Remote` column.

2. **Confirm trigger registered** (Supabase Dashboard SQL editor — operator-side, no PII to transcript):
   ```sql
   SELECT tgname, tgrelid::regclass, tgenabled
   FROM pg_trigger
   WHERE tgname = 'biz_brand_owner_team_member_after_insert';
   ```
   Expected: 1 row, tgenabled = 'O' (enabled).

3. **Confirm orphan count is now zero:**
   ```sql
   SELECT count(*) AS orphans
   FROM public.brands b
   LEFT JOIN public.brand_team_members tm
     ON tm.brand_id = b.id AND tm.user_id = b.account_id
   WHERE tm.user_id IS NULL
     AND b.account_id IS NOT NULL
     AND b.deleted_at IS NULL;
   ```
   Expected: 0.

4. **Device retest** — re-tap the ToS accept button on the existing brand `22a18413…`. Expected: 200 OK from `brand-mingla-tos-accept`, UI flips to next state (Stripe country picker / payments setup).

5. **Then run V-01 (Stripe Phase 16 smoke)** — country picker → "Set up payments" → browser sheet opens to working Stripe Connect Embedded form.

If any step fails, return to implementor with NEEDS REWORK and the failing output verbatim.

# Discoveries for orchestrator

## D-RC3-1 — Constitutional #2 dual-source for brand ownership (pre-existing)

`brands.account_id` AND `brand_team_members(role='account_owner')` are now both authoritative for "who owns this brand." `biz_brand_effective_rank` reads from BOTH (`brands.account_id` for the account_owner branch, then `brand_team_members` for higher-ranked roles via the COALESCE). This means future role-related changes must update both sources or risk drift.

The cleanest long-term fix is to make `brand_team_members` the single source of truth and drop `brands.account_id` — but that requires:
- Refactoring every RLS policy that references `account_id` (multiple)
- Refactoring `biz_brand_effective_rank` and adjacent helpers
- Backfilling any code path that reads `brands.account_id` directly
- Adding the missing `(brand_id, user_id)` UNIQUE constraint

Out of scope for B2a Path C V3 close. Recommend registering as a follow-up cleanup ORCH after Cycle B2 fully ships.

## D-RC3-2 — `brand_team_members` lacks `(brand_id, user_id)` UNIQUE constraint

Multiple migrations have explicitly noted this (the prior backfill at lines 20-23, the trigger fn here at lines 81-89). Adding a `UNIQUE (brand_id, user_id) WHERE removed_at IS NULL` partial unique index would:
- Make `ON CONFLICT (brand_id, user_id) DO NOTHING` viable (cleaner than `IF NOT EXISTS`)
- Prevent any future race condition where two parallel triggers try to insert the same row
- Strengthen the schema-level guarantee

Trade-off: existing data may have duplicates if any historical bug created them. Audit before adding the constraint. Out of scope here.

## D-RC3-3 — Existing failing brand `22a18413…` will be auto-fixed by the migration's backfill block

No additional cleanup needed. The one-time backfill at lines 130-149 catches any active (non-soft-deleted) brand whose owner row is missing. The orchestrator can confirm this via verification probe step 3 above (orphan count = 0).

## D-RC3-4 — `requireUserId` uses service-role key for token validation

[`supabase/functions/_shared/stripeEdgeAuth.ts:43-54`](../supabase/functions/_shared/stripeEdgeAuth.ts) creates a `userClient` using `SUPABASE_SERVICE_ROLE_KEY` and then sets the user's bearer token in the `Authorization` header. This is a known anti-pattern — using the service role key + a user JWT means the validation does not actually use anon-key + JWT-aware decoding the way Supabase docs recommend ([https://supabase.com/docs/guides/auth/server-side-auth](https://supabase.com/docs/guides/auth/server-side-auth)). It works (because the service role key gives full DB access and the user JWT lookup via `auth.getUser` validates the token independently), but is a hidden flaw worth flagging.

Out of scope for this dispatch. Register as observation if not already on backlog.

# Transition items

None. The trigger is the production fix; no `[TRANSITIONAL]` markers introduced.

# Verification matrix (this implementor's confidence)

| Criterion | Status | Method |
|-----------|--------|--------|
| S-01 (file path) | ✅ Verified | `ls` (implicit via Write success) |
| S-02 (SECURITY DEFINER + search_path) | ✅ Verified | grep'd file content |
| S-03 (trigger shape) | ✅ Verified | grep'd file content |
| S-04 (idempotency guard) | ✅ Verified | grep'd file content |
| S-05 (NULL guard) | ✅ Verified | grep'd file content |
| S-06 (backfill block) | ✅ Verified | grep'd file content |
| S-07 (header citations) | ✅ Verified | grep'd file content |
| S-08 (report exists) | ✅ Verified | This file |
| Migration applies cleanly to live DB | ⚠️ UNVERIFIED | Operator must run `supabase db push` |
| Trigger fires on next brand insert | ⚠️ UNVERIFIED | Operator must create a test brand and confirm row exists |
| Backfill catches `22a18413…` | ⚠️ UNVERIFIED | Operator must verify orphan count = 0 + retap ToS |

Status label: **`implemented, unverified`** — the migration is written and self-consistent, but the SQL has not been executed against the live DB by this implementor.
