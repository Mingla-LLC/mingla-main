# QA — ORCH-1202 [business-web brand-load regression]

**Skill:** mingla-tester
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1201-[web-brand-load-regression]` on branch `1202-web-brand-load-regression`
**Inputs:** SPEC `SPEC_ORCH-1202_web-brand-load-regression.md`, IMPLEMENT report `IMPLEMENT_ORCH-1202_web-brand-load-regression.md`, INVESTIGATE `INVESTIGATE_ORCH-1202_web-brand-load-regression.md`, repro harnesses `/tmp/orch-1201/`.
**Comms:** COMMS-0052 (BLOCK/ALL) re-affirmed — NO `eas update` (this QA ships nothing). COMMS-0055 (WARN) read — canonical ID is ORCH-1202.

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 1 (CI append-only RED, cheaply fixable, see F-1) · P2: 0 · P3: 1 · P4: 2.

The fix is **mechanically and structurally CORRECT and PROVEN** at every layer I could drive: the gate passes, both fails-on-revert proofs go RED at the pre-fix state and GREEN restored, the empty-200 root-cause carrier still reproduces live (desktop + Samsung Internet UA), and the multi-consumer cache mechanism is proven at runtime with real `@tanstack/query-core`. The single P1 is a **commit-packaging defect** (the `[TEST-MOD-APPROVED ORCH-1202]` override token sits on the code commit `54ead2297` but the append-only CI gate reads only the HEAD commit, which is now the report commit) → `tests-append-only.yml` will go RED on the PR as the branch currently sits. This blocks a clean merge but is not a logic defect and is fixed by re-tipping the token onto HEAD / the squash message at CLOSE.

The ONLY thing not provable headless is the literal fully-authed live web brand-switch first-paint (needs real OAuth) — capped at **SUSPECTED**, handed to Seth as an eyeball (§ Web Verification).

**Conditional on:** (a) F-1 token-on-HEAD fix before/at merge; (b) Seth's authed-web eyeball confirming the user-visible cure. Neither is a code-logic defect.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 (Web — primary) | Cold web load: DELTA-1 sections render loading→data, bell shows correct unread on first paint after auth | **PASS (mechanism) / SUSPECTED (authed first-paint)** | Empty-200 carrier reproduced live for `brand_team_members`/`notifications`/`partner_splits` (desktop + Samsung UA), gated shape provably never fires pre-auth (cache test GATED case). Authed first-paint needs Seth eyeball. |
| SC-1-iOS / SC-1-Android | Same hooks fire only after isAuthReady; no native regression (rides next build) | **PASS (source+gate) / native eyeball deferred** | Shared hook code; gate enforces fold; native splash masks JWT window. No native sim run (rides next build per SPEC). |
| SC-2 (per-hook gate) | Each 20 DELTA-1 hook folds isAuthReady; disabled queryKey is a sentinel; gate passes 61 | **PASS** | `node orch-1004...mjs` → exit 0, "all 61 auth-scoped hooks gate enabled on isAuthReady". |
| SC-3 (completeness, fail-closed) | Every src/hooks query hook classified; unregistered hook FAILS CI | **PASS** | Live: added `useTesterRevertProbe.ts` → gate exit 1 with exact §4.C message; removed → exit 0. My adversarial tests (1),(1b),(extra) confirm in sandbox subprocess. |
| SC-4 (allowlist preserved) | No public hook gated; checkPublicNotGated passes 8 | **PASS** | All 7 on-disk allowlist hooks `isAuthReady`=0; `useBrand.ts` absent (tolerated). Adversarial (4): gating `usePublicEvents` → checkPublicNotGated FAILS. |
| SC-5 (no behavior drift) | No staleTime/queryFn/key-factory/realtime/refetch changed; diff only useAuth import + fold + sentinel | **PASS** | Every removed (-) line is an `enabled` rewrite, a sanctioned queryKey-fallback swap (`"__none__"`/`?? "none"`→DISABLED_KEY), or the gate regex. Zero staleTime/refetch/queryFn deletions. Realtime in `useBusinessNotifications` GATED on `enabled` (not deleted): `if (!enabled \|\| userId === null) return;` + `enabled` in deps. |
| SC-6 (carve-outs preserved) | useBrandBanks + useBuyerRefundPreview stay ungated; files pass via co-resident | **PASS** | Both carve-out hooks present and ungated; adversarial (5): both files pass gate unmodified. |

---

## 3. Findings

### F-1 — P1: append-only CI gate (`tests-append-only.yml`) is RED at HEAD — override token is on the code commit, not HEAD
- **Evidence:** `node .github/scripts/test-append-only-check.js` → `❌ MODIFIED orch1004AllowlistIntegrity.test.ts — 1 deleted lines detected ... [TEST-MOD-APPROVED ORCH-NNNN] ... None found. Append-only check: 4 passed, 1 failed.` The token `[TEST-MOD-APPROVED ORCH-1202]` IS present and correctly formed on commit `54ead2297` (with the required `ORCH-1202 [label]` in the body), but `test-append-only-check.js` reads ONLY the latest commit body (`git log -1`, line 153-157) and HEAD is now the report commit `545ffa543` (and my test commit `27a320c56`), neither of which carries the token.
- **Impact:** The `tests-append-only.yml` PR/push CI job exits 1 → RED → blocks a clean merge as the branch sits. NOTE: the underlying modification is **legitimate** — a 1-line regex constant sync (`const\s+enabled\s*=` → `const\s+enabled\w*\s*=`) to mirror the gate's named-variable-fold broadening; no assertion was deleted or weakened (diff verified). This is purely a commit-packaging defect, not a logic defect.
- **Required fix:** Ensure the `[TEST-MOD-APPROVED ORCH-1202]` token (plus a bracketed `ORCH-1202 [...]` label) rides the HEAD commit at merge — e.g. amend/append it to the final commit body, or include it in the squash-merge commit message (Mingla's `gh merge --admin` squash flow). No code change required.
- **Retest:** `node .github/scripts/test-append-only-check.js` → exit 0 ("5 passed, 0 failed").

### F-2 — P3: gate regex broadening was a SPEC deviation (justified, accepted)
- **Evidence:** IMPLEMENT §11 deviation #1: `ENABLED_USES_IS_AUTH_READY` broadened from `const\s+enabled\s*=` to `const\s+enabled\w*\s*=` to accept `useSupportStaff.ts`'s named-variable fold `const enabledQuery = isAuthReady && ...`. Not in SPEC §4.C.
- **Impact:** Necessary to register the DO-NOT-TOUCH already-gated DELTA-2 hook `useSupportStaff.ts` without editing it (preserves SC-5). The broadening is sound: it still requires `isAuthReady` inside the `enabled` assignment. Gate self-test case (f) added; my adversarial (2) confirms a genuine fold-removal still fails. Accepted.
- **Required fix:** none (note for orchestrator at CLOSE).

### F-3 — P4 (praise): the fail-closed completeness check is the correct structural cure
- The opt-in→fail-closed inversion (`checkCompleteness` walking every `useQuery`/`useInfiniteQuery` call, `useQueryClient` excluded via `(?!Client)` lookahead) is exactly the meta-fix for the curated-list drift that shipped this regression. Confirmed origin/main's gate had NO `checkCompleteness` and only 19 registered strings — that is literally why ~20 hooks shipped ungated with green CI.

### F-4 — P4 (praise): realtime subscription correctly gated, not just the query
- `useBusinessNotifications` realtime `useEffect` now early-returns on `!enabled` (not just `userId === null`) — closes the pre-auth Supabase channel, going beyond the minimum. Matches SPEC §4.A note.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the implementor's logic at the live tree (== commit `54ead2297` gate+hook logic) and ran their proofs myself:

- **Revert 1 (per-hook fold):** `perl -0pi -e 's/const enabled = isAuthReady && userId !== null;/const enabled = userId !== null;/'` on `useBusinessNotifications.ts`, then ran the implementor's test (A):
  - `orch1202AuthScopedHookCompleteness.test.ts` (A) → **FAILED** at line 52 `expect(ENABLED_USES_IS_AUTH_READY.test(src)).toBe(true)` and line 54 `expect(src).toMatch(/const\s+enabled\s*=\s*isAuthReady\s*&&\s*userId\s*!==\s*null/)`. (1 failed, 4 passed, 4 skipped.)
  - Restored (`cp` back) → test PASSES, gate exit 0.
- **Revert 2 (completeness, fail-closed):** added `mingla-business/src/hooks/useTesterRevertProbe.ts` calling `useQuery`:
  - Live gate → **exit 1**: `ORCH-1202 completeness: unregistered query hook "useTesterRevertProbe.ts" — it calls useQuery/useInfiniteQuery but is in neither AUTH_SCOPED_HOOK_FILES nor PUBLIC_HOOK_ALLOWLIST. ...`
  - Removed fixture → gate exit 0; tree clean.

Both implementor fails-on-revert claims independently CONFIRMED. Commit hash run: `54ead2297` (live tree identical to it for gate+hook logic).

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/hooks/__tests__/orch1202CompletenessGate.tester_adversarial.test.ts` (NEW, status A — append-only safe).
- **Commit:** `27a320c56` on branch `1202-web-brand-load-regression`.
- **Both tests in closing diff:** confirmed — `git diff origin/main...HEAD --name-only` lists BOTH `orch1202AuthScopedHookCompleteness.test.ts` (implementor) AND `orch1202CompletenessGate.tester_adversarial.test.ts` (tester).
- **Angle (different from implementor):** the implementor asserts hook SOURCE shape + a single-consumer in-process cache proof. Mine runs the real `.mjs` gate as a **black-box SUBPROCESS** (exactly how CI invokes it) against **PLANTED fixtures** in a sandbox copy of mingla-business, and attacks the cache at a **different boundary** (a SECOND consumer of the same key mounting AFTER the JWT attaches while the cached `[]` is still inside the production staleTime).
- **11 tests, all green.** Covers the 6 dispatch-mandated checks:
  1. planted unregistered auth-scoped `useQuery` hook → completeness FAILS with exact §4.C message;
  1b. gated-but-unregistered hook → STILL fails (registration mandatory; also proves POSIX relpath reporting for a `marketing/` subdir file);
  2. registered hook losing `isAuthReady` (true `isAuthReady && ` deletion) → per-hook check FAILS;
  3. `useQueryClient`-only file → NOT flagged (no false positive); 3b. `useMutation`-only → NOT flagged;
  4. gating a PUBLIC allowlist hook (`usePublicEvents`) → `checkPublicNotGated` FAILS;
  5. carve-outs (`useCancelTripBooking`, `useBrandPaystack`) pass unmodified;
  + de-registering an on-disk hook (`useConversationList`) → completeness FAILS;
  + (6) cache mechanism: UNGATED first consumer caches `[]`; a later post-auth consumer is served the stale-fresh `[]` and queryFn never re-runs (`state.calls===1`); GATED pre-auth consumer disabled (nothing caches `[]`), once auth ready both consumers load the real row.
