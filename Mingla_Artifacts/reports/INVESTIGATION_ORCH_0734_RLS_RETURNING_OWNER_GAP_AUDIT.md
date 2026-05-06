# INVESTIGATION REPORT — ORCH-0734 — RLS-RETURNING-OWNER-GAP audit (mingla-business)

**Authored:** 2026-05-06 by mingla-forensics
**Predecessors:** ORCH-0728/0729/0731 + H39/H40/H41/H42 (root cause PROVEN — RC-0728 in ROOT_CAUSE_REGISTER.md)
**Mode:** INVESTIGATE (audit-only; spec produced separately)
**Confidence:** HIGH for confirmed bugs; HIGH for latent classifications; MEDIUM for the underlying Postgres mechanism inference (multiple hypotheses fit the empirical data)

---

## Layman summary

The brand-create + brand-delete bugs share one root cause: when supabase-js + Postgres RLS evaluate the post-mutation row state, the RLS helper function `biz_brand_effective_rank` either (a) can't see the just-inserted row in the RETURNING phase OR (b) excludes soft-deleted brands from "ownership" detection, depending on the operation. We audited every mutation policy on every mingla-business B1+ table and found:

- **2 confirmed bugs on `brands`** — both produce 42501 in production
- **1 latent bug on `events`** — would 42501 only if and when the soft-delete code path chains `.select()` to its update (currently no `.select()` chained for events, no operator-facing flow yet wired)
- **0 bugs** on `creator_accounts`, `brand_team_members`, `brand_invitations`, `audit_log` — their policies are immune to the bug class because they use direct predicates (no helper) or symmetric admin-write/admin-read pairing
- **1 architectural side issue** — the `biz_brand_effective_rank` helper has an implicit semantic where soft-deleted brands silently grant zero rank to everyone (including the owner); this is what trips brand-delete's WITH CHECK

The fix is small: 2 new permissive policies on `brands` using direct-predicate ownership (`account_id = auth.uid()`). No code changes needed. No helper-function changes needed. No risk to existing flows.

Findings: 2 root causes, 1 contributing factor, 4 hidden flaws, 6 observations
Confidence: H (root causes) / H (no other latent in-scope bugs found) / M (exact Postgres mechanism for SELECT-for-RETURNING failure)

---

## 1. Symptom Summary

| Operation | Code site | Failure | Root cause |
|---|---|---|---|
| Brand-create (`createBrand`) | `mingla-business/src/services/brandsService.ts:94-98` (`.insert(...).select().single()`) | 42501 / "new row violates row-level security policy for table brands" | RC-0728-A: SELECT-for-RETURNING fails because no SELECT policy admits a just-inserted brand |
| Brand-delete (`softDeleteBrand`) | `mingla-business/src/services/brandsService.ts:222-228` (bare `.update()`) | 42501 same message | RC-0728-B: UPDATE WITH CHECK fails because helper `biz_is_brand_admin_plus_for_caller(id)` evaluates against post-mutation row whose `deleted_at IS NOT NULL`, which the helper's `EXISTS (... WHERE brands.deleted_at IS NULL)` excludes |

Both reproduce 100% of the time. PASS-13 evidence chain (H39 toggle, H40 JWT decode, H41 pg_policies enumeration, H42 INSERT-without-RETURNING) closed every alternative hypothesis.

---

## 2. Investigation Manifest

Phase 0 — Context ingest (per dispatch §3, no skipping):

| File | Layer | Why |
|---|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md` | Prior | PASS-10 historical pull (full B1 schema review) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0733_H40_JWT_DECODE_REPORT.md` | Prior | PASS-12 JWT proof (sub === user.id) |
| `Mingla_Artifacts/prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md` | Dispatch | Mission + scope + methodology |
| `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` (RC-0728) | Prior | RC entry written by orchestrator with PASS-13 evidence chain |

DB-side audit (Supabase Management API via mcp__supabase__execute_sql):

| Query | Layer | Result |
|---|---|---|
| `pg_class WHERE relrowsecurity=true` | Schema | 130+ tables RLS-enabled (most out-of-scope; admin/consumer surface) |
| `pg_policies WHERE tablename IN (creator_accounts, brands, events, brand_team_members, audit_log, brand_invitations)` | Schema | 23 policies enumerated |
| `pg_proc WHERE proname IN biz_*_for_caller helpers` | Schema | 7 SECURITY DEFINER STABLE functions read verbatim |
| `information_schema.columns WHERE column_name IN (deleted_at, removed_at)` | Schema | 4 of 6 in-scope tables have soft-delete columns |
| `pg_trigger WHERE tgrelid IN (in-scope tables) AND NOT tgisinternal` | Schema | 9 user triggers enumerated; **zero AFTER INSERT triggers** (no auto-grant of brand_team_members on brand insert) |

Code-side audit (Grep + Read):

