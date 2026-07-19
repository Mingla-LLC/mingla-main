# IMPLEMENTATION — ORCH-1404 [accept-invite-web-error-recovery]

**Mode:** IMPLEMENT (mingla-implementor). Dispatched by mingla-orchestrator.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1404_accept-invite-web-error-recovery.md` (commit `f71a7a47d`).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1404-[accept-invite-web-error-recovery]/` on branch `ORCH-1404-accept-invite-web-error-recovery`.
**Implementation commit:** `8c88b25bb` (all 5 files).
**Status:** implemented and verified (unit/service/component + fails-on-revert both directions). Route runtime (SC-2/SC-5-order/SC-7/SC-10) handed to mingla-tester — could not live-fire the browser UI this session.
**Deploy:** merge commit MUST carry `[deploy]` (Vercel business-web rebuild). OTA N/A (web export).

---

## 1. Summary (plain English)

Today every failed brand-invite accept on business web shows the same dead screen — "Something went wrong (status 500) / Back to Mingla" — regardless of the real reason. This ships two coupled, web-only fixes:

1. **The error parse is fixed.** The client was reading the HTTP status and error code from the wrong field on a Supabase edge-function error, so every failure collapsed to a generic 500. It now reads the real status from `error.context.status` and the real code from the awaited response body, so "this invite went to a different email", "already accepted", "expired", "revoked", "not found", "connect your bank" each show their specific, already-written message. Added the one missing message (session expired / 401) and dropped the raw "(status N)" number from the generic fallback.
2. **"Wrong account" is now recoverable.** When the invite was sent to a different email than the one signed in, the screen now offers **"Sign in with a different email"** — it signs the current user out and resumes the invite after they sign in as the correct account (reusing the existing ORCH-1373/1375 `?next=` path and its single security validator). "Back to Mingla" remains as the secondary action. No more dead end.

No backend, migration, native, or funnel work — pure client parse + UI.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | 403 mismatch → `.status===403`, `.code==="invite_email_mismatch"` (not 500/server) | ✓ verified | File A T-1, `8c88b25bb` |
| SC-2 | 403 mismatch renders "Wrong account" (not generic 500) | ✓ (copy map) / route render → tester | `errorCopyFor("invite_email_mismatch")==="Wrong account"` (File B); route branch wired `8c88b25bb`; live route render = tester |
| SC-3 | 404/410×4/409/400/401 each render their specific title | ✓ parse verified (File A T-2) + 401 copy (File B) | parse for all codes proven; `unauthenticated`→"Sign in to continue" |
| SC-4 | Wrong-account screen has switch + Back buttons | ✓ verified | File B T-6, `8c88b25bb` |
| SC-5 | Switch calls `signOut()` THEN `router.replace(/auth?next=<encoded accept url>)` | ✓ routing verified (File B T-8); **sign-out-before-nav ORDER = tester runtime** | `buildSwitchAccountResume` + `handleSwitchAccount` awaits `signOut()` first |
| SC-6 | `next` validated; `//evil.com` + `..` traversal → null | ✓ verified | File B T-9 |
| SC-7 | After signing in as invited email, `/auth` resumes + accept succeeds | UNVERIFIED — integration/runtime → tester | reuses shipped ORCH-1373/1375 path unchanged |
| SC-8 | Unknown/network error → sane generic message, no raw "status 500" | ✓ verified | File A T-4 (status 0/server); File B default-copy no-number test |
| SC-9 | Signed-in email line only when non-null; renders when null | ✓ verified | File B T-6b + T-10 |
| SC-10 | No regression to success / signed_out / auth-error screens | ✓ source-preserved; runtime → tester | those render branches untouched; 120 adjacent tests green |

---

## 3. Files changed

| File | Type | Δ |
|------|------|---|
| `mingla-business/src/services/brandInvitationsService.ts` | modified | +149 / −43 region (net: `extractStatus`/`extractErrorCode` → `parseFunctionsError` + 5 call sites) |
| `mingla-business/app/accept-brand-invitation.tsx` | modified | +71 (imports, `user`/`signOut`, `buildSwitchAccountResume`, `handleSwitchAccount`, mismatch branch, `unauthenticated` copy, default de-numbered, `errorCopyFor` exported + `status` param dropped) |
| `mingla-business/src/components/invite/WrongAccountRecovery.tsx` | NEW | presentational recovery screen |
| `mingla-business/src/services/__tests__/orch_1404_functions_error_parse.tester.test.ts` | NEW (append-only) | 13 tests |
| `mingla-business/src/components/invite/__tests__/orch_1404_wrong_account_recovery.tester.test.tsx` | NEW (append-only) | 12 tests |

All 5 committed in `8c88b25bb`.

---

## 4. Data-model changes applied

None. `supabase/**` untouched (DO-NOT-TOUCH honored; edge fn already returns correct codes per SPEC §4.0).

