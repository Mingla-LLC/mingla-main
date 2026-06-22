# IMPLEMENTATION REPORT — ORCH-1216 [Explorer "Get the app" → lead-capture form gated to TestFlight]

**Implementor:** mingla-implementor
**Date:** 2026-06-22
**Worktree / branch:** `~/Desktop/mingla-orchs/1216-explorer-app-lead-capture/` on `1216-explorer-app-lead-capture` (off clean origin/main; rebased current at start).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1216_EXPLORER_GET_THE_APP_LEAD_CAPTURE.md`
**Status:** COMPLETE — all SPEC layers built, all gates/tests green, fail-on-revert proven. NOT deployed, NOT merged, migration NOT applied (orchestrator/operator steps at CLOSE).

---

## 1. Files created / changed (with commit hashes)

### Commit `d45bab32c` — backend (migration + edge fn + config + C7 allowlist; same commit per HG-4/COMMS-0002)
| File | Status | Purpose |
|---|---|---|
| `supabase/migrations/20261124000000_orch_1216_explorer_app_leads.sql` | NEW | `explorer_app_leads` table (deny-all RLS, `lower(email)` unique idempotency index, created_at + ip_hash indexes, `platform` ios/other column, `admin_explorer_app_leads_list()` SECURITY DEFINER RPC gated to authenticated). |
| `supabase/functions/explorer-app-lead-submit/index.ts` | NEW | Public edge fn (verify_jwt=false). Server re-validates every field, salted-IP-hash throttle (reuses `BETA_LEAD_IP_SALT`), service-role insert, idempotent on `lower(email)`, best-effort Resend notify to seth@usemingla.com on NEW lead only. NO welcome email (NG-7). |
| `supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts` | NEW | 12 Deno happy-path tests (validator normalisation, 5 interests, 2 platforms, source, notify-email render/escape, hashIp, OPTIONS/405/valid-POST). |
| `supabase/functions/explorer-app-lead-submit/__tests__/submit_adversarial.test.ts` | NEW | 13 Deno adversarial tests (consent, email, interest/platform/source allow-sets, length bounds, non-string types, malformed JSON, fields list). |
| `supabase/config.toml` | EDIT | Added `[functions.explorer-app-lead-submit]` / `verify_jwt = false` after the 1045 block. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | EDIT | Added `ORCH_1216_BACKEND_ALLOWLIST` (4 backend files) + spread into `ALLOWLIST` (C7/COMMS-0002). |

### Commit `927aa12b2` — client transport + modal + nav wiring
| File | Status | Purpose |
|---|---|---|
| `mingla-marketing/lib/explorer-app-submit.ts` | NEW | Anon-key raw-fetch transport to `explorer-app-lead-submit` (reuses existing `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `_ANON_KEY`; no supabase-js; no new env). Fires `get_the_app_submitted` analytics on success. |
| `mingla-marketing/components/marketing/get-the-app-modal.tsx` | NEW | 2-step modal (interest chip → name/email/city/consent). All 1045 a11y carried over. `isIosDevice` detect at submit; platform-branched success panel: iOS → "Open in TestFlight" link (hard-coded inline, iOS branch ONLY); non-iOS → Seth's exact iOS-only message, NO link. |
| `mingla-marketing/components/marketing/glass-nav.tsx` | EDIT | Explorer "Get the app" button now opens `GetTheAppModal` (preserves the existing `get_the_app` nav tap + adds a11y attrs). Explorer-only mount block added. Organiser branch + `BetaAccessModal` UNTOUCHED. |

### Commit `9be5891a9` — strict-grep gates + workflow wiring
| File | Status | Purpose |
|---|---|---|
| `.github/scripts/strict-grep/i-proposed-1216-testflight-behind-submit.mjs` | NEW | Asserts the TestFlight token sits ONLY in the iOS branch of `SuccessPanel` and is absent from nav + transport. |
| `.github/scripts/strict-grep/i-proposed-1216-android-no-testflight-link.mjs` | NEW | Asserts the non-iOS success branch has no TestFlight token and no "Open in TestFlight" label. |
| `.github/scripts/strict-grep/i-proposed-1216-no-service-key-client.mjs` | NEW | Asserts no service-role token (`SUPABASE_SERVICE_ROLE_KEY` / `service_role` / `sb_secret` / `rk_live_|rk_test_`) anywhere under `mingla-marketing/`. |
| `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs` | NEW | Asserts `GetTheAppModal` mounts only in the explorer guard, `BetaAccessModal` only in organiser, and the two modals never cross-import. |
| `.github/workflows/strict-grep-mingla-business.yml` | EDIT | Added 4 job blocks (each `--self-test` step + live-run step), after the ORCH-1213 block. |

