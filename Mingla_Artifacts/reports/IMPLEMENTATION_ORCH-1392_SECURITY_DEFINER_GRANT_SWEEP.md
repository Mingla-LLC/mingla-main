# IMPLEMENTATION — ORCH-1392 [SECURITY DEFINER grant-hygiene sweep — durable fix]

- **Phase:** IMPLEMENT. Built the 5 SPEC-allowlisted files in §8 order. NO prod apply (orchestrator applies at CLOSE).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]/` on branch `ORCH-1392-security-definer-grant-sweep` (rebased onto current `origin/main`).
- **Fix commit:** `ffa57ff2b8fb9282a6ffa071e5c90080123678bd` (all 5 files, one commit). Report commit follows.
- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1392_SECURITY_DEFINER_GRANT_SWEEP.md` (`974bcc4f7`).
- **Self-verify DB:** CI Supabase-Postgres `supabase/postgres:17.4.1.075` booted locally via Docker (SPEC §8 step 2 satisfied — NOT faked).
- **Status:** implemented and self-verified. ONE implementor-proposed SPEC amendment (Section B2, 4 residual leakers) awaits REVIEW ratification — see Discoveries.

---

## 1. Summary (plain English)

The 2026-07-18 emergency hot-patch closed 7 live anonymous exploits by changing grants directly on the production database — but nothing captured that in code, so a fresh database (or any restore) would re-open every hole. This migration makes the fix permanent and idempotent, extends it to the remaining Tier-2 leakers the investigation found, adds two internal auth gates that grants alone can't provide, and ships a CI gate that will fail any future build the instant a new SECURITY DEFINER function becomes callable by anonymous users without being consciously allowlisted. No app screen changes; the only observable effect is that the closed exploits stay closed. During implementation I also found and closed 4 more functions of the exact same leak class that the investigation's list had missed (flagged for your ratification).

## 2. SPEC success-criteria coverage

| SC | Criterion | Result | Evidence (commit `ffa57ff2b`) |
|----|-----------|--------|-------------------------------|
| SC-1 | Hot-patch codified (7 fns anon=false; 3 webhook/internal also authed=false, svc=true) | ✓ | Section C DO-block asserted on CI boot: "all 45 grant end-states asserted". |
| SC-2 | Tier-2 svc-only (Group-1, 23): anon=f, authed=f, svc=t | ✓ | DO-block (26 svc-only incl. B2) passed. |
| SC-3 | Tier-2 authenticated (Group-2, 18): anon=f, authed=t | ✓ | DO-block (19 authed incl. B2) passed. |
| SC-4 | Intended-public spared (anon=t retained) | ✓ | Gate probe shows all §4.4 fns anon-exec + allowlisted → green. |
| SC-5 | `fetch_user_going_rsvps` gate transparent | ✓ (source) / UNVERIFIED (runtime) | A-1 guard `auth.uid() IS DISTINCT FROM p_user_id`; sole caller `calendarService.ts:517` passes own id. Live T-5/T-6/T-7 = tester. |
| SC-6 | `get_admin_emails` gate transparent | ✓ (source) / UNVERIFIED (runtime) | A-2 `IF NOT public.is_admin_user() THEN RETURN`; sole caller `AuthContext.jsx:129` maps `data \|\| []`, no svc-role caller. Live T-8/T-9/T-10 = tester. |
| SC-7 | Idempotent (re-run = no-op) | ✓ | Re-applied migration on already-migrated CI DB → same NOTICE, no error, DO-block passed, gate stayed green. |
| SC-8 | CI gate green on truth | ✓ | `security_definer_anon_gate.sh` on CI DB post-migration: `OK: 184 anon-executable definer functions, all allowlisted` (exit 0). |
| SC-9 | CI gate self-tests (fails on injected leaker) | ✓ | Injected `_orch1392_gate_selftest()` (inherited anon) → gate exit 1 naming it → dropped → exit 0. |
| SC-10 | No re-widening (zero `GRANT … TO anon`) | ✓ | Static test "SC-10" green; grep confirms zero `GRANT EXECUTE … TO … anon`. |
| SC-11 | Fails-on-revert (static) | ✓ | Deleted REVOKE line for `mark_partner_split_transferred` → 2 assertions RED; restored → 6/6 green. |
| SC-12 | Fails-on-revert (runtime) | ✓ | Negative control (SC-9) IS the runtime fails-on-revert: re-granting anon / adding an unallowlisted anon-exec fn → gate red. |

Surface split N/A — DB ACL is a single shared enforcement point (no per-surface code path).

## 3. Files changed (all NEW; append-only; +0 deletions to existing files)