---

## 5. Edge functions touched

None. For reference (unchanged, deploy nothing): `accept-brand-invitation` already returns the correct status codes + `{ error }` bodies.

---

## 6. Regression tests added (fails-on-revert proof)

Both NEW, append-only (no existing test modified/deleted). Run under the default `jest.config.cjs` (node/ts-jest) via `npx jest <file>` — no new config, no RN render harness, no source-text/token-presence guards (all behavioral).

**(A) `src/services/__tests__/orch_1404_functions_error_parse.tester.test.ts`** — 13 tests.
- Green (fix in place): `Tests: 13 passed`.
- **Fails-on-revert @ `8c88b25bb`:** true line-deletion of `return { status, code };` inside the `isResponseLike(ctx)` branch → a `FunctionsHttpError` falls through to the generic path. Re-run → T-1 `Expected: 403 / Received: 0` (FAIL), plus T-2/T-3/T-5b red. Restored → green.

**(B) `src/components/invite/__tests__/orch_1404_wrong_account_recovery.tester.test.tsx`** — 12 tests.
- Green (fix in place): `Tests: 12 passed`.
- **Fails-on-revert @ `8c88b25bb` (recovery component):** deleted the "Sign in with a different email" `<Button>` from `WrongAccountRecovery` (pre-1404 Back-only shape). Re-run → T-6/T-7 + null-email button check FAIL (`3 failed, 9 passed`). Restored → green.
- **Fails-on-revert @ `8c88b25bb` (routing helper):** neutered `buildSwitchAccountResume` to `return "/auth"` (drop the validated `next`). Re-run → T-8 `Expected: true / Received: false` (FAIL, `1 failed, 11 passed`). Restored → green.

Both files are visible in `git diff origin/main...HEAD --name-only` on the closing branch (committed in `8c88b25bb`, not absorbed via merge).

---

## 7. Old → New receipts