(The SPEC itself, `Mingla_Artifacts/specs/SPEC_ORCH-1216_...md`, remains untracked — left for the orchestrator to commit/move per its document-lifecycle rules.)

---

## 2. Gate / test / typecheck results (exact)

| Check | Result |
|---|---|
| `i-proposed-1216-testflight-behind-submit.mjs --self-test` | PASS (4/4 cases) |
| `i-proposed-1216-testflight-behind-submit.mjs` (live) | PASS |
| `i-proposed-1216-android-no-testflight-link.mjs --self-test` | PASS (3/3 cases) |
| `i-proposed-1216-android-no-testflight-link.mjs` (live) | PASS |
| `i-proposed-1216-no-service-key-client.mjs --self-test` | PASS (4/4 cases) |
| `i-proposed-1216-no-service-key-client.mjs` (live) | PASS (scanned 86 mingla-marketing/ files) |
| `i-proposed-1216-explorer-only-cta.mjs --self-test` | PASS (4/4 cases) |
| `i-proposed-1216-explorer-only-cta.mjs` (live) | PASS |
| `orch-0863-marketing-hub-phase-b.mjs` (C7 + all checks) | PASS (C1–C6 OK; C7 skipped — scoped to ORCH-0863 PRs only per ORCH-1141 re-scope; the allowlist entries remain for fallback safety) |
| Deno `submit_happy.test.ts` | 12 passed, 0 failed |
| Deno `submit_adversarial.test.ts` | 13 passed, 0 failed |
| Deno `__tests__/` (combined) | 25 passed, 0 failed |
| `tsc --noEmit` (mingla-marketing) | PASS (0 errors) |
| `node --check` on all 4 gates | OK (valid JS) |
| Workflow structure (node parse) | 4 jobs present, correct 2-space indent, 4 self-test + 4 live invocations |

**npm install:** ran `npm install --no-audit --no-fund` inside the worktree's `mingla-marketing/` (node_modules was absent; no anchor symlink available). Added 346 packages; `package.json` + `package-lock.json` are UNCHANGED (verified `git status` clean) — NO new dependency added.

---

## 3. Fails-on-revert proof

**Primary (Step-0.5 happy-path guard — CI-running):** `i-proposed-1216-testflight-behind-submit.mjs`
- On the shipped source: gate exits 0 (GREEN) — "TestFlight link sits only in the iOS success branch."
- **Hand-revert:** moved the literal `https://testflight.apple.com/join/1gvHNqkQ` into the Step-1 heading body (an idle/step render path) of `get-the-app-modal.tsx`.
- **RED captured:** gate exited **1** with `the TestFlight token appears OUTSIDE the SuccessPanel render region (1 occurrence(s)) — it must live ONLY in the iOS success branch (no fail-open).`
- **Restored** from backup; gate exits 0 again; working tree clean (no diff vs committed `927aa12b2`).

**Supplementary (edge validator):** `submit_adversarial.test.ts`
- **Hand-revert:** removed the `if (!PLATFORMS.has(platform)) fields.push("platform")` guard in `index.ts`.
- **RED captured:** `T-07 platform not in allow-set — rejected … FAILED`; suite went `10 passed | 3 failed` (T-07 + the non-string-types test + the invalid-payload fields-list test all depend on the platform guard).
- **Restored**; tree clean.

The tester will add the adversarial half of the regression PAIR (e.g. live-fire of the iOS/Android success branches on a real device); this report delivers the happy-path half + its proven fail-on-revert per SPEC §11.

---

## 4. Deviations from the SPEC (and why)