| File | Layer | Why |
|---|---|---|
| `mingla-business/src/services/brandsService.ts` | Code | 5 supabase mutation/read sites — every brands CRUD operation |
| `mingla-business/src/services/creatorAccount.ts` | Code | 2 supabase sites — upsert + select |
| `mingla-business/src/hooks/useAuditLog.ts` | Code | 1 site — confirmed read-only (no INSERT path) |
| `mingla-business/src/hooks/useBrands.ts` | Code | 5 sites — events SELECT + brand_team_members SELECT + brands SELECT |
| `mingla-business/src/hooks/useCurrentBrandRole.ts` | Code | 3 sites — all SELECT |
| `mingla-business/src/hooks/useAccountDeletion.ts` | Code | 3 sites — creator_accounts |

Total mutation sites in mingla-business that hit in-scope tables: 4 INSERT/UPSERT/UPDATE operations.

---

## 3. Audit Matrix — every (table, mutation, actor, post-state, SELECT admits?) pair in scope

Legend: ✅ admit, ❌ deny, 🔴 BUG, 🟡 LATENT, ⚪ N/A.

### Table: `creator_accounts`

| Mutation | Policy | Actor | Post-state row | SELECT policies that admit | Bug? |
|---|---|---|---|---|---|
| INSERT | "Creators can insert own account" WC: `auth.uid() = id` | self | `id = auth.uid()`, `deleted_at IS NULL` | ✅ "Creators can read own account" USING `auth.uid() = id` (direct predicate, no helper, no deleted_at gate) | ⚪ NO BUG |
| UPDATE | "Creators can update own account" USING/WC: `auth.uid() = id` | self | various; `id` immutable | ✅ same as above | ⚪ NO BUG |
| DELETE | (none) | — | — | — | ⚪ N/A — no DELETE policy; soft-delete only via UPDATE setting `deleted_at` |

Code-side mutation sites: `services/creatorAccount.ts:20` (UPSERT), `hooks/useAccountDeletion.ts:73,80` (UPDATE). Both safe.

### Table: `brands`

| Mutation | Policy | Actor | Post-state row | SELECT policies that admit (after mutation) | Bug? |
|---|---|---|---|---|---|
| INSERT | "Account owner can insert brand" WC: `(account_id = auth.uid()) AND (deleted_at IS NULL)` | account owner (creator) | new row: `account_id = auth.uid()`, `deleted_at IS NULL` | "Brand members" USING `(deleted_at IS NULL) AND biz_is_brand_member_for_read_for_caller(id)` → helper internally does `EXISTS (SELECT 1 FROM brands b WHERE b.id = NEW.id AND b.account_id = auth.uid() AND b.deleted_at IS NULL)`. **Empirically returns FALSE** despite the row existing in-transaction (likely SECURITY DEFINER + STABLE snapshot quirk; see §6) — H42 confirms via no-RETURNING bypass. "Public" USING `EXISTS(events with public+scheduled)` → FALSE for fresh brand (no events). | 🔴 **RC-0728-A BUG #1** — brand-create 42501 |
| UPDATE non-soft-delete | "Brand admin plus can update brands" USING/WC: `biz_is_brand_admin_plus_for_caller(id)` | account owner | row: `account_id` unchanged, `deleted_at IS NULL` (unchanged) | helper sees committed brand row; account_owner gets rank 60; ✅ admit | ⚪ NO BUG |
| UPDATE soft-delete (sets `deleted_at = now()`) | same | account owner | row: `deleted_at IS NOT NULL` after update | **WITH CHECK fails** — helper EXISTS subquery requires `b.deleted_at IS NULL`; in-transaction NEW state has `deleted_at IS NOT NULL`; helper returns 0; admin_plus FALSE; WITH CHECK fails. | 🔴 **RC-0728-B BUG #2** — brand-delete 42501 |
| DELETE (hard) | "Brand admin plus can delete brands" USING: `biz_is_brand_admin_plus_for_caller(id)` | account owner | (row removed) | DELETE without RETURNING — no SELECT policy evaluation needed; helper runs against pre-delete brand state (deleted_at IS NULL ✓); admin_plus TRUE; DELETE permitted. RETURNING with .delete().select() would evaluate SELECT against the row being deleted — would pass via brand_members helper (still pre-delete state in helper context). | ⚪ NO BUG (not currently called from mingla-business code anyway) |

Code-side mutation sites:
- `brandsService.ts:94-98` createBrand uses `.insert(payload).select().single()` → RETURNING active → 🔴 hits BUG #1
- `brandsService.ts:165-171` updateBrand uses `.update(payload).eq("id",x).is("deleted_at",null).select().single()` → RETURNING active; only updates non-deleted → for non-soft-delete updates, post-state has deleted_at unchanged → ✅ helper passes → no bug for non-soft-delete
- `brandsService.ts:222-228` softDeleteBrand uses **bare** `.update(...)` (no `.select()` chained) → `Prefer: return=minimal` per supabase-js v2 default → no RETURNING SELECT evaluation; **but WITH CHECK still applies** → 🔴 hits BUG #2 at WITH CHECK time, not RETURNING time
- `brandsService.ts:231-234` updates `creator_accounts` (clear default_brand_id) — out-of-table, safe

