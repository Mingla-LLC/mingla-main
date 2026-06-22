# TEST REPORT — ORCH-1216 [Explorer "Get the app" → lead-capture gated to TestFlight]

**Tester:** mingla-tester (brutal gatekeeper)
**Date:** 2026-06-22
**Worktree / branch:** `~/Desktop/mingla-orchs/1216-explorer-app-lead-capture/` on `1216-explorer-app-lead-capture` (rebased clean on origin/main; 5 commits ahead).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1216_EXPLORER_GET_THE_APP_LEAD_CAPTURE.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1216_EXPLORER_GET_THE_APP_LEAD_CAPTURE.md`

---

## VERDICT: CONDITIONAL PASS

The implementation is correct and the three contracts hold under independent adversarial runtime verification (50 browser assertions across every state, 7 a11y checks, 8 gating/regression checks — all PASS). The hard-gate is proven, not asserted. The CONDITIONS are the live-fire items that physically cannot be verified until the migration is applied + the edge fn is deployed (DB row, RLS deny, idempotency, throttle, Resend email, real TestFlight redirect) — these are the standard CLOSE criteria, not defects.

No P0/P1 defects found. Three P2 observations (all spec-faithful clones of ORCH-1045; flagged for awareness, none block this ORCH).

---

## 1. Contracts attacked — all hold

### Contract 1 — Hard-gate (TestFlight URL revealed ONLY on iOS-success)
Proven by 50 live-DOM assertions in a real headless Chromium driving the actual modal. The literal `testflight.apple.com/join/1gvHNqkQ` (href + "Open in TestFlight" label) is:
- **ABSENT** on: initial idle (modal closed), step 1, step 2 — across iOS, Android, Desktop-Mac, and the iPadOS-13 MacIntel+touch UA (12 idle/step assertions, all clean: `{inHtml:false,anchor:false,label:false}`).
- **ABSENT** on every error state: server (500), network (abort), rate_limited (429), validation (400) — on iOS *and* Android. Form stays mounted with data preserved + error banner shown (SC-5, no fail-open).
- **PRESENT** ONLY on iOS success (`created` AND idempotent `already_on_list`) and the iPadOS-13 desktop-UA edge → with the EXACT href `https://testflight.apple.com/join/1gvHNqkQ`.

### Contract 2 — Platform branch
- iOS UA → "You're in. Grab the app." + "Open in TestFlight" anchor (screenshot `ios-created-final.png`).
- Android UA → "You're on the list." + Seth's EXACT message "We detect you're on Android — Mingla is only available for beta testing on iOS right now. We'll let you know the moment Android drops." + NO link (screenshot `android-created-final.png`).
- iPadOS-13 edge (UA=Macintosh, platform=MacIntel, maxTouchPoints=5) → resolves iOS → link present. **Verified.**
- Touchless Desktop Mac (MacIntel, maxTouchPoints=0) → resolves non-iOS → Seth message, NO link. **Verified.**
- `isIosDevice()` logic read + the runtime edge cases both fire the correct branch.

### Contract 3 — No service-role key client-side; server re-validates; idempotent on lower(email)
- `i-proposed-1216-no-service-key-client.mjs` LIVE scanned 87 `mingla-marketing/` files → no `SUPABASE_SERVICE_ROLE_KEY` / `service_role` / `sb_secret` / `rk_*` token. Transport (`explorer-app-submit.ts`) uses the anon key only.
- Edge fn `validateLead()` re-validates EVERY field server-side regardless of client (25 Deno tests cover consent/email/interest/platform/source allow-sets, length bounds, non-string types, malformed JSON). **Verified by reading + running.**
- Migration `explorer_app_leads_email_lower_uidx` UNIQUE index on `lower(email)` structurally prevents duplicate emails even if the edge check is bypassed; handler maps PG `23505` → `already_on_list` (no 500, no second notify). **Verified by reading;** live idempotency = post-deploy CONDITION.

---

## 2. Runtime evidence (screenshots) — `Mingla_Artifacts/evidence/ORCH-1216/`

