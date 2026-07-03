# REWORK — ORCH-1271 P0 HARDENING [admin_write_audit actor-forgery / fail-open / reason-bypass]

**Phase:** REWORK (P0 fix; built + self-verified; NOT deployed). **Branch:** `1271-p0-hardening` (off `origin/main`; foundation already merged). **Commit:** `e469f0626` (+ this report).

## 1. The P0 (tester live-fire, prod `gqnoajqerqhnvulmnyvv`, 2026-07-03)

`public.admin_write_audit` was EXECUTE-granted to anon/authenticated/PUBLIC; its guard `IF auth.uid() IS NOT NULL AND NOT is_admin_user()` **fails open** for anon (`auth.uid()` NULL → guard skipped), and `COALESCE(p_actor_*, auth.uid())` let any caller **forge the audit actor**. Anon curl to `/rest/v1/rpc/admin_write_audit` returned 200 + a forged row. Coordinator applied a live containment hotfix (REVOKE EXECUTE from anon/authenticated/PUBLIC — verified anon/authenticated false, service_role true). This rework makes it permanent in code + closes P1/P2.

## 2. The fix (migration `20261204000003_orch_1271_p0_hardening.sql`, append-only)

- **(b) Server-side actor binding** — `CREATE OR REPLACE admin_write_audit`: a JWT caller's actor is ALWAYS `auth.uid()`/its email (`p_actor_*` IGNORED → cannot be forged); only the no-JWT `service_role` edge path uses `p_actor_*`. Replaces the `COALESCE(p_actor_uid, auth.uid())` forgery surface with `IF auth.uid() IS NOT NULL THEN v_uid := auth.uid() … ELSE v_uid := p_actor_uid`. Guard + `search_path=public` kept.
- **(a) Least-privilege on the helper** — `REVOKE EXECUTE … FROM anon, authenticated, PUBLIC; GRANT … TO service_role;` (idempotent; matches the live hotfix). Definer RPCs reach it in definer context; the edge fn uses `service_role`.
- **(c) Reason normalization** — the emptiness gate now deletes ASCII + Unicode invisible whitespace (space/tab/nl/cr/ff/vt, NBSP=160, ZWSP=8203, ZWNJ=8204, ZWJ=8205, LSEP=8232, PSEP=8233, BOM=65279) via `translate(COALESCE(p_reason,''), …, '')` **before** the empty check → invisible-char bypass closed. Validated read-only on prod (all-invisible → empty; real content preserved; null-safe). Mirrored in the edge fn (`INVISIBLE_WS` regex).
- **(d) Least-privilege on the probe** — `REVOKE EXECUTE ON admin_audit_probe(text,text) FROM anon, PUBLIC; GRANT … TO authenticated;` (admin UI calls it as authenticated; anon has no business calling it).
- **(e) Golden template** — the mandatory `REVOKE`/`GRANT` least-privilege lines are baked into the §2d golden write-RPC template (comment block at the end of the hardening migration; SPEC file is untracked-anchor-only and not editable from the worktree) + into `I-PROPOSED-1271-ADMIN-WRITE-AUDITED` in `INVARIANT_REGISTRY.md`. 1272/1273/1274 inherit least-privilege by construction.
- **Self-assert** — a `DO $$ … has_function_privilege(…) …` block fails apply unless the lockdown holds (anon/authenticated cannot execute the helper; service_role can; anon cannot execute the probe; authenticated can).

## 3. Files changed (branch `1271-p0-hardening`)

| File | Change |
|---|---|
| `supabase/migrations/20261204000003_orch_1271_p0_hardening.sql` | NEW — the hardening migration (b/a/c/d) + self-assert + golden template |
| `supabase/functions/admin-write-primitive/index.ts` | reason normalization (invisible-whitespace) — **needs redeploy** |
| `mingla-admin/src/__tests__/orch1271_admin_authz_adversarial.test.js` | NEW — tester's adversarial suite folded in (from `1271-adversarial-test` `7f71807`) |
| `mingla-admin/src/__tests__/orch1271_admin_authz_foundation.test.js` | appended a "P0 hardening" describe block (source-level fails-on-revert) |
| `.github/workflows/strict-grep-mingla-business.yml` | NEW job `orch-1271-admin-authz-node-tests` (Discovery D-2: gate the admin authz/audit node:test suites) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | `I-PROPOSED-1271-ADMIN-WRITE-AUDITED` hardened (server-side actor + least-privilege + P0 note) |