- **fails-on-revert verified at `54ead2297` (live tree):** the gate goes RED on (a) deleting a fold and (b) adding an unregistered hook; GREEN restored. My sandbox tests inject the bug to demonstrate the RED path directly within each test.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No new tappable UI. |
| 2 | One owner per truth | PASS | No new state owner; `brandListState.ts`/`useBrands.ts` untouched. |
| 3 | No silent failures | **PASS (the fix)** | This IS the fix — a pre-auth empty-200 was silently cached as success; gating makes it read as loading not empty. |
| 4 | One query key per entity (factory) | PASS | Key factories preserved; disabled state routed to a `DISABLED_KEY` sentinel; no hardcoded entity keys added. |
| 5 | Server state server-side (Zustand=client) | PASS | All changes are in React Query hooks; no Zustand. |
| 6 | Logout clears everything | N/A | Not touched. |
| 7 | Label temporary [TRANSITIONAL] | N/A | Nothing transitional. |
| 8 | Subtract before adding | PASS | Dropped redundant `"__none__"`/`?? "none"` fallback keys in favor of one canonical DISABLED_KEY. |
| 9 | No fabricated data | PASS | Disabled query returns undefined/loading, never a faked empty. |
| 10 | Currency-aware | N/A | No pricing. |
| 11 | One auth instance | PASS | Reads `isAuthReady` from the single `useAuth()`; no new auth instance. |
| 12 | Validate at right time | PASS | Auth-readiness check at fire time is the correct gate. |
| 13 | Exclusion consistency | N/A | No exclusion logic. |
| 14 | Persisted-state startup gate | **PASS (reinforces)** | The fix is precisely a startup-ordering gate (don't fire until auth hydrated). |

No constitutional violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence / reason |
|---------|---------|-------------------|
| Consumer iOS (`app-mobile/`) | N/A | Separate codebase; these are mingla-business hooks. |
| Consumer Android (`app-mobile/`) | N/A | Same. |
| Buyer/anon Web | **PASS (protected)** | Allowlist additions keep all 7 on-disk public hooks ungated (`isAuthReady`=0); adversarial (4) proves gating one fails CI. |
| Business iOS | PASS (source+gate) / native eyeball deferred to next build | Shared hook code; gate enforces the fold. No sim run (rides next native build per SPEC §3; OTA blocked by COMMS-0052). |
| Business Android | PASS (source+gate) / native eyeball deferred | Same. |
| Admin Web (`mingla-admin/`) | N/A | Separate app. |
| **Business Web (primary, adjacent)** | **PASS (mechanism) / SUSPECTED (authed first-paint)** | Empty-200 carrier reproduced live (desktop Chrome + Samsung Internet UA); gated shape provably blocks the pre-auth fire. Authed first-paint = Seth eyeball. |

**Physical iPhone HITL:** not required — the bug is web-acute (async JWT attach slowest on mobile-web), the native eyeball rides the next business build, and the OTA is BLOCKED (COMMS-0052). No HITL step issued.

**Live deploy state:** N/A — no edge function / migration. Hook + CI only (IMPLEMENT §4). Nothing to deploy-verify.

---

## 8. Web Verification (PROVEN vs SUSPECTED)

**PROVEN (real Chromium, live Supabase):** Ran `/tmp/orch-1201/repro_empty200.mjs` (Playwright 1.60.0, real headless Chromium) under BOTH `DESKTOP Chrome (1440x900)` and `WEB-MOBILE Samsung Internet (Galaxy S9+ UA + 360x740)`. All three RLS-`auth.uid()`-scoped tables behind DELTA-1 hooks — `brand_team_members` (useBrandInvitations), `notifications` (useBusinessNotifications), `partner_splits` (usePartnerSplits) — return **HTTP 200 + `[]`** to a pre-auth anon (anon-key-only, no user JWT) fire. `cachedAsSuccess:true, willRetry:false` on every row. **VERDICT: REPRODUCED.** This independently confirms the root-cause carrier is live and real.

**Reasoning the gated hooks prevent the pre-auth fire (PROVEN by structure + runtime):** with `enabled: isAuthReady && <pred>`, `enabled` is `false` until `authStatus === "signed_in_ready" && session.access_token` (authReadiness.ts). React Query never invokes the queryFn while disabled → supabase-js issues NO anon request → nothing is cached as the empty-200 success → when auth attaches, the observer flips to the real key + `enabled:true` and fires WITH the JWT, returning the real row. Proven at runtime by my GATED cache test (pre-auth observer disabled → `getQueryData` undefined, `calls===0`; post-auth → `calls===1`, data = the row) and the UNGATED control (late post-auth consumer stranded on stale-fresh `[]`, `calls===1`).

**SUSPECTED (Seth eyeball required):** the literal fully-authed live web brand-switch producing populated sections on first paint cannot be driven headless (real OAuth sign-in). Capped at SUSPECTED per the dispatch + investigation OQ-4. See § Seth eyeball steps below.

---

## 9. Pre-existing-failure confirmation

Two jest suites fail under node/ts-jest on a transitive `posthog-react-native` / `expo-constants` ESM transform (not in `transformIgnorePatterns`), reached via `useTrips.ts:33` → `postHogService.ts:36`:
- `src/hooks/__tests__/brandListState.test.ts`
- `src/hooks/__tests__/authScopedQueryReadiness.test.ts`

**Confirmed pre-existing — NOT caused by ORCH-1202.** I ran these two suites against a fresh `origin/main` worktree (`git worktree add /tmp/orch1202-mainbase origin/main`, symlinked shared node_modules): result identical — `Test Suites: 2 failed, 2 total; Tests: 1 failed, 3 passed`, same `useTrips.ts:33` transform stack. On the ORCH-1202 branch the full hooks suite is `2 failed, 24 passed (26 total); 1 failed, 154 passed (155 total)` — the same 2 suites, plus my +11 adversarial tests all green. These do not block; flagged for orchestrator (a shared AuthContext jest mock or a transformIgnorePatterns allowance). Temp baseline worktree removed; tree clean.

---

## 10. Discoveries for Orchestrator

- **D-1 (the F-1 root, recurrence-prone):** `test-append-only-check.js` reads the token from ONLY the HEAD commit (`git log -1`). Any pipeline where the test-modifying commit is not the branch tip (e.g. a later docs/report commit) will RED even with a valid token on the right commit. Consider scanning the full `baseRef...HEAD` commit range for the token, or document "token must ride HEAD / the squash message" in the worktree close runbook. (Out of ORCH-1202 scope.)
- **D-2:** node/ts-jest cannot transform `react-native`/`expo-constants`/`posthog-react-native` ESM; any hook test importing an AuthContext-using hook without mocking AuthContext fails on a transform error. As more hooks adopt `useAuth`, this recurs (the implementor already added 2 collateral mocks). A shared AuthContext jest mock or transformIgnorePatterns allowance would stop the bleed. (IMPLEMENT §12 D-1 — re-affirmed.)
- **D-3:** F-7 stale-chunk "reload to load" tail remains unaddressed (investigation OQ-3) — separate low-priority thread.

---

## 11. Accepted conditions (CONDITIONAL PASS)

This verdict is CONDITIONAL on two items, neither a code-logic defect:
1. **F-1 (P1):** the `[TEST-MOD-APPROVED ORCH-1202]` override token must ride the HEAD commit / squash message at merge so `tests-append-only.yml` is GREEN. (Cheap re-tip; no code change.) Surfaced to Seth — NOT auto-accepted (no follow-up ORCH cited in the dispatch). If Seth/orchestrator handles it at CLOSE, this becomes a clean PASS.
2. **SC-1 authed-web first-paint (SUSPECTED):** Seth's authed-web eyeball per § below.

No P0; no unaccepted P1 that is a logic defect. Mechanism + structure fully proven.