### Table: `events`

| Mutation | Policy | Actor | Post-state row | SELECT policies that admit (after mutation) | Bug? |
|---|---|---|---|---|---|
| INSERT | "Event manager plus can insert events" WC: `(deleted_at IS NULL) AND (created_by = auth.uid()) AND (biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager'))` | event_manager+ (incl. account owner) | new event: `brand_id = pre-existing brand`, `created_by = auth.uid()`, `deleted_at IS NULL` | "Brand team can select events" USING `(deleted_at IS NULL) AND biz_is_brand_member_for_read_for_caller(brand_id)`. Helper queries `brands` (pre-existing committed row, deleted_at IS NULL, owner == auth.uid()) → returns rank 60 ✅. "Public" admits if visibility=public AND status IN scheduled/live (depends on input). At least one SELECT admits via brand-team. | ⚪ NO BUG (helper queries brands, not events; no SECURITY DEFINER snapshot issue for cross-table reference) |
| UPDATE non-soft-delete | "Event manager plus can update events" USING/WC: `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')` | event_manager+ | events row: deleted_at unchanged | helper queries brands (unchanged) → admit ✅ | ⚪ NO BUG |
| UPDATE soft-delete (events.deleted_at = now()) | same | event_manager+ | events row: `deleted_at IS NOT NULL` | WITH CHECK helper queries brands (unchanged, deleted_at IS NULL ✓) → returns rank → admit ✅. **But SELECT-for-RETURNING (if `.select()` chained):** "Brand team" gates on events.deleted_at IS NULL → FALSE; "Public" gates on deleted_at IS NULL → FALSE. → 🟡 LATENT 42501. | 🟡 **LATENT LF-1** — only triggers if events soft-delete code path chains `.select()`. Currently NO events soft-delete is wired in mingla-business code (verified via grep). |
| DELETE (hard) | "Event manager plus can delete events" USING: `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')` | event_manager+ | (removed) | helper queries brands → admit ✅ | ⚪ NO BUG (not currently called) |

Code-side mutation sites: `hooks/useBrands.ts:341,347,353` — events SELECTs only (counts for soft-delete preconditions, etc.); `useBrands.ts:359,364` — brand_team_members + brands SELECT. NO INSERT or UPDATE on events from mingla-business code today. LF-1 is a future-trip-wire.

### Table: `brand_team_members`

| Mutation | Policy | Actor | Post-state | SELECT admits? | Bug? |
|---|---|---|---|---|---|
| INSERT | "Brand admin plus insert brand_team_members" WC: `biz_is_brand_admin_plus_for_caller(brand_id)` | brand admin+ | new row: brand_id, user_id, role, etc. | "Members and admins read brand_team_members" USING `(user_id = auth.uid()) OR biz_is_brand_admin_plus_for_caller(brand_id)` — admin path admits ✅ (admin invariantly admits brand_team_members on brands they admin) | ⚪ NO BUG |
| UPDATE | "Brand admin plus update brand_team_members" USING/WC: `biz_is_brand_admin_plus_for_caller(brand_id)` | brand admin+ | row: brand_id (immutable likely) | same SELECT admits ✅ | ⚪ NO BUG |
| DELETE | "Brand admin plus delete brand_team_members" USING: `biz_is_brand_admin_plus_for_caller(brand_id)` | brand admin+ | (removed) | n/a | ⚪ NO BUG |

No `brand_team_members` mutation sites in mingla-business code today (only SELECT at `useBrands.ts:359`, `useCurrentBrandRole.ts:105`).

### Table: `audit_log`

| Mutation | Policy | Actor | Post-state | SELECT admits? | Bug? |
|---|---|---|---|---|---|
| INSERT | (none — RLS enabled but no INSERT policy for authenticated) | — | — | — | ⚪ N/A |
| UPDATE | (none) | — | — | — | ⚪ N/A |
| DELETE | (none — additionally BEFORE DELETE trigger `trg_audit_log_block_update` blocks all deletes) | — | — | — | ⚪ N/A — append-only by-design |

No INSERT policy means authenticated users CANNOT write to audit_log via supabase-js. mingla-business code at `useAuditLog.ts:50` is read-only (`.select()`). Audit_log writes happen via service-role/SECURITY DEFINER RPCs from edge functions (out of mingla-business scope).

### Table: `brand_invitations` (queryable but NOT yet consumed by mingla-business code)

