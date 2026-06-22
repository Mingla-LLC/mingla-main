# QA — ORCH-1211 [business notifications inbox crashes on mobile web]

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1
**Mode:** TARGETED (web-only). **Confidence:** `proven` (live real-Chromium repro of crash + fix, fresh-bundle revert/restore cycle).
**Branch:** `1211-notif-web-crash` · **Fix commit:** `7daa1e1f9` · **Tester probe commit:** `bf16ce23f`
**Worktree:** `~/Desktop/mingla-orchs/1211-[notif-web-crash]/`

One residual (non-blocking, does not gate): Samsung authed-session confirmation on the deployed
business web build is still outstanding (requires the fix live on Vercel + Seth's authed session;
the local-Chromium proof is the gating evidence and is complete).

---

## 1. Root-cause confirmation

The fix targets `BusinessNotificationsScreen.tsx:145` (now line 152), a module-top-level
`const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);`.
`LinearTransition` is `undefined` on web at module-eval, so reading `.duration` throws
`TypeError: Cannot read properties of undefined (reading 'duration')` the instant the
`/notifications` route imports the screen — crashing the page into the global ErrorBoundary.

The fix guards the builder call to native only:
```
const EXPAND_TRANSITION = isWeb
  ? undefined
  : LinearTransition.duration(durations.entry).easing(EASE_OUT);
```
On web `EXPAND_TRANSITION === undefined` → `layout={undefined}` on `<Reanimated.View>` (valid no-op,
graceful degrade). On native `isWeb === false` → the original value is byte-identical.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | With the fix, `/notifications` loads on business web with NO uncaught `duration` TypeError and NO "Something broke." ErrorBoundary fallback | **PASS** | Live Chromium probe against fresh-build expo --web `:8099`: `pageErrorCount:0`, `durationTypeError:null`, `durationConsoleError:null`, `showsErrorBoundary:false`, `rootLen:10474`, verdict PASS / exit 0. Jest web-render (real screen via react-native-web, `LinearTransition===undefined`) T-1/T-2/T-6 PASS. |
| SC-2 | FAILS-ON-REVERT: reverting the line-145 guard reproduces the exact crash + `duration` TypeError | **PASS** | Reverted source + fresh `--clear` bundle: live Chromium captured `TypeError: Cannot read properties of undefined (reading 'duration')`, stack pinned to `./notifications.tsx` import → `BusinessNotificationsScreen` line 152; LogBox overlay rendered the crash at line 152. Probe verdict FAIL / exit 1. Restored → PASS. |
| SC-3 | Samsung authed-session confirmation that "Something broke." is gone on real device | **RESIDUAL (not gated)** | Device `R58R54YV7JT` IS adb-reachable, but the CDP authed-session check needs the fix DEPLOYED to a web URL + Seth's live session; fix is pre-deploy (ships via Vercel at CLOSE). Per dispatch, recorded as residual needing Seth; local-Chromium proof is the gating evidence and is satisfied. |
| SC-4 | Change is `isWeb`-gated only; native swipe-to-delete + expand/chevron animations unchanged (byte-identical) | **PASS** | `git diff origin/main...HEAD` touches only line 145 of the screen (one ternary). Native render path (lines 546+, `<ReanimatedSwipeable>` with `layout={…EXPAND_TRANSITION}`) is byte-identical `origin/main` vs HEAD; on native `EXPAND_TRANSITION` retains the exact prior `LinearTransition.duration(...).easing(...)` value. Source assertion (acceptable per dispatch for native-unchanged). |
| HARD-1 | No `eas update` / migration / edge-fn touched | **PASS** | `git diff origin/main...HEAD --name-only` → zero `supabase/migrations`, `supabase/functions`, `eas.json`, `app.config` entries. |
| HARD-2 | DO-NOT-TOUCH preserved (`useBusinessNotifications` hook, `deleted_at` filter, `ErrorBoundary.tsx`, `app/_layout.tsx`, native swipe path) | **PASS** | None of those files appear in the diff. `deleted_at IS NULL` fetch filter intact in the untouched hook (`useBusinessNotifications.ts:164`). |
| HARD-3 | CI gate `orch-1211-notif-web-render-safe.mjs` FAILS on revert, PASSES on fix, `--self-test` green | **PASS** | `--self-test` → 7/7 PASS. Gate on fixed source → PASS (exit 0). Gate on reverted source → FAIL (exit 1), flagged line 152 "module-top-level reanimated layout-builder call". Wired into `strict-grep-mingla-business.yml` (job `orch-1211-notif-web-render-safe`, self-test + run steps) + `test:orch-1211` script. |

---

## 3. Findings

