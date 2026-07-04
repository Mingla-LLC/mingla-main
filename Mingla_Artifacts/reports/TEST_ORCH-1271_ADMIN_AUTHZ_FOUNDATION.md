# TEST — ORCH-1271 [Admin authorization & audit FOUNDATION]

**Phase:** TEST (production gatekeeper). **Tester:** mingla-tester. **Date:** 2026-07-03.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Under test:** squash `e17d82f4a` (merged to main) + live deploy (3 migrations `20261204000000/1/2`, edge fn `admin-write-primitive` v2 `verify_jwt=true`).
**Method:** independent live-fire via MCP `execute_sql` with `set_config('request.jwt.claims',…)` admin/non-admin simulation + `curl` against the edge fn and PostgREST RPC. Read + append-only probe writes only (tagged `ORCH-1271-TESTER`); no migrations applied, no business tables mutated, no `db push`.
**Sim gate (Phase 0.A):** EXEMPT — backend/SQL/RLS/edge-function-only change, no UI/runtime surface in the foundation deliverables. (Admin-web UI scaffolding AC-4 is out of this dispatch's live-fire scope; source-verified only.)
**COMMS ledger:** scanned; no row addressed to mingla-tester / ORCH-1271. COMMS-0061 (WARN, ALL) — `gqnoajqerqhnvulmnyvv` is LIVE PROD — honored by construction (read-only + append-only tagged probes).

---

## 1. Verdict

# FAIL — P0:1 · P1:1 · P2:1 · P3:1 · P4:3

**All written foundation ACs (AC-1, AC-2, AC-5.1) PASS on their own terms.** FAIL is driven by an adversarial-angle finding the AC set did not cover: **`public.admin_write_audit` is reachable by UNAUTHENTICATED callers via PostgREST and fails-open, allowing arbitrary forged writes into the admin security audit log (P0).** The audited-write primitive is the safety foundation for all wave-2 destructive admin actions (1272/1273/1274) — this hole must close before it is built upon. Regression gate satisfied (implementor happy-path + tester adversarial both present, both fails-on-revert). Routes to **REWORK** (hardening migration).

---

## 2. Acceptance-criteria matrix (independent live evidence)

| AC | Verdict | Live evidence |
|---|---|---|
| **AC-1.1** split gate = 0 | PASS | `SELECT count(*) FROM pg_policies … qual/with_check ILIKE '%account_type%''admin''%'` → **0**. |
| **AC-1.2** partner policies flipped, self-branch kept | PASS | `partner_stripe_self_select` qual = `((account_id = auth.uid()) OR is_admin_user())`; `partner_splits_partner_self_select` qual = `((partner_account_id = auth.uid()) OR (EXISTS … brand_team_members btm …) OR is_admin_user())`. No `account_type`. |
| **AC-2.1** audit-log extend | PASS | `admin_audit_log` cols: `actor_uid uuid` (nullable), `reason text` (nullable). Index `idx_audit_log_target ON (target_type, target_id)` present. |
| **AC-2.2** admin probe → uuid + correct-actor row | PASS | As seth (sub `63835860…`): `admin_audit_probe('…AC-2.2 happy','happy-path note')` → `639137b4-…`. Row: `admin_email=seth@usemingla.com`, `actor_uid=63835860-56bc-4ac9-a643-630558e111b5`, `action=admin.audit_probe`, `reason` + `metadata.note` correct. |
| **AC-2.3** blank/whitespace reason → `reason_required`, 0 rows | PASS | `admin_audit_probe('')` and `('     ')` both RAISE `reason_required` (in `admin_write_audit` line 11). Row count 96→97 (only the happy row) — denials wrote nothing. |
| **AC-2.4** non-admin → `not_authorized`, 0 rows | PASS | As non-admin `qa-experiences-1138@mingla.test` (sub `11111111-1138-…`): `admin_audit_probe('x')` RAISES `not_authorized` at `admin_audit_probe` line 4 (guard). No row. |
| **AC-2.5** edge fn HTTP matrix | PASS (tested dirs) / PARTIAL (admin dirs) | no-auth → **401** (`UNAUTHORIZED_NO_AUTH_HEADER`); anon-key bearer → **401** (`unauthorized`, getUser reject); garbage JWT → **401** (`UNAUTHORIZED_INVALID_JWT_FORMAT`); **valid non-admin user JWT + reason → 403** (`forbidden`); non-admin + blank → **403** (identity checked before input); `GET` → **405**. `admin+blank→400` / `admin+reason→200`: NOT independently re-proven at HTTP layer — no active-admin user JWT mintable (only seth is active-admin; won't hijack his session). Equivalent PROVEN at RPC layer (AC-2.2/2.3) + edge source verified (binds actor to `user.email`/`user.id`, surfaces `reason_required`→400). |
| **AC-2.6** primitive gates fail-on-revert | PASS | `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` PASS in scan mode; self-test fixtures 3/3 + 4/4. |
| **AC-5.1** 3 invariant gates + job | PASS | `i-admin-single-gate` (scan PASS; self-test 3/3), `i-admin-write-audited` (scan PASS; 3/3), `i-admin-gate-first-statement` (scan PASS; 4/4). Job `orch-1271-admin-authz-foundation:` registered in `strict-grep-mingla-business.yml:3592`. |
| AC-3 read convention (doc) | N/A here | Orchestrator-verified at domain-spec dispatch. |
| AC-4 UI scaffolding | NOT LIVE-FIRED | Out of this dispatch's scope. Source-verified only via implementor happy-path (21/21 pass); no admin-web browser run performed. |

**AC-coverage gap (Discovery D-1):** AC-2.4 tests only that the *probe's* guard denies a non-admin. No AC tests the direct reachability / anon fail-open of the underlying `admin_write_audit` helper — which is exactly where the P0 lives.

---

## 3. Findings

### P0-1 — Unauthenticated caller can write forged rows into `admin_audit_log` via `admin_write_audit` RPC

**Evidence (live, prod):** With ONLY the public anon key (no user JWT):
```
POST https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/admin_write_audit
apikey/Authorization: <anon key>
{"p_action":"…","p_entity_type":"self_test","p_reason":"…",
 "p_actor_email":"anon-forged@evil.test","p_actor_uid":"00000000-…-0000000fdead"}
→ HTTP 200  "29c966a3-264e-41e6-a7cc-8378da373530"
```
The written row (verified, then deleted by tester): `admin_email='anon-forged@evil.test'`, `actor_uid='…0fdead'`, `action='orch1271.tester.anonforge'`. Contrast: the intended exposed RPC `admin_audit_probe` correctly returns `not_authorized` (HTTP 400) to the same anon caller.

**Root cause (three compounding facts):**
1. `admin_write_audit` has `EXECUTE` granted to `anon`, `authenticated`, and PUBLIC (default public-schema grant; the primitive migration issues no `REVOKE`) — so PostgREST exposes it as `/rest/v1/rpc/admin_write_audit` to unauthenticated callers (`pg_proc.proacl` verified).
2. The guard is `IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE 'not_authorized'` — for an anon caller `auth.uid()` IS NULL, so the whole condition is false and the guard **fails open** (the design assumed only trusted service_role ever reaches the `auth.uid() IS NULL` branch, but PostgREST `anon` also has `auth.uid()` NULL).
3. `v_uid := COALESCE(p_actor_uid, auth.uid())` / `v_email := COALESCE(p_actor_email, …)` let the caller supply any actor identity.

**Impact:** Anyone on the internet (the anon key is embedded in every client bundle) can inject arbitrary rows into the admin **security audit log** with a fully forged actor, arbitrary `action`/`target`/`metadata`, and unlimited volume — audit-log **poisoning, spoofing (framing the real admin), and flooding/DoS**. This defeats D2's entire premise that server-side audit is the safety mechanism replacing a super-admin tier: the audit trail is attacker-writable and therefore untrustworthy. It is the foundation 1272/1273/1274 build destructive-action audit on.

**Required fix:**
- `REVOKE EXECUTE ON FUNCTION public.admin_write_audit(text,text,text,text,jsonb,boolean,text,uuid) FROM anon, authenticated, PUBLIC;` — the helper must be callable ONLY by `service_role` (the edge fn) and internally by SECURITY DEFINER RPCs (which run as the owner, unaffected by the revoke — `admin_audit_probe` keeps working). This removes the PostgREST attack surface entirely. Add the revoke to the primitive migration and to the golden write-RPC template (§2d) so domains inherit it.
- Defense-in-depth in the body: bind actor to the JWT when present so the branch cannot fail-open or be over-ridden — `v_uid := CASE WHEN auth.uid() IS NOT NULL THEN auth.uid() ELSE p_actor_uid END;` (same for `v_email`), and gate the service-role path explicitly (e.g. require `p_actor_*` non-null AND treat any `auth.uid() IS NULL` call as service-only, which the revoke already guarantees).

**Retest:** repeat the anon `curl` → must return `not_authorized`/permission error (not 200); a JWT-admin direct call passing `p_actor_*` must record the admin's own `auth.uid()`, not the override; `admin_audit_probe` (probe) + the edge fn must still succeed for a real admin.

### P1-1 — A JWT-authenticated admin can forge the audit actor via `p_actor_*` override

**Evidence (live, prod):** As seth (admin JWT simulated), a direct call `admin_write_audit('…','self_test','…','reason','{}',true,'attacker-forged-victim@evil.test','…deadbeef')` wrote row `0ffded76-…` with `admin_email='attacker-forged-victim@evil.test'`, `actor_uid='…deadbeef'` — NOT seth. The admin passes the guard (is admin), then `COALESCE(p_actor_uid, auth.uid())` honors the forged override. (Row deleted after proof.)

**Impact:** Even after P0's anon hole is closed, so long as `authenticated` retains the direct grant, any admin can attribute audit entries to a different actor — defeating non-repudiation (an admin can obscure their own accountability, or, with ≥2 admins, frame a colleague). Same root grant + override as P0.

**Required fix:** subsumed by P0's fix (the `REVOKE … FROM authenticated` removes the direct grant; the `CASE WHEN auth.uid() IS NOT NULL` binding prevents override for any residual JWT path). The exposed probe is already safe — it never forwards `p_actor_*` (verified) — so no probe change needed.

### P2-1 — Reason-required gate bypassable with non-ASCII-space whitespace / zero-width chars

**Evidence (live, prod):** As seth, `admin_audit_probe(<char>, note)` for `<char>` ∈ { tab `E'\t'`, newline `E'\n'`, NBSP `U+00A0`, zero-width space `U+200B` } each returned a uuid and wrote a row (ids `f07a1135` / `89945058` / `1d27cd5b` / `387a6e24`, each `reason` length 1, first-char codepoints 9/10/160/8203). The gate `p_reason IS NULL OR btrim(p_reason)=''` uses `btrim` with the default trim set of **ASCII space only** — so any tab/newline/Unicode-space/zero-width "reason" satisfies "reason present."

**Impact:** Undermines D2's "typed REASON required for high-risk actions" — an admin (or, via the edge fn, a caller using U+200B, which JS `.trim()` also does not strip) can satisfy the audit-reason requirement with an invisible, meaningless value. Audit-quality degradation, not a privilege issue.

**Required fix:** normalize before the emptiness check, e.g. `btrim(regexp_replace(p_reason, '[\s ​-‏  ﻿]', '', 'g')) = ''` (or enforce a minimum meaningful length). Mirror in the edge fn. Add a fixture to `i-admin-write-audited.mjs`.

### P3-1 — `is_admin_user()` has no `SET search_path` pin (pre-existing; spec Q3)

**Evidence:** `pg_proc.proconfig` for `public.is_admin_user` = NULL (no `search_path`), while both new 1271 fns pin `search_path=public`. `is_admin_user` references `admin_users` unqualified. **Note only** — the spec (Open Question Q3) already flags this as out-of-blast-radius for 1271 and routes it to a separate hardening ORCH; within the 1271 call chain the callers pin `search_path=public`, so it resolves safely here. Reaffirmed, not a 1271 regression.

### P4 — Credit (good work)
- Single-gate flip is clean and minimal; both partner self-access branches preserved verbatim; migration self-assert present.
- Guard-first ordering holds in both fns (guard is the first executable statement — `i-admin-gate-first-statement` 4/4).
- The **intended exposed RPC `admin_audit_probe` is correctly hardened**: unconditional `IF NOT is_admin_user()` guard (anon → `not_authorized`), never forwards `p_actor_*` — so the forge is NOT reachable through the sanctioned entry point.
- The edge fn correctly binds the actor to the getUser-verified caller (`user.email`/`user.id`), never client input, and denies a valid non-admin with 403.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- **Checked out:** worktree `~/Desktop/mingla-orchs/1271-[admin-authz-foundation]`, branch `1271-admin-authz-foundation` @ `3c8e217e4` (impl proof cited `7e58a7400`).
- **Baseline:** `node --test mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` → **21 pass / 0 fail**.
- **Revert (true line-deletion):** removed the `admin_write_audit` guard block (`IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN / RAISE / END IF;`) from `20261204000002_orch_1271_admin_write_primitive.sql` → re-run: **`not ok 1 - admin_write_audit is SECURITY DEFINER, guards FIRST…` → `AssertionError: 'guard present'`**, 20 pass / 1 fail.
- **Restore:** `git checkout --` the migration → **21 pass / 0 fail**. Implementor fails-on-revert **independently confirmed**.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-admin/src/__tests__/orch1271_admin_authz_adversarial.test.js` (NEW; append-only; `node:test` + `fs`, same harness).
- **Angle (distinct from happy-path):** audit-integrity invariants — (a) exposed `admin_audit_probe` must NEVER forward `p_actor_*` (actor-spoofing surface); (b) edge fn binds actor to the verified caller, never a body field; (c) reason gate fires BEFORE actor resolution AND before the INSERT, and the probe requests `p_require_reason=true`; (d) BOTH definer fns pin `search_path='public'`.
- **Branch:** `1271-adversarial-test` off `origin/main` (`git fetch origin && git checkout -b 1271-adversarial-test origin/main`).
- **New commit:** `7f71807117d79c03f595a5b478af259b0ed5e460` (only file in `git diff origin/main...HEAD --name-only`). Pushed to `origin/1271-adversarial-test`. **PR NOT opened** (orchestrator owns it).
- **Green:** 7 pass / 0 fail against merged `origin/main`.
- **fails-on-revert verified at `7f71807`:** (1) true-delete `SET search_path TO 'public'` on `admin_write_audit` → `not ok - admin_write_audit pins SET search_path TO 'public'`; (2) inject `p_actor_*` override into the probe's `admin_write_audit(...)` call → `not ok - admin_audit_probe NEVER passes p_actor_email / p_actor_uid…`. Both restore → 7/7.

Both the implementor happy-path (already on `origin/main` via `e17d82f4a`) and the tester adversarial test exist; regression gate satisfied.

---

## 6. Constitution matrix (relevant rules; UI-only rules N/A for this backend change)

| Rule | Verdict | Evidence |
|---|---|---|
| 2 — One owner per truth | **FAIL** | Audit actor should be server-owned (`auth.uid()`); client `p_actor_*` override + anon reach lets the caller own it (P0/P1). |
| 3 — No silent failures | **FAIL** | Guard fails-open silently for anon (`auth.uid() IS NULL` → condition false, no raise) (P0). |
| 9 — No fabricated data | **FAIL** | Forged actor identity is fabricated audit data writable by anyone (P0/P1). |
| 1 dead taps · 4 query-key · 5 server-state · 6 logout · 7 transitional · 8 subtract · 10 currency · 11 one-auth · 12 validate-timing · 13 exclusion · 14 hydration | N/A | No client/UI/state surface in the foundation deliverables under test. |

---

## 7. Device / parity matrix

| Surface | Status | Note |
|---|---|---|
| Backend SQL (RLS + RPC) | LIVE-FIRED | `execute_sql` JWT-simulation against prod `gqnoajqerqhnvulmnyvv`. |
| Edge fn (`admin-write-primitive` v2, `verify_jwt=true`) | LIVE-FIRED | `curl` HTTP matrix (401/403/405 proven; admin 200/400 = RPC-equiv + source). Deployed version matches merged source (`get_edge_function`). |
| Consumer iOS / Android / Buyer web / Business iOS / Android | N/A | No shipping-app surface (spec §4 line 4). |
| Admin Web (UI scaffolding AC-4) | NOT RUN | Out of dispatch scope; source-verified only (implementor happy-path 21/21). No browser dead-tap run. |
| Physical iPhone (HITL) | N/A | No mobile runtime surface. |

**Test residue (all tagged, honest):** 5 `ORCH-1271-TESTER` rows in `admin_audit_log` (1 happy `admin.audit_probe` + 4 whitespace-reason bypass rows), all attributed to `seth@usemingla.com` (verified `admin_email <> seth` count = 0). All forged-identity proof rows (`0ffded76`, `29c966a3`) and the throwaway non-admin auth user (`fecf9fc5…`) were DELETED after proof. Net: append-only, no misleading rows left.

---

## 8. Discoveries for Orchestrator

- **D-1 (AC-coverage gap):** The AC set never tests direct reachability / anon fail-open of `admin_write_audit`; add an AC (and a strict-grep/fixture) asserting the helper is NOT granted to anon/authenticated and that anon RPC → denied. This is where the P0 hid.
- **D-2 (CI wiring):** Neither `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` nor the new adversarial test is invoked by any workflow (`package.json` `test` hardcodes only `claimsPhone` + `deckCardPreviewRules`; no workflow runs `src/__tests__`). The node:test source suites therefore do NOT gate CI today — only the 3 strict-grep `.mjs` gates do. Wire the `src/__tests__` suite into a workflow (or the admin `test` script) at CLOSE so these regression tests actually run.
- **D-3:** Same `REVOKE`/actor-binding hardening should be baked into the §2d golden WRITE-RPC template before 1272/1273/1274 copy it, else every domain write RPC that calls `admin_write_audit` inherits the exposure pattern.
- Pre-existing (spec-flagged, do not fix in 1271): `is_admin_user()` search_path (Q3); `admin_set_city_live` guard-less RPC (A-1); `delete-user` edge fn (D-1/G-7).

---

## 9. Accepted conditions

None — this is a FAIL (unaccepted P0), not a CONDITIONAL PASS.

---

## Routing
**FAIL → REWORK (mingla-implementor).** A hardening migration is required: `REVOKE EXECUTE` on `admin_write_audit` from anon/authenticated/PUBLIC + actor-binding to `auth.uid()` (closes P0-1 + P1-1); strengthen the reason gate against non-ASCII whitespace (closes P2-1); add the AC-coverage + CI-wiring gaps (D-1, D-2). Because the primitive is LIVE and anon-writable now, and 1272/1273/1274 depend on it, this should be prioritized ahead of the domain ORCHs.