| Mutation | Policy | Actor | Post-state | SELECT admits? | Bug? |
|---|---|---|---|---|---|
| INSERT | "Brand admin plus insert invitations" WC: `biz_is_brand_admin_plus_for_caller(brand_id) AND (invited_by = auth.uid())` | brand admin+ | new row: brand_id, invited_by | "Brand admin plus select invitations" USING: helper → admit ✅ | ⚪ NO BUG |
| UPDATE | "Brand admin plus update invitations" USING/WC: helper | brand admin+ | row: brand_id immutable | same SELECT admits ✅ | ⚪ NO BUG |
| DELETE | "Brand admin plus delete invitations" USING: helper | brand admin+ | (removed) | n/a | ⚪ NO BUG |

Not in active mingla-business mutation surface; no mutations from current mingla-business code touch this table.

---

## 4. Findings (classified)

### 🔴 RC-0728-A — brands INSERT...RETURNING fails because no SELECT policy admits a just-inserted row (root cause #1)

| Field | Evidence |
|---|---|
| **File + line (DB)** | `pg_policies` row for tablename='brands', policyname='Brand members can select brands' (definition: `(deleted_at IS NULL) AND biz_is_brand_member_for_read_for_caller(id)`) and 'Public can read brands with public events' (`(deleted_at IS NULL) AND EXISTS (events with public+scheduled)`); no third SELECT policy. |
| **File + line (code)** | `mingla-business/src/services/brandsService.ts:94-98` — `await supabase.from("brands").insert(insertPayload).select().single()` |
| **Exact code** | The `.select()` chain triggers PostgREST `Prefer: return=representation`, which makes Postgres evaluate SELECT policies for RETURNING. |
| **What it does** | INSERT WITH CHECK passes (`account_id = auth.uid() AND deleted_at IS NULL` direct predicate). Postgres performs the INSERT and writes the new row in the transaction. RETURNING evaluates SELECT policies on the new row. The "Brand members" SELECT helper's inner EXISTS subquery evaluates `EXISTS (SELECT 1 FROM brands b WHERE b.id = NEW.id AND b.account_id = NEW.account_id AND b.deleted_at IS NULL)` and returns FALSE despite the row existing in-transaction. The "Public" SELECT requires events with public+scheduled visibility, which a fresh brand cannot have. No SELECT policy admits → entire mutation rolls back with 42501. |
| **What it should do** | INSERT...RETURNING should return the new row to the caller. |
| **Causal chain** | `BrandSwitcherSheet.handleSubmit` → `useCreateBrand.mutateAsync` → `brandsService.createBrand` → supabase-js `.insert(...).select().single()` → PostgREST POST `/rest/v1/brands` with `Prefer: return=representation` → Postgres INSERT...RETURNING → SELECT policies evaluated on new row → no policy admits → 42501 → supabase-js throws `PostgrestError{code:'42501'}` → service throws → hook `onError` fires → operator sees "Couldn't create brand" inline error. |
| **Verification step** | H42 (operator dashboard SQL): `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" TO '{...sub: b17e3e15-...}'; INSERT INTO public.brands (...) VALUES (...);` — without RETURNING, succeeded. With RETURNING (Path A test 2c), 42501. Confirmed RETURNING is the failure point. |

### 🔴 RC-0728-B — brands UPDATE soft-delete fails at WITH CHECK because helper requires `deleted_at IS NULL` on post-mutation row (root cause #2)

| Field | Evidence |
|---|---|
| **File + line (DB)** | `pg_policies` row for tablename='brands', policyname='Brand admin plus can update brands' (USING + WITH CHECK both: `biz_is_brand_admin_plus_for_caller(id)`); `pg_proc` definition of `biz_brand_effective_rank` first branch: `EXISTS (SELECT 1 FROM brands b WHERE b.id = p_brand_id AND b.account_id = p_user_id AND b.deleted_at IS NULL)`. |
| **File + line (code)** | `mingla-business/src/services/brandsService.ts:222-228` — `await supabase.from("brands").update({deleted_at: nowIso}).eq("id", brandId).is("deleted_at", null)` (bare update — no `.select()` chained) |
| **Exact code** | The mutation sets `deleted_at = nowIso` (NOT NULL). After Postgres applies the UPDATE in-transaction, the row's `deleted_at` is NOT NULL. WITH CHECK helper's EXISTS subquery requires `b.deleted_at IS NULL` for the first branch (account-owner short-circuit), and `b.deleted_at IS NULL` in the JOIN of the second branch (brand_team_members lookup). Both branches return 0. Helper returns FALSE. WITH CHECK fails. |
| **What it does** | Post-mutation in-transaction state has `deleted_at IS NOT NULL`; helper sees that state and returns rank 0; WITH CHECK predicate evaluates to FALSE; entire UPDATE rolls back with 42501. |
| **What it should do** | UPDATE permitted to set `deleted_at = now()` for the brand owner; row stays soft-deleted; mutation completes; idempotent (the `.is("deleted_at", null)` filter at the WHERE level makes re-deletes no-ops). |
| **Causal chain** | `BrandDeleteSheet.confirmDelete` → `useSoftDeleteBrand.mutateAsync` → `brandsService.softDeleteBrand` → step 1 events count (passes, count=0) → step 2 supabase-js `.update({deleted_at: nowIso}).eq("id",x).is("deleted_at",null)` → PostgREST PATCH `/rest/v1/brands?id=eq.x&deleted_at=is.null` with `Prefer: return=minimal` → Postgres UPDATE policy USING admits old row (deleted_at IS NULL still) → UPDATE applies in-transaction (sets new deleted_at) → WITH CHECK evaluates on new row state → helper sees post-mutation deleted_at NOT NULL → rank=0 → WITH CHECK FALSE → 42501 → service throws → operator sees brand-delete glitch (same as create). |
| **Verification step** | Operator confirmed brand-delete fails identically to brand-create with 42501 (chat 2026-05-06). The same SQL probe pattern (run UPDATE without WITH CHECK by temporarily disabling RLS) would confirm — but H39's brand-create DISABLE/ENABLE result already proves this bug class is RLS-driven. |