| File | Lines | Role |
|------|-------|------|
| `supabase/migrations/20270104000000_orch_1392_security_definer_grant_sweep.sql` | ~330 | The one migration: 2 body gates + 45 REVOKE/GRANT + 45-assert DO-block. |
| `supabase/security/anon_executable_definer_allowlist.txt` | 184 sigs + headers | Deterministically generated acceptable anon-exec remainder. |
| `scripts/ci/security_definer_anon_gate.sh` | ~95 | Live `has_function_privilege('anon',…)` probe gate. |
| `.github/workflows/security-definer-anon-grant-gate.yml` | ~120 | seed → apply → gate → negative-control → re-check. |
| `supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts` | ~215 | Static migration-text regression (6 tests). |

## 4. Data-model changes applied

None to tables/columns/constraints/indexes/RLS. Only: 2 `CREATE OR REPLACE FUNCTION` (semantics-preserving — identical signature + query; guard prepended; `LANGUAGE sql→plpgsql`; `get_admin_emails` gains `SET search_path TO 'public'`) + 45 EXECUTE-grant reductions. No table DDL, no DROP.

**Grant end-state (45 functions):** 26 → service_role only (anon+authenticated revoked); 19 → authenticated (anon revoked). Full matrix in §Appendix.

## 5. Edge functions touched

None modified. **For deploy at CLOSE:** none — this ORCH deploys no edge function. (The `scan-ticket`, `delete-user`, `upsert-leaderboard-presence` edge fns CALL some of the revoked fns as service_role and are unaffected — service_role retains EXECUTE on all 45.)

## 6. Regression tests added

- **Static (implementor happy-path):** `supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts` — 6 tests, all green (`deno test --allow-read`). Asserts: all 45 fns REVOKE anon; the 26 svc-only also REVOKE authenticated; the 19 authed do NOT strip authenticated; zero `GRANT … TO anon`; both body-gate guard tokens + both `CREATE OR REPLACE` present; Section B2 remediation present. Comments stripped before matching (COMMS-0106).
- **fails-on-revert verified at `ffa57ff2b`:** true LINE DELETION (not comment-out) of the `mark_partner_split_transferred` REVOKE line → "all 45 revoked functions REVOKE anon" and "the 26 service_role-only functions ALSO REVOKE authenticated" both FAILED (4 passed / 2 failed); line restored → 6/6 green.
- **Runtime sibling (this is the OTHER required half, SPEC §9):** the live gate + negative control — proven on the CI DB (SC-8/SC-9). The static test cannot see the implicit default-privileges anon grant (F-6), which is exactly why both are required.
- Tester writes the SECOND adversarial angle (live-fire the 41 end-states + the 2 gate bodies + admin-console/Calendar device checks) at TEST.

## 7. Old → New receipts

### `supabase/migrations/20270104000000_…sql` (NEW)
- **Before:** the 7 HIGH grants were hot-patched LIVE on prod (grants-only, not in any migration); the 34 Tier-2 leakers + 4 residual leakers were still anon-executable; `fetch_user_going_rsvps` / `get_admin_emails` had no internal auth gate.
- **Now:** an idempotent migration re-asserts the 7, revokes the 34 Tier-2 + 4 residual, and adds the 2 internal gates — converging any fresh env to the intended ACL. Grants-first-after-CREATE-OR-REPLACE; ZERO `GRANT … TO anon`; 45-assert fail-closed DO-block.
- **Why:** SPEC §4.1 + SC-1..SC-3, SC-5..SC-7, SC-10; makes the emergency hot-patch durable (COMMS-0110).

### `public.fetch_user_going_rsvps(uuid)` (CREATE OR REPLACE, A-1)
- **Before:** `LANGUAGE sql`, no gate — returned any caller-supplied user's "going" RSVPs **including qr_code** (the HIGH QR-exfil leak).
- **Now:** `LANGUAGE plpgsql`; prepends `IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN RAISE 42501`; the two-branch UNION ALL body is copied VERBATIM from prod `pg_get_functiondef`. service_role (auth.uid() NULL) bypasses; authenticated may read only own rows.
- **Why:** SPEC A-1 / SC-5. Transparent to `calendarService.ts:517` (passes own id).

### `public.get_admin_emails()` (CREATE OR REPLACE, A-2)
- **Before:** `LANGUAGE sql`, no gate, no search_path — returned the full admin roster to anyone (HIGH admin-email dump).
- **Now:** `LANGUAGE plpgsql` + `SET search_path TO 'public'`; `IF NOT public.is_admin_user() THEN RETURN` (non-admins get ZERO rows, not an error).
- **Why:** SPEC A-2 / SC-6. Transparent to `AuthContext.jsx:129` (authenticated; maps `data || []`, hardcoded-allowlist fallback on empty); no service_role/edge caller exists.