**P4 (praise) — Robust strict-grep gate.** `orch-1211-notif-web-render-safe.mjs` is well above
average: it strips comments/strings/templates (so the protective ORCH-1211 comment and the JSDoc
don't false-fire), tracks brace depth to flag only MODULE-TOP-LEVEL builder calls (depth 0), and
walks a statement buffer so a prettier-wrapped `isWeb ? undefined : Builder…` ternary is recognized
as guarded even when split across lines. It also enforces the second invariant (`<ReanimatedSwipeable>`
stays behind an `if (isWeb) return` guard). 7/7 self-test cases cover the full matrix. No defects.

No P0/P1/P2/P3 findings.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- Checked out HEAD `7daa1e1f9` (fix in place). Ran `npm run test:orch-1211`:
  - gate `--self-test` → `self-test PASS (7/7 cases)`
  - gate live → `PASS — no unguarded top-level reanimated layout-builder call`
  - jest `notifWebRender.orch1211.web.render.test.tsx` → **T-1/T-2/T-6 PASS** (3/3).
- True-line-deletion revert of the guard (line 145 → unguarded), re-ran the jest config:
  - **FAIL** — `Test suite failed to run · TypeError: Cannot read properties of undefined (reading 'duration')` at `BusinessNotificationsScreen.tsx:152:44`. (NOTE: the dispatch warned the *default* jest path mis-resolves `react-native-worklets`; the implementor's dedicated config pins reanimated to the proven web stub `LinearTransition===undefined`, so it DOES reproduce the crash — confirmed.)
- Restored via `git checkout --`; jest back to 3/3 PASS.

Implementor `fails-on-revert verified at 7daa1e1f9` (jest) — re-run by tester, hashes cited above.

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `mingla-business/playwright/orch1211-notif-web-render-probe.mjs`
- **Commit:** `bf16ce23f` (on branch `1211-notif-web-crash`, in `git diff origin/main...HEAD`).
- **Angle (distinct from implementor's jest/react-native-web render):** a LIVE real-Chromium
  (Playwright) load of the *running* `expo start --web` `/notifications` route — exercises the
  ACTUAL deployed web bundle (metro/hermes), not a jest module-graph mock. Captures uncaught
  `pageerror` + console errors + the rendered ErrorBoundary copy.
- **Env isolation note:** this machine's Supabase backend is in *live* Stripe mode while the bundle
  ships a `pk_test_` key, so the boot `stripe-mode` handshake throws `StripeModeMismatchError` in
  `<RootLayoutInner>` (a config artifact of this machine, unrelated to ORCH-1211). The probe aborts
  the `/functions/v1/stripe-mode` request so the handshake hits its documented
  unreachable→soft-warn→null path, isolating the ORCH-1211 module-eval crash from the env blocker.
- **fails-on-revert verified at `7daa1e1f9`** (true line-deletion of the guard, fresh `--clear`
  bundle): probe verdict FAIL / exit 1 with the exact `Cannot read properties of undefined (reading
  'duration')` from `./notifications.tsx` import; restored → verdict PASS / exit 0.
- Both the implementor happy-path test (`notifWebRender.orch1211.web.render.test.tsx`) and the
  tester probe appear in the closing diff.
- Evidence screenshot: `Mingla_Artifacts/reports/orch1211_evidence/orch1211_notif_web_FIX_PASS.png`.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Note |
|---|------|---------|------|
| 1 | No dead taps | N/A | No new interactive control; web row still expands/collapses (un-animated). |
| 2 | One owner per truth | PASS | Single `EXPAND_TRANSITION` owner; no new state owner. |
| 3 | No silent failures | PASS | Web degrades gracefully (no layout anim) — documented, not swallowed. |
| 4 | One query key per entity | N/A | Hook untouched. |
| 5 | Server state server-side | N/A | No state change. |
| 6 | Logout clears everything | N/A | Untouched. |
| 7 | `[TRANSITIONAL]` labeled | N/A | Not transitional; permanent web guard with a Do-NOT-remove comment. |
| 8 | Subtract before adding | PASS | Minimal one-ternary guard; nothing added beyond the guard. |
| 9 | No fabricated data | PASS | None. |
| 10 | Currency-aware | N/A | None. |
| 11 | One auth instance | PASS | Auth untouched. |
| 12 | Validate at right time | N/A | None. |
| 13 | Exclusion consistency | PASS | `deleted_at IS NULL` filter untouched in hook. |
| 14 | Persisted-state startup | N/A | None. |

No violations.

---

## 7. Device / parity matrix

| Surface | Status | Evidence |
|---------|--------|----------|
| Business Web preview (the shipping surface) | **PASS** | Live Chromium fresh-build proof (SC-1/SC-2 above). |
| Business iOS | **N/A — unchanged** | `isWeb`-gated; native render path byte-identical (SC-4 source assertion). Web-only change → does NOT ship via `eas update` (COMMS-0052). |
| Business Android (sim) | **N/A — unchanged** | Same as iOS. |
| Business Android (Seth's physical Samsung) | **RESIDUAL** | Device adb-reachable (`R58R54YV7JT`) but CDP authed-web confirmation needs the fix deployed + Seth's session; pre-deploy. Non-gating. |
| Consumer iOS/Android/Buyer web | **N/A** | Change is in `mingla-business` only; consumer app does not import this screen. |
| Admin web | **N/A** | Not affected. |

Solo/collab: N/A (notifications inbox has no collab variant).

---

## 8. Discoveries for Orchestrator

- **D-1 (env, NOT a code defect):** the local dev environment's Supabase backend is in *live* Stripe
  mode while the business bundle ships a `pk_test_` publishable key → the boot `stripeModeHandshake`
  throws `StripeModeMismatchError` and any business-web route shows "Something broke." on this
  machine until the env is aligned. This is the `MINGLA_STRIPE_MODE` drift guard working as designed
  (memory `orch-1056-unified-stripe-mode-shipped`), surfaced here only as a test-env artifact. It
  did NOT mask the ORCH-1211 verdict (isolated via network abort), but any future business-web QA on
  this machine will hit the same wall — align the local `.env`/backend mode before web QA.

---

## 9. Routing

PASS → CLOSE (orchestrator). At CLOSE: flip `I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE` to ACTIVE; ship
business web via Vercel `[deploy]` ONLY; NO `eas update` (COMMS-0052). Post-deploy, the Samsung
authed-session confirmation (SC-3 residual) can be done by Seth on the live URL.