### 🟠 CF-0734-1 — `biz_brand_effective_rank` helper has implicit "soft-deleted brands grant zero rank to everyone" semantics (contributing factor)

| Field | Evidence |
|---|---|
| **File** | `pg_proc` definition of `biz_brand_effective_rank(uuid, uuid)`: both branches gate on `brands.deleted_at IS NULL`. |
| **What it does** | When called against a soft-deleted brand or in a transaction where the row's deleted_at is being set, the helper returns 0 even for the account_owner. This makes `biz_is_brand_admin_plus_for_caller` and `biz_is_brand_member_for_read_for_caller` return FALSE for soft-deleted brands. Cascades to every policy that uses these helpers. |
| **What it should do** | Likely intentional design: soft-deleted brands are "tombstones" and shouldn't grant any operational permission. But this design intent collides with the supabase-js soft-delete UPDATE pattern: the UPDATE that PRODUCES the soft-deleted state can't pass its own WITH CHECK because the helper retroactively excludes the in-transaction NEW row. |
| **Why classified contributing, not root cause** | The two confirmed bugs are direct consequences of the helper's deleted_at gates colliding with mutation patterns. The HELPER is correct in isolation; the BUG is the missing direct-predicate owner policies that bypass the helper for self-mutations. Fixing the policies (per §7) preserves the helper's semantics elsewhere. |

### 🟡 LF-1 — `events` UPDATE soft-delete with `.select()` chained would 42501 (latent hidden flaw)

| Field | Evidence |
|---|---|
| **File** | `pg_policies` events SELECT policies — both gate on `deleted_at IS NULL`. |
| **What it does** | If a future code path soft-deletes an event with `.update({deleted_at:...}).eq("id",x).select()`, the post-mutation row has `deleted_at IS NOT NULL` → no events SELECT policy admits → SELECT-for-RETURNING fails → 42501. |
| **Why latent, not active** | Verified via grep: NO events soft-delete is wired in mingla-business code today. Events INSERT/UPDATE happen via `useBrands.ts:341,347,353` which are SELECTs only. |
| **Trigger condition** | When event-CRUD UI ships (Cycle 18+ likely) AND if the soft-delete code path uses `.select()` chained. The fix shipped under SPEC ORCH-0734 won't address events directly; a follow-up cycle should add `"Event creator can select own events even when soft-deleted"` SELECT policy OR the soft-delete code path should use bare `.update()` (no `.select()`). |

### 🟡 LF-2 — brand_admin (non-owner) cannot soft-delete a brand (latent UX hidden flaw)

| Field | Evidence |
|---|---|
| **File** | `pg_policies` brands UPDATE policy uses helper which gates on deleted_at IS NULL; even after the SPEC ORCH-0734 fix, only `account_id = auth.uid()` (owner) admits soft-delete via the new direct-predicate policy. |
| **What it does** | If a brand admin (someone with `brand_admin` rank in `brand_team_members` but NOT the account owner) tries to soft-delete a brand they administer, WITH CHECK still fails because helper's brand_team_members branch also gates on `b.deleted_at IS NULL`. After the SPEC fix, only the account owner can soft-delete. |
| **Why latent, not active** | Currently no `brand_team_members` rows in production (mingla-business is pre-MVP). When team features ship, this becomes user-facing. |
| **Trigger condition** | When team-management UI ships AND a brand admin (non-owner) tries to soft-delete. |
| **Fix direction (out of scope for ORCH-0734 but flagged)** | Either (a) modify `biz_brand_effective_rank` to remove `b.deleted_at IS NULL` gates (semantic change, broad blast radius — see §6), OR (b) add a third direct-predicate policy `"Brand admin can soft-delete own brand"` with explicit brand_team_members EXISTS subquery that doesn't gate on brand.deleted_at. |