## 8. Cross-surface impact table

| # | Surface | Affected? | What changes for a user | Files | Parity |
|---|---------|-----------|-------------------------|-------|--------|
| 1 | Consumer iOS | Consequence only | Calendar "Going" passes still load (gate transparent) | none | Automatic (DB ACL) |
| 2 | Consumer Android | Consequence only | Same | none | Automatic |
| 3 | Buyer/anonymous Web | Consequence only | Public pages / RSVP / anon checkout unaffected (spared) | none | Automatic |
| 4 | Business iOS | Consequence only | Ticket scanning unaffected (`biz_ticket_scan` = svc-role edge fn) | none | Automatic |
| 5 | Business Android | Consequence only | Same | none | Automatic |
| 6 | Admin Web (adjacent) | Consequence only | Admin login/bootstrap unaffected; roster gate returns list to real admins, empty tolerated | none | Automatic |
| 7 | Business Web preview (adjacent) | No change | — | none | Automatic |

Files touched are backend/CI only (`supabase/migrations/**`, `supabase/security/**`, `scripts/ci/**`, `.github/workflows/**`). No app/product code modified. Parity is automatic — the grant lives at the DB ACL layer upstream of all app code.

## 9. Smoke result (CI Supabase-Postgres booted locally — SPEC §8 step 2)

Docker `supabase/postgres:17.4.1.075` on host port 55432. Steps + observed:
1. Roles `anon`/`authenticated`/`service_role` present; image already auto-grants anon EXECUTE on new functions (confirms **OQ-2** — the seed is a no-op on this image but stays load-bearing for version drift).
2. Seeded default privileges (idempotent) → applied **338** migrations in order under `ON_ERROR_STOP=1` → **FAIL=0**; my migration's DO-block emitted `ORCH-1392: all 45 grant end-states asserted (26 service_role-only, 19 authenticated)`.
3. Canonical probe → **184** anon-exec definer fns remain; NONE of the 45 revoked appear; set-diff vs the investigation CSV is **empty** (every remaining fn is classified — no unclassified/new fn).
4. Allowlist generated deterministically from that probe (184 sigs). Gate → `OK: 184 … all allowlisted` (exit 0, **SC-8**).
5. Negative control: injected `_orch1392_gate_selftest()` (anon=t) → gate exit 1 → dropped → exit 0 (**SC-9**).
6. Idempotency: re-applied migration → same NOTICE, no error, gate still green (**SC-7**).
7. Static test `deno test` → 6/6 green; fails-on-revert proven by true line deletion.

## 10. Known issues / deferred

- **SC-5/SC-6 runtime** are source-verified only (caller-compat proven by grep + reading both callers); live-fire (`auth.uid()`-scoped calls, admin bootstrap, consumer Calendar on device) is the tester's T-5..T-10/T-15.
- OQ-3 (`admin_city_*` body gate), OQ-4 (allowlist tightening), OQ-5 (authenticated tier) remain out of scope per SPEC.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required