## 4. Migration version + collision-check

`20261204000003` — verified free across all `~/Desktop/mingla-orchs/*/supabase/migrations`, `~/Desktop/mingla-main`, and `origin/main` (no `2026120400000[3-9]`). Append-only; supersedes the `20261204000002` helper body via `CREATE OR REPLACE`.

## 5. Gate results (self-verified)

- **Adversarial suite** `orch1271_admin_authz_adversarial.test.js` → **7 pass / 0 fail** (actor-spoof-unreachable, edge actor-binding, reason ordering, search_path on both fns).
- **Happy-path** `orch1271_admin_authz_foundation.test.js` → **27 pass / 0 fail** (21 original + 6 P0 hardening).
- **3 strict-grep gates** (`i-admin-single-gate` / `write-audited` / `gate-first-statement`) → `--self-test` + real-tree **PASS**.
- `npm run build` (admin) → **PASS** (vite, 3.42s). `deno check` edge fn → **PASS**. Net-new lint on the two test files → **0 errors**.
- Both node:test suites run **without `node_modules`** (fs + pure imports) → the new CI job needs no `npm ci`; verified from repo root (34/34). YAML validated.

## 6. Fails-on-revert

`fails-on-revert verified at e469f0626` — true line-deletion of the core containment line `FROM anon, authenticated, PUBLIC;` in `20261204000003_orch_1271_p0_hardening.sql` → happy-path **26 pass / 1 fail** (the "REVOKEs admin_write_audit EXECUTE" assertion); `git checkout` restore → **27/27** + adversarial **7/7**, tree clean. (Reverting the whole hardening migration also drops the `has_function_privilege` self-assert and re-opens the forgery → the P0 describe block fails.)

## 7. Retest gate (evidence)

- anon/authenticated cannot execute `admin_write_audit` (post-hotfix prod probe: anon=false, authenticated=false, service_role=true) — migration `DO $$` self-assert re-proves at apply.
- admin_audit_probe: current prod anon=true → migration REVOKEs it (→ anon=false, authenticated=true; self-assert proves).
- JWT-admin direct call logs the admin's OWN `auth.uid()` (p_actor_* ignored on the JWT path) — server-side binding; **live-fire is the tester's job post-deploy**.
- invisible-whitespace reason → `reason_required` — validated read-only on prod (translate logic); enforced in both DB + edge.
- AC-1/AC-2 stay green (single-gate + primitive migrations unchanged); adversarial 7/7 + fails-on-revert @ `e469f0626`.

## 8. Needs orchestrator DEPLOY (post-REVIEW; NOT applied here)

1. **Apply migration** (safe-migration protocol, from the worktree):
   `cd "/Users/sethogieva/Desktop/mingla-orchs/1271-[admin-authz-foundation]" && /Users/sethogieva/bin/supabase db push --linked`
   (applies `20261204000003`; the live hotfix already did the REVOKE so the REVOKE is idempotent; the `CREATE OR REPLACE` + probe REVOKE/GRANT + self-assert are the net-new apply).
2. **Redeploy edge fn** `admin-write-primitive` from MERGED main (reason-normalization change; preserve `verify_jwt=true`).
3. **Tester live-fire** post-deploy: anon RPC → permission denied; JWT-admin actor = own uid (no forge); probe + edge fn work for a real admin; invisible-whitespace reason → `reason_required`.

## 9. Discoveries for Orchestrator

- **D-2 (partially closed):** the admin `src/__tests__/*.test.js` node:test suites did not gate CI. This rework gates the ORCH-1271 suites. Gating the FULL admin suite is blocked by **19 pre-existing failures** in stale `ORCH-1008/1013/1014/1015` suites (source drifted from those old regression tests) — needs a separate cleanup/triage ORCH before a whole-suite gate.
- The §2d golden template lives in an **untracked anchor-only SPEC** (`mingla-main/Mingla_Artifacts/reports/SPEC_ORCH-1271_*.md`, not in git) — the durable least-privilege template now lives in the hardening migration comment + INVARIANT_REGISTRY (tracked). If the SPEC should be version-controlled, that's a process fix.