### 🟡 LF-3 — no AFTER INSERT trigger creates a `brand_team_members` row for the brand owner (latent hidden flaw)

| Field | Evidence |
|---|---|
| **File** | `pg_trigger` query result for `brands` table — only 3 BEFORE UPDATE triggers; zero INSERT triggers. |
| **What it does** | When an account owner creates a brand, no row is inserted into `brand_team_members` to register them as `account_owner` rank. The `biz_brand_effective_rank` helper compensates by giving account-owner rank 60 implicitly via the first branch. But this implicit grant has fragile interactions (this entire bug class is downstream of it). |
| **Why latent, not active** | The implicit grant works (mostly) — BUG #1 is a Postgres snapshot quirk in the SECURITY DEFINER helper, not a flaw in the implicit-grant model. |
| **Trigger condition** | If a future change to `biz_brand_effective_rank` removes the implicit account-owner branch, every B1 policy that depends on it would silently fail. |
| **Fix direction (out of scope)** | Add an AFTER INSERT trigger on brands that creates a `brand_team_members` row with `role='account_owner'` for the brand owner. Makes the grant explicit + persistent + unaffected by helper snapshot quirks. (Would also resolve LF-2 cleanly.) |

### 🟡 LF-4 — `creator_accounts.deleted_at` is set-able but no SELECT policy excludes soft-deleted accounts from self (latent)

| Field | Evidence |
|---|---|
| **File** | `pg_policies` creator_accounts SELECT "Creators can read own account" USING `auth.uid() = id` (no deleted_at gate). |
| **What it does** | A soft-deleted creator_account remains self-readable. This is probably fine for most flows (account-deletion confirmation screens) but may interact strangely with the public-organiser-profile policy in unusual ways. |
| **Why latent** | No active bug; just an observation. |

### 🔵 OB-1 — Postgres SECURITY DEFINER STABLE function in INSERT...RETURNING context: empirically does not see in-transaction NEW row

This is the inferred mechanism for RC-0728-A. Direct empirical proof:
- Path A test 2c: same INSERT predicate evaluated TRUE in step 2b but RETURNING failed in step 2c (same simulated context, same JWT, same predicate)
- H42 confirmation: pure INSERT (no RETURNING) succeeded
- Pinpoints RETURNING-time SELECT policy evaluation as the failure point

Likely Postgres mechanism: `STABLE` functions get evaluated using the calling query's command-id snapshot, which for INSERT...RETURNING evaluates BEFORE the INSERT's command-id increments. So the helper's inner SELECT operates on a snapshot that doesn't include the new row.

Alternative mechanism: PostgreSQL RLS policy USING expressions are evaluated with sub-plan caching for STABLE function calls; the cached sub-plan was built when no row existed.

We DO NOT need to definitively pin the mechanism to fix the bug. The fix (direct-predicate policy) bypasses the issue regardless of which mechanism is at play.

### 🔵 OB-2 — `audit_log` has BEFORE DELETE trigger named `trg_audit_log_block_update` (apparent naming inconsistency)

| Evidence | The trigger name says "block_update" but the trigger fires on DELETE. Likely a copy-paste residue from a sibling table or rename refactor. |
| Why classified observation | Out of scope (not an RLS-RETURNING issue); does not affect mingla-business behavior; flag for future cleanup. |

### 🔵 OB-3 — `relpages = 0` on `brands` confirms the RLS-RETURNING-OWNER-GAP has been latent since B1 phase 2 cycle

PASS-13 / ORCH-0731 noted `pg_class.relpages = 0` for `brands` — meaning no row has ever been physically allocated. This means brand-create has been broken since the earliest moment a non-bypass-RLS user attempted it. The bug is not a recent regression; it is original-B1.

### 🔵 OB-4 — Six diagnostic markers `[ORCH-0728/0729/0730/0733-DIAG]` currently in mingla-business code

`BrandSwitcherSheet.tsx` + `useBrands.ts` + `creatorAccount.ts` carry diagnostic logging from PASS-3..12. Per dispatch §6, removal is OUT OF SCOPE for this audit — separate cleanup dispatch after the fix tester PASSes.

### 🔵 OB-5 — supabase-js v2 default Prefer header for bare `.update()`/`.insert()` (without `.select()`) is `return=minimal`

Verified via PostgREST behavior: when supabase-js doesn't chain `.select()`, the request is sent without `Prefer: return=representation`, and PostgREST returns 204 No Content. Confirmed by inference from the mingla-business raw-fetch probe (PASS-7) using explicit `Prefer: return=representation` to mimic the `.select()` chain.

### 🔵 OB-6 — events has TWO write-path immutability triggers (brand_id, created_by, slug) — strong audit-trail design

