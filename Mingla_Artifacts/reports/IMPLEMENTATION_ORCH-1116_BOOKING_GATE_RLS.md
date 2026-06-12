# IMPLEMENTATION — ORCH-1116: Public paid-event booking gate false-positive (booking-gate-RLS)

**Status:** implemented and verified (text-layer + behavioral fails-on-revert both proven against the LIVE pre-fix function; migration NOT applied — orchestrator applies per safe-migration protocol).
**Phase:** mingla-implementor (build) → routes back to orchestrator for REVIEW → mingla-tester.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1116-[booking-gate-rls]/` on branch `ORCH-1116-booking-gate-rls` (even with origin/main, 0/0).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1116_BOOKING_GATE_RLS.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1116_BOOKING_GATE_FALSE_POSITIVE.md`

---

## 1. Summary

A logged-out (anon) or non-owner authenticated buyer who opened a public paid event/experience/trip page saw "Booking unavailable right now — this organizer is finishing their payment setup" with a dead Get-Tickets CTA, even for a fully Stripe-active brand. Root cause (forensics, proven live): the shared buyer-readiness predicate `pg_brand_can_charge(uuid)` was `SECURITY INVOKER` and read the RLS-protected `stripe_connect_accounts` table, whose only SELECT policy is scoped to `{authenticated}` brand-payments-admins — so a buyer's call saw 0 rows and got `false`. The batched sibling `pg_brands_can_charge(uuid[])` inherited the same defect.

The fix is a single backend migration that converts BOTH predicates from `SECURITY INVOKER` → `SECURITY DEFINER` with `SET search_path = ''` (every identifier schema-qualified). The boolean logic is byte-identical; the functions still return only the boolean / the subset of supplied brand-ids (no `stripe_connect_accounts` row field ever crosses to the caller). All affected buyer surfaces (web event, web brand feed, web experience, consumer-app brand page) inherit the fix with zero client edits.

Two regression safeguards ship in the SAME branch: an anon-role **behavioral** SQL test that asserts the RETURN VALUE (not merely the EXECUTE grant — the exact ORCH-1076 CI gap), and a **strict-grep** gate that asserts both predicates stay `SECURITY DEFINER` + `search_path` at the text layer.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | How verified | Verdict | Commit |
|----|-----------|--------------|---------|--------|
| SC-1 | anon true-positive: `pg_brand_can_charge(ready)` = true | G-01 behavioral test (post-apply); fails-on-revert proven live (pre-fix anon=false) | ✓ (locked by test; lands on apply) | `<MIG>` `<TEST>` |
| SC-2 | anon true-negative preserved: not-ready → false | G-02 (no-account / charges-off / detached all assert false); boolean logic byte-identical | ✓ | `<MIG>` `<TEST>` |
| SC-3 | authenticated non-owner true-positive | G-01b (`SET LOCAL ROLE authenticated` + non-owner claims → true) | ✓ | `<TEST>` |
| SC-4 | batched anon returns only the ready id | G-03 (`array_agg` == `ARRAY[ready]`) | ✓ | `<MIG>` `<TEST>` |
| SC-5 | no row leak; RETURNS shape unchanged | G-04 (anon `count(*)` on base table = 0); RETURNS `boolean` / `TABLE(brand_id uuid)` unchanged (no DROP) | ✓ | `<MIG>` `<TEST>` |
| SC-6 | both DEFINER; proconfig has search_path | G-00 catalog probe (`prosecdef`=true + `search_path=` in proconfig); strict-grep gate at text layer | ✓ | `<MIG>` `<TEST>` `<GATE>` |
| SC-7 | supply RPCs unchanged | DO-NOT-TOUCH honored — the five supply RPCs not edited; their nested DEFINER-calls-DEFINER path unchanged; existing ORCH-1076 test still applies | ✓ | n/a (untouched) |
| SC-8 | Leggo live: anon `pg_brand_can_charge(22a18413…)` = true post-apply | Tester live-fire (web `/e/leggothis/the-party-block`) after orchestrator applies | DEFERRED to tester (requires apply) | — |

Live pre-apply probe (read-only, MCP `execute_sql`): both predicates `prosecdef=false`, `proconfig=null` (the bug); superuser `pg_brand_can_charge(Leggo)=true`; **anon `pg_brand_can_charge(Leggo)=false`, anon_visible_rows=0** — the false-positive reproduced, and the exact value G-01 RAISEs on (fails-on-revert).

---

## 3. Files changed