### `src/services/brandInvitationsService.ts`
**Before:** `extractStatus(error)` read `error.context.response.status` (never exists on a `FunctionsHttpError`) → undefined → fell to `error.status` (absent) → **500**. `extractErrorCode(data, error)` read `data.error` — but supabase-js sets `data = null` on non-2xx → **null → "server"**. So EVERY failure → `{500, "server"}`.
**After:** `parseFunctionsError(error)` (async, exported) reads `error.context.status` and the code from `await error.context.clone().json()` body (`.clone()` so a second reader can't starve the body; `catch` → generic). Legacy top-level `.status`/`.code` fallback preserved (re-thrown errors). Network `FunctionsFetchError` (context not a Response) → `{status:0, code:"server"}` → generic copy, never a fake 500. All 5 call sites (`inviteBrandMember`, `acceptBrandInvitation`, `acceptMyPendingInvitation`, `declineBrandInvitation`, `listMyPendingInvites`) migrated to `await parseFunctionsError(error)`; decline keeps its `status===410 || code==="invite_not_actionable"` treat-as-success branch (now fed correct values). Dropped the unused `data` from decline's destructure.
**Why:** F-2 / SC-1 / SC-3 / SC-8 / I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL.

### `app/accept-brand-invitation.tsx`
**Before:** `errorCopyFor(code, status)` (private) had no `unauthenticated` case (fell to default); default leaked "(status N)". Error render was one "Back to Mingla" card for ALL codes. `useAuth()` gave only `authStatus`.
**After:** `errorCopyFor(code)` exported; added `unauthenticated` → "Sign in to continue"; default de-numbered ("We couldn't accept this invitation right now. Try again in a moment."). Added exported pure `buildSwitchAccountResume(token)` → `sanitizeNextRoute`-validated `/auth?next=…` (null → bare `/auth`). `useAuth()` now `{ authStatus, user, signOut }`. Added `handleSwitchAccount` (await `signOut()` FIRST, then `router.replace(buildSwitchAccountResume(token))`). Error render branches: `invite_email_mismatch` → `<WrongAccountRecovery signedInEmail={user?.email ?? null} onSwitchAccount onGoHome />`; all other codes unchanged.
**Why:** F-1 / SC-2/4/5/6/9 / I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE.

### `src/components/invite/WrongAccountRecovery.tsx` (NEW)
**Before:** did not exist.
**After:** presentational full-screen card (reuses the route's `canvas`/`glass`/`radius`/`spacing`/`text` tokens + the WCAG-compliant `Button size="lg"`): title "Wrong account", verbatim mismatch body, optional "You're signed in as {email}." line (only when non-null), primary "Sign in with a different email" (`onSwitchAccount`) + ghost "Back to Mingla" (`onGoHome`). No async/navigation inside — the route handler owns sign-out/nav, so the interactive action is runtime-testable in isolation.
**Why:** SPEC §4.5 / interactive-elements-must-fire runtime-proof rule.

---

## 8. Cross-surface impact

| # | Surface | Affected | What changes | Parity |
|---|---------|----------|--------------|--------|
| 1 | Consumer iOS | No | brand invites are a business concept | n/a |
| 2 | Consumer Android | No | — | n/a |
| 3 | Buyer/anon Web (mingla-business) | **Yes — primary** | specific failure copy + recoverable wrong-account | shared code (all web) |
| 4 | Business iOS (native) | Incidental | same shared files compile native; `window`/`sessionStorage` already native-safe | automatic (shared) |
| 5 | Business Android (native) | Incidental | same as iOS | automatic (shared) |
| 6 | Admin Web | No | not in invite accept | n/a |
| 7 | Business Web preview | No | no preview surface for this route | n/a |

No manual-parity split — one shared codebase; native inherits automatically.

---

## 9. Smoke / gate results

- **New tests:** `npx jest <both files>` → `Test Suites: 2 passed, Tests: 25 passed`.
- **Fails-on-revert:** all three mutations proven red then restored green (§6).
- **Adjacent regression:** `npx jest src/components/invite/__tests__ src/utils/__tests__/nextRoute.test.ts orch_1375_adversarial_next_url_resolution orch_1373_next_route_traversal` → `5 suites, 120 tests passed`.
- **Strict-grep gates touching these files:** `orch-1050-brand-invite-functional` PASS, `orch-1052-partner-identity` PASS, `orch-1342-store-links-ssot` PASS, `orch-0863-marketing-hub-phase-b` PASS.
- **`.web.*` twin check (COMMS-0112 bug class):** none of the 3 source files has a `.web.*` twin → no shim-parity obligation.
- **Typecheck:** my 5 files produce **zero** `tsc` errors. (`npx tsc --noEmit` reports 800 PRE-EXISTING errors, all in workspace packages `offering-rendering`/`brand-rendering`/`phone-input` etc. and unrelated test dirs — `tsc` is not a clean gate on this monorepo; my change adds nothing to it.)
- **Runtime (browser) not driven this session** — see Known issues.

---

## 10. Invariants

**Preserved:**
- I-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE — auth-axis render (`authStatus` branches) untouched; recovery is a phase-resolved error branch, not an auth-boolean gate.
- ORCH-1375 open-redirect safety — recovery routes ONLY through `sanitizeNextRoute` + `/auth`; no raw `router.replace(next)`. Proven by SC-6 (File B T-9).
- Consume-once `?next=` handoff — unchanged; `/auth` owns it.
- FunctionsHttpError body-read safety — `.clone().json()` so no other reader is starved.

**Proposed (orchestrator flips ACTIVE on CLOSE):** I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL, I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE.

---

## 11. Operator action required

- **Merge with `[deploy]`** on the squash commit (Vercel business-web rebuild). No migration, no edge deploy, no OTA.
- **No `db push`, no edge-function deploy** — none in scope.

---

## 12. Discoveries for Orchestrator

1. **CI wiring for the two new tests is NOT in this branch (outside allowlist).** In this repo, tester/implementor regression tests gate via a DEDICATED workflow (`npx jest <files>`) — e.g. `orch-1371-1372-tester-adversarial.yml`, `meta-orch-1337-social-proof-tests.yml`. The default `jest-suites` job runs strict-grep class-D, not a full `npx jest`. My two files run + pass locally under the default config, but nothing in `.github/` invokes them yet. The SPEC allowlist forbids `.github/**`, so I did NOT add a workflow (STOP-AND-note rather than silently widen). **Orchestrator/tester should wire a workflow (or add these two files to an existing suite) so they actually gate at CLOSE.**
2. **Scanner sibling (SPEC §4.6 / OQ-5):** `src/services/scannerInvitationsService.ts:220-241` carries the byte-identical `extractStatus`/`extractErrorCode` parse bug (dead error copy on `accept-scanner-invitation.tsx`). Deferred to ORCH-1406 per SPEC; NOT touched here. `scanner_invitations` = 0 prod rows.
3. **Currency-mismatch (409) recovery (SPEC §2 / §10):** the "Connect your bank first" screen still has no bank-link action — wiring one needs a `brandId` the 403/409 body doesn't carry. Follow-up.
4. **Route-level runtime SCs (SC-2 render, SC-5 sign-out-before-nav order, SC-7 resume, SC-10 no-regression) need live browser verification** — I proved the parse, the copy map, the routing helper, the validator, and the component in isolation, but did not drive the `business.usemingla.com` accept flow in a browser this session. Handed to mingla-tester.
5. **`errorCopyFor` lost its `status` param** (now `errorCopyFor(code)`) since the default no longer shows the number — the one call site was updated in the same file. `Phase.status` is still carried (harmless; documents the HTTP status).