1. **TestFlight URL is inlined, not a named const.** SPEC §3.2.4 allowed either a `Button asChild` or "a styled anchor"; the marketing `Button` has no `asChild`, so I used a styled `<a>` (SPEC-permitted). I also chose to hard-code the URL literal *inline* in the iOS `<a href>` rather than as a module-level `TESTFLIGHT_URL` const. **Why:** the I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT gate requires the literal to live ONLY inside the SuccessPanel render region; a module-top-level const places the literal outside that region and trips the gate. Inlining is the stricter, hard-gate-correct posture (the SPEC says the URL appears "in this branch ONLY"). The protective comment near the imports was also worded to NOT contain the literal `testflight.apple.com` token (the gate is intentionally comment-blind for maximum strictness). No behavior change.
2. **Two TestFlight invariants split into two separate `.mjs` gates** (not folded into one). SPEC §8 permitted either; two distinct files map 1:1 to the two named invariants and to two clean workflow jobs. Both self-test fail-on-revert independently.
3. **ESLint / `next lint` not run.** There is NO ESLint config in the repo for `mingla-marketing/` — `next lint` prompts interactively to create one (it was never wired as a gate, matching how ORCH-1045 shipped). The authoritative static check is `tsc --noEmit`, which passed clean. Flagging for the tester.

No scope was widened: no app-mobile / mingla-business / native changes, no `eas update`, no new env vars, no new package.json deps, organiser `BetaAccessModal` untouched, no admin tab built (NG-6 — only the seed RPC).

---

## 5. What the tester / orchestrator MUST know before TEST / DEPLOY

1. **Migration NOT applied.** `20261124000000_orch_1216_explorer_app_leads.sql` must be applied to prod by the operator via the surgical Management-API path + a `schema_migrations` insert (HG-6 — no blind `db push`). Prefix re-confirmed FREE at implement time (highest claimed anywhere = `20261123000000`). Re-scan if time has passed.
2. **Edge fn NOT deployed.** `explorer-app-lead-submit` must be deployed from MERGED main at CLOSE. It depends on env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BETA_LEAD_IP_SALT` (REUSED from ORCH-1045 — no new salt), `RESEND_API_KEY`, and `RESEND_BETA_FROM`/`RESEND_MARKETING_FROM` (falls back to `Mingla <hello@usemingla.com>`). `config.toml` already sets `verify_jwt=false`.
3. **TestFlight link is LIVE:** `https://testflight.apple.com/join/1gvHNqkQ` (SPEC states verified HTTP 200 on 2026-06-22). It is revealed ONLY on the iOS success branch — the hard-gate. Tester should live-fire BOTH branches on a real iPhone/iPad (link shows) AND a real Android/desktop (Seth's exact message, NO link) — source-only is capped at "suspected" per the SPEC.
4. **Anon SELECT must be denied (SC-7):** RLS is deny-by-default (no anon policy). Tester should confirm `anon-key select * from explorer_app_leads` → 0 rows / permission denied once the table exists.
5. **0/8-charges-enabled-style caveat:** there is no fee data here, but note idempotency (SC-8) and throttle (T-14) require live DB to fully verify — the Deno tests cover validation/handler branches only (insert path errors to 500 without env, by design).
6. **C7 is scoped to ORCH-0863 PRs** (ORCH-1141 re-scope) so it will SKIP on the ORCH-1216 PR; the allowlist entries were still added for fallback safety. The 4 new ORCH-1216 gate jobs DO run (the workflow watches `mingla-marketing/**` + `supabase/functions/**`).
7. **No `package.json`/lock changes** — `npm install` only materialised node_modules locally for typecheck; nothing to commit there.

---

## 6. Success-criteria coverage map (implementor view)

- SC-1/SC-2 (explorer nav + 2-step flow): built (`glass-nav.tsx` + `get-the-app-modal.tsx`) — needs component/E2E test.
- SC-3/SC-4 (iOS / non-iOS submit + DB row + notify): code complete — needs full-stack live fire (migration + deploy first).
- SC-5 (hard-gate / no fail-open): enforced by code + gate 1 (proven fail-on-revert).
- SC-6 (consent + email gating): `canSubmit` requires name+email+city+consent.
- SC-7 (anon SELECT denied): migration RLS deny-all — needs live DB confirm.
- SC-8 (idempotency): `lower(email)` unique index + edge `23505` → `already_on_list` — needs live DB confirm.
- SC-9 (CI gate green): all 4 gates + C7 PASS (above).