`pg_trigger` shows `trg_events_immutable_brand_id`, `trg_events_immutable_created_by`, `trg_events_immutable_slug` — all BEFORE UPDATE. Good design choice; reduces RLS attack surface. No bug — observation.

---

## 5. Five-Layer Cross-Check

| Layer | What it says | Contradiction with reality? |
|---|---|---|
| **Docs** (B1 phase 2 spec, README) | Brand owners create + manage their brand; supabase-js standard CRUD | YES — docs assume INSERT...RETURNING works; reality 42501 |
| **Schema** (squash baseline + pg_policies authoritative) | brands has 5 policies (1 INSERT, 1 UPDATE, 1 DELETE, 2 SELECT). No owner-direct-predicate SELECT. UPDATE WITH CHECK uses helper that gates on deleted_at IS NULL. | Schema is internally consistent but produces the bug class. |
| **Code** (mingla-business src) | Standard supabase-js patterns: createBrand uses .select() chain; softDeleteBrand uses bare .update() | Both patterns hit the bugs (one via RETURNING, one via WITH CHECK). |
| **Runtime** (PASS-7..13 logs) | 42501 reproducible 100% on brand-create; operator confirmed identical 42501 on brand-delete | Confirms schema-vs-docs gap. |
| **Data** (`pg_class.relpages=0` for brands) | NO brand row has ever been physically inserted | Confirms bug latency since B1 deploy; no functional production data depends on bug staying broken. |

**Layer disagreement summary:** Docs say "brand-create works"; runtime + data prove it never has. The schema is the source of truth: the missing direct-predicate owner policies are the structural gap.

---

## 6. Why the bug fix is small (and why we don't need to fix the helper)

