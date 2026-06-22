# IMPLEMENT — ORCH-1204 [web-auth-bootstrap-lock]

- **Phase:** IMPLEMENT (mingla-implementor + claude)
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1204_web-auth-bootstrap-lock.md` (binding contract)
- **Worktree:** `~/Desktop/mingla-orchs/1204-[web-auth-bootstrap-lock]` on branch `1204-web-auth-bootstrap-lock` (rebased to origin/main — was up to date)
- **Status:** implemented and verified (web logic, SSR export, tests, fails-on-revert). The A5 multi-tab live-fire on Seth's Samsung is the tester's deliverable (SPEC §9.b), not run here.
- **Fix commit:** `37ed1f861`
- **Ledger ack commit (anchor main):** `0266b0864` (COMMS-0052 BLOCK complied, COMMS-0055 WARN acked)

---

## 1. Summary (plain English)

On business web, a genuinely signed-in user could get stuck on "Loading your brands…" and then dumped to an empty "Create brand" screen, even with a perfectly valid saved session. Root cause (proven live): gotrue's Navigator-Locks auth-token lock gets contended with multiple tabs open + the auth provider remounting, so `getSession()` blows past the 3s bootstrap timeout; the 7s ceiling then treats the user as logged-out, `isAuthReady`/`user` never resolve, and the brand-list query (`useBrands`, `enabled = isAuthReady && user?.id`) never even fires.

The fix is one logic change, web-only: the three React `useState` calls for `session`/`user`/`loading` now initialize **synchronously** from the already-valid saved token via lazy initializers (through the existing web-only + SSR-guarded `readStoredWebSession()`). With a valid stored session the first paint is already authed (`loading=false`), so the brand list loads immediately and never waits on the contended lock. Off-web or with no stored session, the reader returns `null` → state is `null/null/true`, byte-identical to before, so native and the prerender are unchanged. Every existing safety net is preserved (comments only, no behavior change).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | How verified | Commit |
|----|-----------|--------|--------------|--------|
| SC-1-Web (THE CURE) | Valid stored session + hung `getSession()` → first render `session`/`user` non-null, `loading=false`, `isAuthReady=true`; brand query enabled without awaiting getSession | ✓ PASS | Test T1 reproduces the exact three initializer expressions against a mocked localStorage with a valid session + a never-resolving getSession, feeds them through the REAL `deriveBusinessAuthStatus`/`isBusinessAuthReady`; asserts `signed_in_ready`, `isAuthReady===true`, `user.id` set, `getSession` still pending. | `37ed1f861` |
| SC-2-Web (no false sign-out, server-revoked) | Background `getSession()`→`getUser()` ORCH-1106 probe still runs exactly once and signs out a server-revoked token | ✓ PRESERVED (no logic change) | Source-text assertion: `if (!bootSessionProbedRef.current) {` intact; timeout branch carries the ORCH-1204 "no probe here" note. Probe is unchanged from origin/main. Live adversarial proof = tester A1. | `37ed1f861` |
| SC-3-Web (clean logged-out) | No stored session → `null/null/true`, existing bootstrap resolves to signed-out | ✓ PASS | Test T2. | `37ed1f861` |
| SC-4-Web (ceiling cannot clobber) | 7s ceiling only sets `loading=false` + `bootstrapTimedOutRef`; never clears `user`/`session` | ✓ PASS + locked | Invariant comment added; structural test asserts the ceiling setTimeout body has NO `setUser(null)`/`setSession(null)` and DOES `setLoading(false)`. | `37ed1f861` |
| SC-5-Web (SSR/prerender safe) | Prerender (`typeof window === "undefined"`) → `null/null/true`; no new hydration warning | ✓ PASS | Test T2c; plus `web.output: "single"` (SPA, no per-route Node prerender) + `readStoredWebSession()` window guard; `npx expo export -p web` completed ("Exported: dist") with NO #418/#425/#423/#185 warnings. | `37ed1f861` |
| SC-6-Native (byte-identical) | iOS/Android → `null/null/true`; getSession still awaited | ✓ PASS | Test T2b (`Platform.OS='ios'` → null even with a stored session). Initializers funnel through the existing `Platform.OS !== "web"` gate; no native branch added. | `37ed1f861` |
| SC-7-Web (optional #6) | Lock-timeout reduction | N/A — OMITTED per SPEC OQ-1 default | `supabase.ts` not touched. | n/a |

---

## 3. Files changed

| File | Change | Δ |
|------|--------|---|
| `mingla-business/src/context/AuthContext.tsx` | 3 `useState` initializers → lazy initializers from hoisted `readStoredWebSession()`; protective comment block; ceiling-invariant comment; timeout-branch "no probe" comment | +27 / −3 |
| `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx` | NEW test (T1 cure, T2/T2b/T2c passthrough, 8 source-text fails-on-revert assertions) | +new file, 12 tests |

`git diff --stat origin/main`: 1 file changed in code (AuthContext.tsx) + 1 new test file. NO file outside the SPEC allowlist touched. Item #6 (`supabase.ts`) NOT touched.

---

## 4. Exact before/after of the 3 initializers

**BEFORE (origin/main, AuthContext.tsx:175-177):**
```ts
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
```

**AFTER:**
```ts
  // ORCH-1204 [web-auth-bootstrap-lock]: web hydrates session/user/loading
  // SYNCHRONOUSLY from the valid persisted token so isAuthReady is true on first
  // paint — ... I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION.
  // DO NOT revert to useState(null/null/true).
  const initialStored = readStoredWebSession();
  const [session, setSession] = useState<Session | null>(() => initialStored);
  const [user, setUser] = useState<User | null>(() => initialStored?.user ?? null);
  const [loading, setLoading] = useState<boolean>(() => initialStored === null);
```
(Full protective comment in source; abbreviated here.) Plus two comment-only additions: the ceiling-invariant comment at the 7s hard-ceiling block (§4.1.d) and the "no probe in the timeout branch" note (§4.1.c). No logic change to either.

---

## 5. Data-model / edge-function changes

None. Pure-JS client change. No migration, no edge function, no new dependency, no RLS.

---

## 6. Regression test

- **Path:** `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx`
- **Harness:** `mingla-business/jest.config.cjs` (`testEnvironment: node`, `preset: ts-jest`). No `@testing-library/react-native`/`react-test-renderer`/jsdom in this repo — same constraint as the sibling `AuthContext.timeout.test.ts`. T1 proves the cure at the logic level by reproducing the exact initializer expressions and feeding them through the REAL, unchanged readiness derivation (`deriveBusinessAuthStatus`/`isBusinessAuthReady` imported from `../../utils/authReadiness`); Surface B pins the behavior to the actual source file (fails-on-revert anchor).

**Run #1 — fix in place (commit `37ed1f861`):**
```
PASS src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx
  ✓ T1 (CURE) ... isAuthReady true, user.id set, loading false, no getSession await
  ✓ T2 (passthrough, web logged-out)
  ✓ T2b (passthrough, native)
  ✓ T2c (passthrough, SSR/no-window)
  ✓ hoists const initialStored = readStoredWebSession()
  ✓ session lazy initializer from initialStored
  ✓ user lazy initializer from initialStored?.user
  ✓ loading lazy initializer (initialStored === null)
  ✓ I-PROPOSED-1204 protective comment + DO-NOT-revert lock
  ✓ 7s ceiling carries ORCH-1204 invariant comment + no setUser/setSession(null)
  ✓ readStoredWebSession web-only + SSR guards
  ✓ ORCH-1106 probe still gated by bootSessionProbedRef + timeout "no probe" note
Tests: 12 passed, 12 total
```

**Run #2 — FAILS-ON-REVERT (initializers true-DELETED back to `useState(null)/useState(null)/useState(true)`):**
```
  ✓ T1 (CURE)  [behavior test reproduces initializer logic locally — still green]
  ✓ T2 / T2b / T2c
  ✕ hoists const initialStored = readStoredWebSession()
  ✕ session lazy initializer from initialStored
  ✕ user lazy initializer from initialStored?.user
  ✕ loading lazy initializer (initialStored === null)
  ✓ (comment/probe/ceiling assertions)
Tests: 4 failed, 8 passed, 12 total
```
The 4 source-text assertions that PIN the cure to the actual file fail when the fix is deleted — this is the binding fails-on-revert mechanism for this repo's source-assertion convention (matching the ORCH-0887-A sibling test). **Restored, re-ran → 12/12 PASS again.** Fix restored and committed at `37ed1f861`.

**fails-on-revert verified at `37ed1f861`.**

(Note on T1: because the repo has no React render harness, T1's behavioral assertion reproduces the initializer logic in-test and stays green under a source revert; the Surface-B source-text assertions are the file-pinned fails-on-revert anchor — the same split the ORCH-0887-A test uses. The tester's A1–A5 angles supply runtime/live-fire coverage.)

- **No-regression:** the existing `AuthContext.timeout.test.ts` (ORCH-0887-A, 18 tests) re-run alongside → both suites green, **30 passed, 30 total**. No edits to any DO-NOT-TOUCH file, which itself proves those gates stay green.

---

## 7. Old → New receipts

### mingla-business/src/context/AuthContext.tsx
- **What it did before:** AuthProvider mounted with `session=null`, `user=null`, `loading=true` unconditionally; auth state resolved only after the async `bootstrap()` (which awaits `getSession()`). When the gotrue lock was contended, getSession exceeded the 3s timeout, the 7s ceiling released loading as logged-out, and `isAuthReady` never went true → `useBrands` never fired → "Loading brands…" wedge.
- **What it does now:** on web with a valid stored session, the three initializers derive synchronously from `readStoredWebSession()` so first render is already authed (`loading=false`, `user`/`session` set); `isAuthReady` is true on first paint and `useBrands` fires immediately — independent of the lock. Off-web / no stored session / prerender → `null/null/true`, identical to before. Background bootstrap + all safety nets still run (comments locked their invariants).
- **Why:** SPEC §4.1.b (the cure) + §4.1.c/§4.1.d (preserved-safety-net comments).
- **Lines changed:** ~27 added / 3 removed (3 logic lines + 3 comment blocks).

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | No — separate AuthContext | n/a |
| 2 | Consumer Android | No — separate AuthContext | n/a |
| 3 | Buyer/anon Web | No — anon routes have no stored session → initializer returns null → byte-identical | automatic |
| 4 | Business iOS | No — web-gated; native `null/null/true` unchanged (T2b) | automatic |
| 5 | Business Android | No — web-gated | automatic |
| 6 | Admin Web | No — separate app | n/a |
| 7 | **Business Web** | **YES** — signed-in user's brand switcher + auth-gated queries load on first paint, no "Loading brands…" wedge | single surface |

Only Business Web changes behavior. All parity is automatic (one shared AuthContext, web-gated reader).

---

## 9. Smoke / verification result

- Jest: new suite 12/12, combined context suites 30/30 (PASS).
- Fails-on-revert: proven by true line-deletion of the initializers (4 assertions flip to FAIL), then restored.
- Typecheck: `npx tsc --noEmit` (project tsconfig) — zero errors in `AuthContext.tsx`, `authReadiness.ts`, or the new test. Pre-existing unrelated errors live only in `packages/phone-input` (separate package, present on origin/main, NOT in my diff); `typecheck` script exits 0.
- SSR/web export: `npx expo export -p web` completed ("Exported: dist", 142 web bundles) with NO new React hydration warnings (#418/#425/#423/#185). `dist` removed; tree clean. `web.output` is `single` (SPA) so there is no per-route Node prerender to mismatch — SSR-safety is doubly assured (build mode + `typeof window` guard).
- Strict-grep: no strict-grep gate references AuthContext (grep of `.github/scripts/strict-grep/` returned none) — none to run.

---

## 10. Known issues / deferred

- Item #6 (gotrue lock-timeout reduction in `supabase.ts`) OMITTED per SPEC OQ-1 default (the synchronous-hydration cure makes the lock irrelevant to first paint; touching the cross-tab lock adds ORCH-1100 regression risk for zero first-paint benefit).
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **No migration, no edge-function deploy** — none exist in this ORCH.
- **Ship:** Vercel `[deploy]` (web) ONLY at CLOSE. **NO `eas update` for mingla-business** (COMMS-0052 — business OTA crashes on the PostHog native module). The pure-JS change rides the next business native build.
- **No merge / push / OTA performed by this skill** — route to mingla-tester (web side; must run SPEC §9.b A1–A5, including the A5 multi-tab live-fire on Seth's Samsung), then orchestrator CLOSE (flips `I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION` to ACTIVE).

---

## 12. Discoveries for Orchestrator

- `packages/phone-input/*` has pre-existing TS7031/TS2307 errors (implicit-any binding elements; `Cannot find module 'react'`) under the mingla-business tsconfig — present on origin/main, unrelated to this ORCH. Flagging only; not fixed (out of scope).
- Anchor checkout (`~/Desktop/mingla-main`) had unrelated uncommitted items at ack time (`WORLD_MAP.md` modified, `SPEC_ORCH-1204_*.md` untracked) — left untouched per anchor-hygiene; another session owns those. My ledger ack staged COMMS_LEDGER.md only.
