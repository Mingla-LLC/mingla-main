# TEST — ORCH-1392 [SECURITY DEFINER grant-hygiene sweep — durable fix]

- **Phase:** TEST (mingla-tester). Worktree `~/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]/` on branch `ORCH-1392-security-definer-grant-sweep`, rebased onto `origin/main` (5 commits replayed clean).
- **Under test:** migration `20270104000000_orch_1392_security_definer_grant_sweep.sql` + allowlist + CI gate script + workflow + implementor static test. Fix commit `ffa57ff2b`; implementation report `7a98aac65`.
- **Method:** live READ-ONLY prod privilege probes (`has_function_privilege`, gqnoajqerqhnvulmnyvv); a THROWAWAY `supabase/postgres:17.4.1.075` Docker DB (340 migrations applied, DO-block + gate + body-gate runtime exercised); Deno static-test re-run + revert drills; monorepo caller sweep; device connectivity check.
- **Prod state at test time:** migration NOT applied to prod (orchestrator applies at CLOSE). The 7 emergency hot-patched fns ARE live-hardened; the other 38 are still in pre-migration state. Verified accordingly.

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 0 · P4: 3.

The durable fix is correct and every success criterion is proven with runtime/live-fire evidence: the 7 hot-patched fns are at their intended end-state on prod NOW; all 38 others are confirmed still-anon-executable NOW (real open leaks the migration closes); the throwaway apply is clean + idempotent with the 45-assert DO-block passing; both body gates enforce correctly (cross-user refused, own allowed, service_role bypass; admin roster gated); the CI gate passes on truth and fails on an injected leaker; no leaker is smuggled into the allowlist; and both regression tests fail-on-revert and appear in the closing diff.

**The single condition (P2, ZERO current impact):** revoking `anon` from `is_admin_email` removes the anon capability the admin console's PRE-LOGIN gate relies on to recognise a **dynamic-only (non-hardcoded)** admin (`verifyPassword` → `is_admin_email` at anon, `AuthContext.jsx:276`). Prod has exactly ONE admin — `seth@usemingla.com` — which IS in the hardcoded `ALLOWED_ADMIN_EMAILS`, so the anon path is never reached and **no current login breaks**. But the SPEC/report claim "Admin login/bootstrap unaffected" is over-broad: a future dynamic-only admin would be silently locked out at pre-login. Migration is safe to apply as-is for the current admin set; the orchestrator must consciously handle this before any dynamic admin is onboarded (allowlist `is_admin_email` for anon, or refactor the login gate). This is surfaced for a decision, not a code-blocker — it does not warrant holding a correct fix that closes 5 HIGH + ~33 live leaks.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | Hot-patch codified (7 fns anon=false; 3 webhook also authed=false, svc=true) | **PASS** | T-A prod probe: all 7 at intended end-state NOW (3 svc-only anon=f/authed=f/svc=t; 4 authed anon=f/authed=t/svc=t). Throwaway re-apply re-asserts them (DO-block). |
| SC-2 | Tier-2 svc-only (26 incl. B2): anon=f, authed=f, svc=t | **PASS** | Throwaway independent probe: svc group = 26 fns, 0 anon-leaks, 0 authed-wrong, 0 svc-missing. |
| SC-3 | Tier-2 authenticated (19 incl. B2): anon=f, authed=t, svc=t | **PASS** | Throwaway independent probe: authed group = 19 fns, 0 anon-leaks, 0 authed-missing, 0 svc-missing. |
| SC-4 | Intended-public spared (anon=t retained) | **PASS** | T-A prod probe: 9 sampled spare fns (pg_public_*, submit_event_rsvp, biz_ticket_checkout_create_session, username checks, pg_discover_business_events) all anon=t; migration does not touch them; gate green with them allowlisted. |
| SC-5 | `fetch_user_going_rsvps` gate transparent | **PASS** | T-C runtime on throwaway: own-id → succeeds; cross-id → RAISE `not_authorized` (42501) at gate line 7; service_role (no jwt) → bypass succeeds. Body copied VERBATIM from prod (diffed). |
| SC-6 | `get_admin_emails` gate transparent | **PASS** | T-C runtime: authed admin (is_admin_user()=t) → full roster; authed non-admin → 0 rows, no error. Body = prod query + `au` alias (identical output). |
| SC-7 | Idempotent (re-run = no-op) | **PASS** | Re-applied migration twice on migrated throwaway DB → same NOTICE, exit 0, gate stayed green. |
| SC-8 | CI gate green on truth | **PASS** | Shipped `security_definer_anon_gate.sh` on throwaway DB → `OK: 184 anon-executable definer functions, all allowlisted` (exit 0). |
| SC-9 | CI gate self-tests (fails on injected leaker) | **PASS** | Injected `_orch1392_tester_leak()` → gate exit 1, naming it; dropped → exit 0. |
| SC-10 | No re-widening (zero `GRANT … TO anon`) | **PASS** | Static test SC-10 green; grep confirms zero `GRANT EXECUTE … TO … anon`. |
| SC-11 | Fails-on-revert (static) | **PASS** | Step 0.5: deleting `mark_partner_split_transferred` REVOKE line → 4 passed / 2 failed; restored → 6/6 green. |
| SC-12 | Fails-on-revert (runtime) | **PASS** | The negative control (SC-9) is the runtime fails-on-revert: an anon-exec fn not allowlisted → gate red. |