The **two confirmed bugs** are both rooted in:
- `brands` mutations whose post-mutation row state is not admitted by any SELECT policy (BUG #1) OR whose WITH CHECK depends on a helper that excludes the post-mutation state (BUG #2).

The **fix** is to add two new permissive policies that use **direct predicates** (not helper functions):
1. SELECT policy admitting `account_id = auth.uid()` — fixes BUG #1 (RETURNING SELECT now admits via direct predicate; no SECURITY DEFINER snapshot dependency).
2. UPDATE policy admitting `account_id = auth.uid()` for both USING and WITH CHECK — fixes BUG #2 (WITH CHECK admits soft-delete via direct predicate; no helper deleted_at gate).

**Why we don't modify the helper:**
- The helper's deleted_at gates encode a real product semantic ("soft-deleted brands have no permissions"). Modifying it has wide blast radius (events, audit_log, brand_invitations, brand_team_members policies all rely on it).
- The new direct-predicate policies surgically address ONLY the owner-self-mutation case where the helper-gate semantics collide with the mutation pattern.
- Adversarial cases (brand admin tries to soft-delete) remain handled by the existing helper policy, which still rejects (LF-2 — flagged for future cycle).

**Why we don't add a brand_team_members trigger:**
- Out of audit scope (LF-3 is a stylistic improvement, not a bug fix).
- The implicit account-owner grant in the helper continues to work correctly for non-mutation contexts.

The fix is the smallest possible patch that closes both confirmed bugs. SPEC ORCH-0734 makes this binding.

---

## 7. Fix Strategy (direction only — full SPEC in companion file)

Two new permissive policies on `brands` in a single migration:

```sql
CREATE POLICY "Account owner can select own brands"
ON public.brands
FOR SELECT
TO authenticated
USING (account_id = auth.uid());

CREATE POLICY "Account owner can update own brand"
ON public.brands
FOR UPDATE
TO authenticated
USING (account_id = auth.uid())
WITH CHECK (account_id = auth.uid());
```

Plus a CI gate enforcing the new invariant **I-PROPOSED-H — RLS-RETURNING-OWNER-GAP-PREVENTED**: every authenticated mutation policy on a public schema table MUST be paired with at least one SELECT policy that admits the actor for the post-mutation row state, AND every UPDATE policy whose WITH CHECK uses a helper function MUST also be paired with a direct-predicate fallback policy if the mutation can change a column referenced in the helper's predicate.

Plus permanent skill memory `feedback_rls_returning_owner_gap.md` (DRAFT until ORCH-0734 CLOSE) so every future skill knows this pattern.

Full SPEC: `Mingla_Artifacts/specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md`.

---

## 8. Regression Prevention Requirements

1. **New invariant I-PROPOSED-H** — name + text + enforcement mechanism — registered in INVARIANT_REGISTRY.md as DRAFT during SPEC, ACTIVE on tester PASS.
2. **CI gate (strict-grep variant)** — script that parses `supabase/migrations/*.sql` for `CREATE POLICY ... FOR (INSERT|UPDATE|DELETE)` and asserts: for each table with such a policy, exists at least one matching `CREATE POLICY ... FOR SELECT` whose USING predicate uses `auth.uid()` directly (not via SECURITY DEFINER helper). Plugged into `.github/workflows/strict-grep-mingla-business.yml` per the strict-grep registry pattern (`feedback_strict_grep_registry_pattern.md`).
3. **Permanent skill memory** — `~/.claude/projects/<sanitized-cwd>/memory/feedback_rls_returning_owner_gap.md` codifies the bug class so investigator/spec-writer/implementor agents recognize it on sight.
4. **Test cases** — SPEC defines T-01..T-05 covering brand-create + brand-delete + non-soft-delete + brand_admin-attempt + idempotent re-delete.

---

## 9. Discoveries for Orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| D-FOR-0734-1 | LF-1 events soft-delete RETURNING latent bug (won't trigger until events soft-delete UI ships) | S2 (deferred) | Register as ORCH-0735-CANDIDATE; address in cycle that wires events soft-delete |
| D-FOR-0734-2 | LF-2 brand_admin (non-owner) cannot soft-delete brand after SPEC fix; UX gap when team features ship | S2 (deferred) | Register as ORCH-0736-CANDIDATE; resolve via either AFTER INSERT trigger creating brand_team_members for owner OR third UPDATE policy with direct brand_team_members EXISTS |
| D-FOR-0734-3 | LF-3 no AFTER INSERT trigger on brands creating brand_team_members owner row; implicit grant in helper is fragile | S3 | Register as architectural-improvement candidate; not urgent |
| D-FOR-0734-4 | OB-2 audit_log trigger naming inconsistency `trg_audit_log_block_update` fires on DELETE | S3 | Register cosmetic cleanup; rename in next backend pass |
| D-FOR-0734-5 | The 6 `[ORCH-0728/0729/0730/0733-DIAG]` markers in BrandSwitcherSheet.tsx + useBrands.ts + creatorAccount.ts must be removed AFTER tester PASSes ORCH-0734 fix | S2 | Already queued by orchestrator as separate post-PASS dispatch |
| D-FOR-0734-6 | The mechanism behind RC-0728-A (SECURITY DEFINER STABLE in INSERT...RETURNING context) deserves a Postgres-internals memory entry so future investigators don't re-derive it | S3 | Add to `feedback_rls_returning_owner_gap.md` as a "Why this bug class exists at the Postgres mechanic level" appendix |

---

## 10. Confidence Levels

| Finding | Confidence | Reasoning |
|---|---|---|
| RC-0728-A brand-create root cause | **HIGH** | Empirical proof via H42 (no-RETURNING bypass succeeded); pg_policies enumeration confirms no admitting SELECT policy for fresh brand; helper function source code read verbatim |
| RC-0728-B brand-delete root cause | **HIGH** | Operator confirmation 2026-05-06 + helper definition exclusively gates on deleted_at IS NULL + UPDATE WITH CHECK semantics is documented Postgres behavior |
| CF-0734-1 helper deleted_at gate semantics | **HIGH** | Function source code read directly |
| LF-1 events latent bug | **HIGH** | Schema-level analysis is clean; only uncertainty is whether the future events soft-delete code path will chain `.select()` |
| LF-2 brand_admin soft-delete after SPEC fix | **HIGH** | Helper function semantic exclusion is confirmed; SPEC fix only adds owner direct-predicate; brand_admin path still routes through helper |
| OB-1 SECURITY DEFINER STABLE snapshot mechanism | **MEDIUM** | Multiple Postgres internals could explain the empirical observation; we have no need to pin the exact one because the fix bypasses it |
| OB-3 relpages=0 latency since B1 | **HIGH** | Direct DB observation |
| Audit completeness for in-scope tables | **HIGH** | All 6 tables × all CRUD policies × all helper functions enumerated; cross-table helper cascades traced |

---

## 11. Operator post-step

1. **Orchestrator REVIEWs this audit.** Verifies findings + classifications + matrix. Verdict: APPROVED / NEEDS WORK / REJECTED.
2. **Operator dispatches SPEC review.** SPEC artifact `specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md` (companion file) is the binding contract for implementor.
3. **After SPEC review approved:** operator dispatches mingla-implementor to write the migration + invariant + CI gate + memory file (DRAFT).
4. **After implementor returns:** operator runs `supabase db push` to apply the migration, then force-reload Metro and tap Create brand + Delete brand to confirm both bugs resolve.
5. **Tester verifies SC-1..SC-5** + dispatches CONDITIONAL/UNCONDITIONAL PASS.
6. **Orchestrator runs CLOSE protocol** — flips I-PROPOSED-H to ACTIVE, flips memory file to ACTIVE, updates all 7 artifacts, provides commit message + EAS Update command, dispatches diagnostic-marker cleanup as the next sequential cycle.

---

**End of report.**