- **Apply the migration at CLOSE (orchestrator/Seth), from the worktree:**
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]" && /Users/sethogieva/bin/supabase db push --linked
  ```
  Mostly a no-op vs the live hot-patch; the net new effect on prod = the 34 Tier-2 revokes + 4 §4.2-remediation revokes + the 2 body gates. Monotonic prefix `20270104000000` verified strictly-greater than `origin/main` head (`20270101000864`) and all sibling worktrees (ORCH-1384's `20270102/03000000`); `--include-all` NOT required.
  - **Guard/backfill probe:** the only pre-apply guard is the Section C DO-block (post-apply asserts, self-rolling-back) — no data-shape/backfill predicate that could abort against existing rows. Verified clean on the CI DB (all 338 migrations + DO-block passed). No read-only remote probe owed.
  - **Migration ordering (OQ-1):** if ORCH-1384 is still unmerged at CLOSE, apply/merge it first (its `20270102/03` grants are already live on prod; idempotent either way).
- **Edge functions to deploy:** none.
- **CI:** the new gate workflow triggers on `supabase/migrations/**` + the 3 gate files; expect it green on the CLOSE PR. Flip `I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER` + `I-PROPOSED-1392-DEFINER-GRANTS-EXPLICIT-IN-MIGRATION` ACTIVE; resolve COMMS-0110.

## 12. Discoveries for Orchestrator

1. **[NEEDS RATIFICATION — Section B2] 4 same-class residual leakers the investigation's 41-list missed.** The IMPLEMENT-phase CI probe surfaced 4 anon-executable definer functions that are the EXACT class already being revoked (unguarded mutation / worker-kicker) but were absent from INVESTIGATION F-5 and the SPEC's 41 (F-6 explicitly warned the gate heuristic misses http-only + aliased side-effects). SPEC §4.2 forbids allowlisting a missed leaker → I revoked them in a fenced **Section B2** rather than ship a red gate. Bodies + caller-compat verified:
   - `cleanup_expired_undo_actions()` — unguarded `DELETE FROM undo_actions`; NO client caller → **service_role**.
   - `cleanup_stale_push_tokens()` — unguarded `DELETE FROM user_push_tokens`; NO client caller → **service_role**.
   - `tg_meta_orch_1009_sub_d_quarterly_sweep()` — http-only worker kicker (16× `net.http_post` + `pg_sleep(60)` = anon-triggerable 16-min fan-out); sibling of the in-scope `tg_meta_orch_1009_sub_d_kick_rescores`; NO client caller → **service_role**.
   - `recalculate_user_level(uuid)` — unguarded upsert of ANY user's level; sole client caller `app-mobile/src/services/userLevelService.ts:23` (authenticated, own id) + edge `upsert-leaderboard-presence` (svc) → **authenticated** (anon revoked).
   **If REVIEW rejects the amendment:** delete Section B2, its 4 DO-asserts, the 4 allowlist lines, and the 4 static-test entries (all clearly fenced/labeled) — the gate would then require them allowlisted-with-justification instead.
2. **Prod↔migration grant drift (2 fns).** `record_engagement(...)` and `query_person_hero_places_by_signal(...)` are `anon=0` on PROD (revoked via a NON-migration hot-patch) but `anon=1` on the migration-built CI DB — so a fresh env does NOT reproduce prod's locked-down state. Both are SAFE (record_engagement gates on `auth.uid() IS NULL → RAISE`; query_person_hero is read-only over the public `place_pool`, no user PII — same class as its anon-exec siblings), so I allowlisted them. But it means prod carries un-migrated grant hot-patches; a follow-on could codify them. Not in scope here.
3. **Body-logic (not grant) hardening still open** (INVESTIGATION Discovery #2/#3, restated): `submit_event_rsvp` / `biz_ticket_checkout_create_session` trust `p_user_id`/`p_buyer_user_id` when supplied (bind to `auth.uid()` when non-null); `upsert/remove_participant_prefs` gate asymmetry; `biz_ticket_scan` trusts `p_scanner_user_id`. All left intended-anon/gated per SPEC; separate ORCHs.
4. **Authenticated tier (375 fns) unswept** (OQ-5 / INVESTIGATION Discovery #4) — the gate probes anon only; a sibling ORCH should probe `authenticated`.

---

## Appendix — 45-function grant end-state

**Service_role only (26): anon=f, authed=f, svc=t.** Group-1 (23): biz_refund_order_commit_from_webhook, finalize_rsvp_contribution, anonymize_user_audit_log, mark_partner_split_transferred, mark_partner_split_reversed, mark_partner_split_failed, bump_paystack_partner_split_attempt, mark_paystack_partner_split_attempted, record_partner_split_attempt, record_paystack_partner_split_attempt, truncate_seed_map_presence, cron_refresh_admin_place_pool_mv, tg_kick_pending_trial_runs, tg_kick_pending_thumb_backfill, tg_meta_orch_1009_sub_d_kick_rescores, expire_agent_pending_actions, pg_topup_recurring_experiences, pg_expand_experience_recurrence, pg_try_discover_cache_build_lock, pg_release_discover_cache_build_lock, record_trial_phone, biz_ticket_scan, add_buyer_to_event_chat. **B2 (3):** cleanup_expired_undo_actions, cleanup_stale_push_tokens, tg_meta_orch_1009_sub_d_quarterly_sweep.

**Authenticated (19): anon=f, authed=t, svc=t.** Group-2 (18): fetch_user_going_rsvps (+A-1 gate), get_admin_emails (+A-2 gate), accept_invite_and_transfer_brand_ownership, accept_scanner_invitation, get_or_create_direct_conversation, remove_participant_prefs, upsert_participant_prefs, execute_undo_action, get_effective_tier, derive_user_segment, get_undo_actions, get_muted_user_ids, admin_city_pipeline_status, admin_city_place_stats, phone_has_used_trial, has_recent_report, is_admin_email, check_invited_admin. **B2 (1):** recalculate_user_level.