All 12 SCs PASS with runtime/live-fire evidence. Surface split N/A — DB ACL is a single shared enforcement point (SPEC §3).

---

## 3. Findings

### P2-1 — `is_admin_email` anon-revoke drops dynamic-only admins at the admin-console pre-login gate (latent; zero current impact)

- **Evidence:** `mingla-admin/src/context/AuthContext.jsx:273-282` — `verifyPassword` calls `supabase.rpc("is_admin_email", { p_email })` BEFORE `signInWithPassword` (comment line 274: "works pre-auth as anon"). On error/false it throws `"Access denied. This email is not authorized."`. The migration Group-2 row 40 does `REVOKE EXECUTE ON FUNCTION public.is_admin_email(text) FROM PUBLIC, anon`. `is_admin_email` is confirmed anon=true on prod NOW (T-A), so this is a NET-NEW revoke at CLOSE. The parallel `get_admin_emails` anon-init call (`AuthContext.jsx:129`, tolerated with hardcoded fallback) is ALREADY anon-revoked live and contributes no new break. Prod `admin_users` (active/invited) = `[seth@usemingla.com]`; `ALLOWED_ADMIN_EMAILS = ["seth@usemingla.com"]` → the sole admin is hardcoded → `isEmailAllowed` returns true synchronously (line 275) → the anon `is_admin_email` RPC is never reached.
- **Impact:** ZERO today (only hardcoded Seth). Latent: a future admin whose email is only in `admin_users` (not hardcoded) cannot pass the pre-login gate after CLOSE — silent "Access denied". Contradicts SPEC §3 row 6 / report §8 row 6 "Admin login/bootstrap unaffected."
- **Required fix (orchestrator decision at/ before CLOSE):** proceed with CLOSE as-is (safe for the current hardcoded-only admin set), AND file a follow-up to either (a) add `is_admin_email(text)` to `anon_executable_definer_allowlist.txt` with justification and DROP its REVOKE (it is a low-sensitivity boolean predicate the login gate depends on), or (b) refactor `verifyPassword` to do the admin check post-auth. Do NOT onboard a dynamic-only admin until (a) or (b) lands.
- **Retest:** after the chosen fix, either the gate keeps `is_admin_email` allowlisted (option a) or a dynamic admin logs in successfully on device (option b).