| File | Type | Δ lines |
|------|------|---------|
| `supabase/migrations/20260927000000_orch_1116_booking_gate_rls.sql` | CREATE | +124 |
| `supabase/migrations/__tests__/orch_1116_booking_gate_rls.test.sql` | CREATE | +258 |
| `.github/scripts/strict-grep/orch-1116-booking-gate-security-definer.mjs` | CREATE | +236 |
| `.github/workflows/strict-grep-mingla-business.yml` | MODIFY (register gate) | +14 |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | MODIFY (C7 allowlist additive) | +14 |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1116_BOOKING_GATE_RLS.md` | CREATE | (this file) |

All strictly within SPEC §11 allowlist. No DO-NOT-TOUCH file touched.

---

## 4. Data-model changes applied

None to schema/tables/RLS. Two existing functions re-emitted via `CREATE OR REPLACE` (no DROP — signatures + RETURNS unchanged):

- `public.pg_brand_can_charge(uuid)` → `SECURITY DEFINER`, `SET search_path = ''`, body schema-qualified (`public.stripe_connect_accounts`). Boolean logic byte-identical (`detached_at IS NULL`, `stripe_account_id IS NOT NULL`, `charges_enabled IS DISTINCT FROM false`). Grants re-asserted: `anon, authenticated`. Comment corrected.
- `public.pg_brands_can_charge(uuid[])` → `SECURITY DEFINER`, `SET search_path = ''`, `pg_catalog.unnest` qualified, delegates to `public.pg_brand_can_charge(bid)`. Grants re-asserted: `anon, authenticated, service_role`. Comment corrected.

The RLS policy on `stripe_connect_accounts` is UNCHANGED (base-table buyer-invisibility preserved; the fix grants only the derived boolean via definer privilege).

---

## 5. Edge functions touched

None. No edge function edited. For the orchestrator's awareness (NO redeploy needed — pure DB change): the affected callers (`publicEventsService.ts`, `publicExperienceService.ts`, `useBrandBySlug.ts`) and the service-role caller (`discover-merged-events`, `verify_jwt` unchanged) all inherit the fix at the DB layer with no code change.

---

## 6. Regression tests added

**Behavioral SQL test:** `supabase/migrations/__tests__/orch_1116_booking_gate_rls.test.sql` (G-00 catalog, G-01 anon true-positive [the fails-on-revert case], G-01b authenticated non-owner, G-02 anon true-negative ×3 shapes, G-03 batched anon, G-04 no-leak). Seeds fixtures as superuser inside ROLLBACK transactions; wraps ONLY the RPC assertion in `SET LOCAL ROLE anon` / `authenticated`. Asserts the RETURN VALUE — NOT merely the EXECUTE grant (the ORCH-1076 gap).

**Strict-grep gate:** `.github/scripts/strict-grep/orch-1116-booking-gate-security-definer.mjs` — finds the latest defining migration for each predicate, slices its body, asserts BOTH `SECURITY DEFINER` AND `search_path` (case-insensitive). `--self-test` passes (7 fixtures incl. the INVOKER bug shape). Registered in `strict-grep-mingla-business.yml`.

**fails-on-revert verified (TWO layers):**
- *Text layer:* with the new migration moved aside, the gate falls to the pre-fix ORCH-1075/1076 INVOKER bodies and FAILS (exit 1) for both predicates; restored → passes (exit 0). Verified at commit `<GATE>`.
- *Behavioral layer (against the LIVE pre-fix function, read-only):* anon `pg_brand_can_charge('22a18413-bfbf-4087-9ba7-45f70deba0f3')` returns **false** with **0** visible rows under the current INVOKER definition — the exact value G-01's `IS NOT TRUE` branch RAISEs on. The test therefore FAILS against the reverted (current) state and PASSES only once the SECURITY DEFINER migration applies. (I did not apply the migration — hard guard — so the post-apply PASS is locked for the orchestrator's post-apply probe + the tester.)

---

## 7. Old → New receipts

### `pg_brand_can_charge(uuid)` (in the new migration)
**Before:** `SECURITY INVOKER` (default), no `search_path`; body read `public.stripe_connect_accounts` under the caller's RLS → buyers saw 0 rows → returned false for ready brands.
**Now:** `SECURITY DEFINER` + `SET search_path = ''`; body runs as `postgres` (RLS-exempt) and returns only the boolean; identical EXISTS logic.
**Why:** SC-1/SC-3/SC-5/SC-6 — fix the false-positive without exposing any row data.
**Lines:** ~30 (function block + grant + comment).

### `pg_brands_can_charge(uuid[])` (in the new migration)
**Before:** `SECURITY INVOKER`, `unnest` unqualified; inherited the false-positive per element.
**Now:** `SECURITY DEFINER` + `SET search_path = ''`, `pg_catalog.unnest`, delegates to the (now-DEFINER) inner predicate.
**Why:** SC-4 + defense-in-depth (correctness independent of the inner mode) + the gate asserts both.
**Lines:** ~25.

### `orch-0863-marketing-hub-phase-b.mjs` (C7 allowlist)
**Before:** C7 no-new-backend-files union did not list the ORCH-1116 backend files.
**Now:** adds `ORCH_1116_BACKEND_ALLOWLIST` (migration + behavioral test) and spreads it into the union.
**Why:** the C7 check fails on ANY new `supabase/migrations/**` file in the PR diff not allowlisted; ORCH-1110/1111 set this convention (COMMS-0002 / COMMS-0023). Without it, my PR fails the unrelated ORCH-0863 gate.
**Lines:** +14.

### `strict-grep-mingla-business.yml`
**Before:** no job for the ORCH-1116 gate.
**Now:** registers `orch-1116-booking-gate-security-definer` (self-test + real run) after the ORCH-1076 job.
**Why:** SPEC §8 step 4.
**Lines:** +14.

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | YES — brand-page feed (`useBrandBySlug`, buyer JWT) inherits fix | Automatic (shared RPC) |
| 2 | Consumer Android | YES — same | Automatic (shared RPC) |
| 3 | Buyer/anon Web (primary repro) | YES — event/experience/trip page + brand feed inherit fix | Automatic (shared RPC) |
| 4 | Business iOS | NO — owner reads go through DEFINER publish RPCs + client store | N/A |
| 5 | Business Android | NO — same | N/A |
| 6 | Admin Web | NO — does not read the buyer predicate | N/A |
| 7 | Business Web preview | NO — owner-context client store | N/A |

Parity is automatic for all three affected surfaces: the only point of repair is the single shared DB predicate; no client code is duplicated or edited.

---

## 9. Smoke result

No app/sim build (pure backend RLS change — no bundle touched). Verification was DB-layer:
- Strict-grep gate: `--self-test` PASS (exit 0); real-mode PASS against the new migration (exit 0); fails-on-revert PASS (exit 1 with migration removed).
- ORCH-0863 gate: `node --check` OK + `--self-test` PASS after the allowlist addition (no duplicate-declaration crash).
- Live read-only probe: pre-fix state reproduced (anon=false, superuser=true, 0 visible rows) — fails-on-revert proven behaviorally.
- Migration structure: 4 balanced `$function$` delimiters, each terminated `;` before its GRANT; `BEGIN;`/`COMMIT;` wrap; both grants + comments present.

---

## 10. Known issues / deferred

- **SC-8 live-fire deferred to the tester** (requires the migration to be applied; the implementor does not apply). The orchestrator's post-apply probe + the tester's web/consumer live-fire close it.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

**The implementor did NOT run `supabase db push` and did NOT apply the migration.** Apply via the Supabase Management API (CLI is drift-wedged; MCP `apply_migration` / Management API is the apply path), then run the post-apply behavioral probe.

Copy-paste fallback (if the CLI path is ever un-wedged):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1116-[booking-gate-rls]" && /Users/sethogieva/bin/supabase db push --linked
```
Migration is monotonic (`20260927000000` > current max `20260926000000`); no `--include-all` needed.

**Edge-fn deploy list:** NONE. No edge function changed; no redeploy required. Affected surfaces inherit the fix the moment the migration applies.

**Post-apply probe (orchestrator):** `SET ROLE anon; SELECT public.pg_brand_can_charge('22a18413-bfbf-4087-9ba7-45f70deba0f3');` must return `true` (was `false`). Then flip `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER` DRAFT → ACTIVE at CLOSE.

---

## 12. Discoveries for Orchestrator

- **D-A (ORCH-ID collision — three ORCH-1116 worktrees):** `~/Desktop/mingla-orchs/` contains `ORCH-1116-[booking-gate-rls]` (this), `ORCH-1116-[gif-cover-key]`, and `ORCH-1116-[hub-multiselect-draft-delete]` — three different features sharing the ORCH-1116 number. None has a migration colliding with mine (`20260927000000` is free across all). Per the shipped-first/INTAKE-ID-scan rule, the orchestrator should renumber two of the three before they ship to avoid a COMMS-0023-style collision. My dispatch was unambiguous (booking-gate-rls); I proceeded.
- **D-B (C7 allowlist is a growing global chokepoint):** every ORCH that adds a `supabase/migrations/**` or `supabase/functions/**` file must register a `ORCH_NNNN_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs` or the ORCH-0863 C7 gate fails the unrelated PR. This is documented behavior (COMMS-0002) but it couples every backend ORCH to one marketing-scoped gate file — a known re-scope-to-`Close ORCH-0863` follow-up is noted in the gate's own comments. Flagging for the orchestrator's awareness; not in scope to fix here.
- **D-C (proposed invariant ready to flip):** SPEC §10's `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER` is now enforced by both the gate and the behavioral test; ready to flip DRAFT → ACTIVE at CLOSE.