| File | Proves |
|---|---|
| `ios-created-final.png` | iOS success: "Open in TestFlight" primary button present (the hard-gate's ONLY legitimate reveal). |
| `android-created-final.png` | Android success: Seth's exact message + Done, **NO TestFlight link**. |
| `desktop-created-final.png` | Touchless Mac success: non-iOS branch, no link. |
| `ipados-created-final.png` | iPadOS-13 MacIntel+touch success: iOS branch, link present (edge case resolves correctly). |
| `ios-server-err-final.png` | iOS server-error: error banner "Something broke on our end", form data preserved, "Get the app" retry button, **NO TestFlight link**. |
| `ios-network-err-final.png` | iOS network-error: same hard-gate behaviour under abort. |
| `*-step1.png` / `*-step2.png` (12 files) | TestFlight absent through both form steps on every platform. |
| `harness/playwright-drive.mjs` | The 10-scenario / 50-assertion drive script (re-runnable). |
| `harness/playwright-a11y.mjs` | The 7-check a11y script. |
| `harness/playwright-gate-check.mjs` | The SC-6 submit-gating + T-13 organiser-regression script. |

**Harness:** real headless Chromium (Playwright 1.49 driver in a throwaway `/tmp` dir — NO dependency added to `mingla-marketing`), against `next dev` on :3216. The submit transport was intercepted via Playwright route mocking to exercise success + error branches without a deployed backend (edge fn + migration are NOT deployed — that live-fire is the CLOSE criterion). A gitignored `.env.local` with placeholder PUBLIC values let the transport pass its missing-env guard; the real network call never left the browser.

**Aggregate runtime result:** 50/50 hard-gate+platform assertions PASS; 7/7 a11y PASS; 8/8 gating+regression PASS.

---

## 3. My OWN adversarial regression test (different angle) + fails-on-revert proof

**Path:** `.github/scripts/strict-grep/i-proposed-1216-success-mount-gated.mjs` (NEW, CI-runnable, self-testing).

**Different angle:** The implementor's `i-proposed-1216-testflight-behind-submit.mjs` proves the URL is textually INSIDE `function SuccessPanel` and inside the `isIos ? (…)` true-branch — a **callee-side** check. It does NOT verify the **caller-side** gate: that `<SuccessPanel … />` is only *mounted* when `status === 'success'`. That is a real hole: if the mount condition were dropped or inverted, the success panel (and its iOS TestFlight link) would render on an idle/error state — a fail-open — and **the implementor's gate would still pass** because the URL never moved out of the function body. My gate asserts (1) exactly one `<SuccessPanel` mount, (2) its nearest-preceding status guard is `status === 'success'`, (3) the `platform=` prop is the detected state var, not a literal `"ios"`.

**Self-test:** PASS (4/4): correct gate passes; unconditional mount fires; `status === 'idle'` mount fires; `platform="ios"` literal fires.
**Live on shipped source:** PASS.

**Fails-on-revert (proven both directions):**
- Reverted the real `get-the-app-modal.tsx` mount from `status === 'success' ?` → `status === 'idle' ?` (the exact fail-open my gate targets — SuccessPanel would render on idle, leaking the iOS link before any submit).
- **My gate went RED (exit 1):** `<SuccessPanel mount is NOT gated by status === 'success' (nearest-preceding status guard = idle)`.
- **The implementor's primary gate stayed GREEN (exit 0)** on the SAME revert — decisively proving my gate guards a DIFFERENT hole than theirs.
- Restored from backup → my gate GREEN again; `git diff --stat` on the modal = empty (clean, identical to committed `927aa12b2`).
- Reverted commit/state reference: working tree HEAD `a3a349f3d`; the revert was a transient in-place edit, fully restored (no commit made).

The gate is NOT a renamed copy: it scans the JSX mount site in `GetTheAppModal`, where every implementor gate scans the `SuccessPanel` body / nav / transport / edge validator.

---

## 4. Gate / Deno / tsc results (exact)

| Check | Result |
|---|---|
| `i-proposed-1216-testflight-behind-submit.mjs` --self-test / live | PASS (4/4) / PASS |
| `i-proposed-1216-android-no-testflight-link.mjs` --self-test / live | PASS (3/3) / PASS |
| `i-proposed-1216-no-service-key-client.mjs` --self-test / live | PASS (4/4) / PASS (87 files scanned) |
| `i-proposed-1216-explorer-only-cta.mjs` --self-test / live | PASS (4/4) / PASS |
| **`i-proposed-1216-success-mount-gated.mjs` (tester's NEW gate)** --self-test / live | **PASS (4/4) / PASS** |
| Deno `submit_happy.test.ts` + `submit_adversarial.test.ts` | 25 passed, 0 failed |
| `tsc --noEmit` (mingla-marketing) | PASS (exit 0) |
| Workflow wiring (`strict-grep-mingla-business.yml`) | 4 ORCH-1216 jobs present (lines 2921–2971), each self-test + live step; workflow watches `mingla-marketing/**` + `supabase/functions/**` + `.github/scripts/strict-grep/**`. |
| Migration prefix collision re-scan | `20261124000000` > origin/main highest (`20261123000000`); no sibling-worktree claim ≥ it. FREE. |
| C7 allowlist | 4 ORCH-1216 backend files present in `orch-0863-marketing-hub-phase-b.mjs`. |
| TestFlight URL liveness | `https://testflight.apple.com/join/1gvHNqkQ` → HTTP 200. |

**Note on the tester's NEW gate:** it is wired NOWHERE in the workflow yet. Recommend the orchestrator/implementor add a 5th ORCH-1216 job block for `i-proposed-1216-success-mount-gated.mjs` (model the existing four) so the caller-side hard-gate guard runs in CI. Until then it is a self-testing script committed on the branch but not CI-enforced. **This is the one actionable follow-up (P2).**

---

## 5. P0 / P1 / P2 findings

**P0:** none.
**P1:** none.

**P2-1 (actionable) — tester's new caller-side gate not wired to CI.** `i-proposed-1216-success-mount-gated.mjs` proves a fail-open the implementor's four gates miss (success-mount gating). Add a 5th job block to `strict-grep-mingla-business.yml` to enforce it. Repro: see §3. Until wired, the mount-gate regression is caught only by this script run manually / by this report.

**P2-2 (awareness, spec-faithful) — `admin_explorer_app_leads_list()` grants EXECUTE to ALL `authenticated`, no admin-role check.** Any signed-in user could read every lead (name/email/city) via the RPC. This is an EXACT clone of ORCH-1045's `admin_beta_leads_list()` (SPEC §3.5 mandated the mirror), and there is NO admin UI in this ORCH (NG-6), so no exposure path ships. Flag for the future admin-tab ORCH to add an `is_admin()` guard inside the function. Not a 1216 blocker.

**P2-3 (awareness) — analytics double-fire on submit.** The transport fires `get_the_app_submitted` AND the modal fires `marketing_cta_clicked {cta_id:'get_the_app_submitted'}` on the same success. Both are intentional per SPEC §3.3 (transport = conversion event; modal = CTA-completion at call site) and both are consent-gated no-ops, but a downstream funnel could double-count the completion. Cosmetic; confirm with the analytics owner. Not a blocker.

No deviation from the SPEC's three Seth-locked decisions. The implementor's three self-reported deviations (inlined URL literal, two split gates, no ESLint config) are all SPEC-permitted and verified harmless.

---

## 6. CLOSE-criterion conditions (verifiable ONLY post-deploy — the CONDITIONAL in the verdict)

These cannot be proven from source or a mocked transport. They are the standard live-fire CLOSE gates, not defects:

1. **Migration applied** (`20261124000000_orch_1216_explorer_app_leads.sql`) to prod via the surgical Management-API path + `schema_migrations` insert (HG-6 — no blind `db push`).
2. **Edge fn deployed** (`explorer-app-lead-submit`, `verify_jwt=false`) from MERGED main, with env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BETA_LEAD_IP_SALT` (reused), `RESEND_API_KEY`, `RESEND_BETA_FROM`/`RESEND_MARKETING_FROM`.
3. **Live submit → DB row** (SC-3/SC-4): a real iOS + Android submit each writes one `explorer_app_leads` row with email lowercased, correct `platform`, `source='explorer_marketing_nav'`.
4. **anon SELECT denied** (SC-7): anon-key `select * from explorer_app_leads` → 0 rows / permission denied.
5. **Idempotency live** (SC-8): same email twice → exactly ONE row, 2nd returns `already_on_list`, exactly ONE Resend email.
6. **Throttle live** (T-14): 6th POST from one IP <10min → 429.
7. **Resend notify** (T-11): `created` sends ONE email to seth@usemingla.com rendering only captured fields; a forced Resend 500 still inserts the row + returns `created` (non-fatal).
8. **Real-device platform fire**: a physical iPhone/iPad (link → real TestFlight redirect, HTTP 200 confirmed) and a physical Android (Seth message, no link) — source/headless is capped at "suspected" per the SPEC for the on-device branch; the headless UA-spoof proved the branch logic but a real device closes it.

---

## 7. Bottom line

Build is correct and the hard-gate is independently proven across every render state with real-browser evidence + a fails-on-revert adversarial guard the implementor's gates don't cover. CONDITIONAL PASS pending the post-deploy live-fire list (§6) — all standard CLOSE criteria. Recommend wiring the tester's 5th gate (P2-1) before/at CLOSE. Do NOT deploy/merge/close from this report.