### P4 praise
- **P4-1** — Section C DO-block (fail-closed, self-rolling-back) mirrors the ORCH-1384 shape and asserts all 45 end-states at apply time; the orchestrator gets self-verification at CLOSE even without the test harness.
- **P4-2** — `fetch_user_going_rsvps` body copied VERBATIM from prod `pg_get_functiondef` (byte-diffed here) — only the plpgsql gate wrapper is new; zero risk of a silent query-shape regression.
- **P4-3** — Two-sided regression contract (static migration-text + live effective-privilege gate) correctly addresses F-6: the anon grant is an invisible default-privilege the static test cannot see, so the live gate is genuinely load-bearing, not redundant.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out branch HEAD (`7a98aac65`), ran `deno test --allow-read supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts` → **6 passed / 0 failed** (pristine).
- True LINE-DELETION of the `mark_partner_split_transferred` REVOKE line (matching the implementor's cited revert) → **4 passed / 2 failed**: the exact two assertions "all 45 revoked functions REVOKE anon" (`:105`) and "the 26 service_role-only functions ALSO REVOKE authenticated" (`:120`) went RED.
- Restored via `git checkout --` → **6 passed / 0 failed** again. Implementor's fails-on-revert claim reproduced exactly. (Migration file confirmed pristine after the drill.)

## 5. Adversarial test added (tester, different angle)

- **Path:** `supabase/migrations/__tests__/orch_1392_grant_sweep_grantside.tester.test.ts` (NEW file; +174/-0; append-only; no TEST-MOD token owed — COMMS-0106).
- **Angle (distinct from implementor's REVOKE-side text test):** ANGLE 1 asserts the GRANT side — every svc-only fn `GRANT`s `service_role`, every authed fn `GRANT`s BOTH `authenticated` AND `service_role` (a dropped `TO service_role` GRANT strands edge/webhook/payout callers while the implementor's suite stays green). ANGLE 2 asserts the Section-C DO-block assert arrays are set-equal (26/19) to the revoked set (self-assert coverage).
- **fails-on-revert verified at `458c96af1`:** (i) deleting the `TO service_role` GRANT for `biz_ticket_scan` → MY suite RED (ANGLE 1a) while the IMPLEMENTOR's REVOKE-suite stayed 6/6 GREEN — proving a genuinely different angle; (ii) dropping `biz_ticket_scan` from the `svc_only[]` DO-block array → MY suite RED (ANGLE 2); restored → 3/3 green. Both suites together: 9 passed / 0 failed.
- **Closing-diff check:** `git diff origin/main...HEAD --name-only` shows BOTH `orch_1392_grant_sweep.test.ts` (implementor) and `orch_1392_grant_sweep_grantside.tester.test.ts` (tester).

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Note |
|---|------|---------|------|
| 1 | No dead taps | N/A | No UI. |
| 2 | One owner per truth | PASS | Grant lives at DB ACL; migration is the single writer of the intended state. |
| 3 | No silent failures | PASS (with P2-1 caveat) | Gates RAISE 42501 / return empty per contract. The admin pre-login gate's "Access denied" for a dynamic admin (P2-1) is a loud failure, not silent — but undesirable. |
| 4 | One query key per entity | N/A | — |
| 5 | Server state server-side | N/A | — |
| 6 | Logout clears everything | N/A | — |
| 7 | Label `[TRANSITIONAL]` | PASS | None introduced. Section B2 is fenced + labeled for REVIEW. |
| 8 | Subtract before adding | PASS | Migration only NARROWS privilege (zero GRANT-to-anon). |
| 9 | No fabricated data | PASS | — |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | PASS | — |
| 12 | Validate at right time | PASS | `auth.uid()`-time self-scope gate. |
| 13 | Exclusion consistency | PASS | — |
| 14 | Persisted-state startup | N/A | — |

No constitutional violation.

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Consumer iOS | N/A (exempt) | Backend DB-ACL + CI only; zero app/product code touched (Phase 0.A sim-gate exemption). No booted sim. |
| Consumer Android | PASS (transparent) | Samsung `R58R54YV7JT` connected; consumer app `com.mingla.app.v2` installed. `fetch_user_going_rsvps` / `recalculate_user_level` authenticated-transparent — proven at DB layer (T-C) + already-live anon-revoke (fetch) since 2026-07-18; all app-mobile callers pass a signed-in user id (caller sweep). Body change is a superset-safe gate. |
| Buyer/anonymous Web | PASS (no exposure) | Caller sweep: `mingla-business` has ZERO `.rpc()` call sites for any of the 18 revoked client-facing fns — no buyer-web (`/checkout`,`/e/`,`/b/`,`/t/`) anon exposure. |
| Business iOS / Android | PASS | `biz_ticket_scan` called only by the `scan-ticket` edge fn (service_role, retains EXECUTE — svc=t verified on prod + throwaway). |
| Admin Web | CONDITIONAL (P2-1) | Source-traced + prod-data-verified: get_admin_emails graceful-empty fallback + hardcoded Seth login safe (get_admin_emails already anon-revoked live); is_admin_email pre-login gate P2-1. `check_invited_admin` / `admin_city_*` are post-auth (App.jsx:169 session gate) → safe. |
| Business Web preview | N/A | No change. |
| Physical iPhone (HITL) | Not required | Backend-only change; no iOS app-code path. Authoritative enforcement (the 2 gate bodies) proven at DB runtime (T-C). No HITL step owed. |

Edge-fn live-deploy state: this ORCH deploys no edge function; the edge fns that CALL revoked fns (`scan-ticket`, `delete-user`, `upsert-leaderboard-presence`) run as service_role, which retains EXECUTE on all 45 (verified). No deploy-state check owed.

## 8. Other checks
- **Migration prefix:** `20270104000000` strictly > origin/main max `20270103000000` (ORCH-1384 already MERGED — so OQ-1 ordering is moot); no collision. Monotonic.
- **Clean apply:** 340 migrations applied under `ON_ERROR_STOP=1`, FAIL=0; DO-block emitted `ORCH-1392: all 45 grant end-states asserted (26 service_role-only, 19 authenticated)`.
- **Allowlist integrity:** none of the 45 revoked function names appears in the allowlist; 6 sampled allowlisted anon-exec fns each carry a real internal gate (auth.uid()/auth.email()+RAISE or boolean-over-auth.uid()); `record_engagement` is anon=false on prod (Discovery #2 drift) yet self-gated.

## 9. Discoveries for Orchestrator
1. **P2-1 (above) — admin pre-login gate depends on anon `is_admin_email`.** Decide before onboarding any dynamic-only admin: allowlist `is_admin_email(text)` for anon + drop its REVOKE, OR refactor `AuthContext.verifyPassword` to check admin status post-auth. Safe to CLOSE as-is for the current hardcoded-only admin.
2. **Section B2 (implementor-proposed) is sound.** The 4 residual leakers (cleanup_expired_undo_actions, cleanup_stale_push_tokens, tg_meta_orch_1009_sub_d_quarterly_sweep → service_role; recalculate_user_level → authenticated) are the exact same class as the in-scope 41; caller-compat confirmed (3 have zero client callers; recalculate_user_level's only callers are app-mobile authenticated + the leaderboard edge fn). Ratify at REVIEW.
3. **Prod↔migration grant drift (implementor Discovery #2) confirmed:** `record_engagement` is anon=false on prod (non-migration hot-patch) but rebuilds anon=true on a fresh DB — safely allowlisted (self-gates on `auth.uid() IS NULL → RAISE`). A follow-on could codify the un-migrated prod hot-patches.
4. **`recalculate_user_level` retains no self-scope body gate** (authenticated can recompute any user's level; ViewFriendProfileScreen already passes a friend's id). Consistent with SPEC's grant-only B2 scope + the deferred authenticated-tier hardening (OQ-5 / Discovery #4). Not a break; noted for the authenticated-tier follow-on.

## 10. Comms ledger
Read on entry. Factored (WARN, to ALL): COMMS-0110 (ORCH-1392 hot-patch — this ORCH's core context; verified the 7 live end-states + that do-not-widen was honoured, zero GRANT-to-anon), COMMS-0109 (rerun-red — CLOSE PR must be a fresh event; branch rebased this phase), COMMS-0107 (Android device truths — factored for the device leg; no mobile-web surface touched), COMMS-0106 (test traps — new test file, comments stripped before matching, fails-on-revert by true line-deletion, token-on-HEAD not owed), COMMS-0105 (foreign git stash — ZERO git stash used this session; stash@{0} untouched). No new cross-ORCH discovery requiring a new COMMS row.
