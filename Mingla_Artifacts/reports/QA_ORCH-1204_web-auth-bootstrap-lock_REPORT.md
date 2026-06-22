# QA Report — ORCH-1204 [web-auth-bootstrap-lock]

**Phase:** TEST (mingla-tester, web/deterministic side)
**Worktree:** `~/Desktop/mingla-orchs/1204-[web-auth-bootstrap-lock]/` on branch `1204-web-auth-bootstrap-lock`
**Fix commit under test:** `37ed1f861`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1204_web-auth-bootstrap-lock.md` (§9.b contract)
**Date:** 2026-06-22

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 1.

Deterministic adversarial angles A1–A4 all PASS with runtime/source-true evidence. The fix is
sound, scoped to the three lazy `useState` initializers, touches no DO-NOT-TOUCH file, is
native-byte-identical and SSR-safe, and the server-revoked sign-out path is provably intact.

Verdict is CONDITIONAL (not full PASS) for exactly one reason: **A5 — the live multi-tab Samsung
fire — is the orchestrator's post-deploy responsibility** (SPEC §9.b A5, dispatch-confirmed). A
full PASS on a UI/runtime cure requires the `proven`-level live-fire that A5 represents; that is
explicitly out of this leg's scope and owned downstream. No P1 was accepted/deferred — the
condition is the externally-owned A5, not a defect.

Regression gate: SATISFIED. Implementor happy-path test present + on-branch + in-diff with
fails-on-revert; tester adversarial test present + on-branch + in-diff (different angle: A1 probe
behavior + A3 ceiling-clobber + structural revert anchors) with its own fails-on-revert.

---

## 2. SC-by-SC matrix (deterministic angles)

| SC | Angle | Verdict | Evidence |
|----|-------|---------|----------|
| SC-1-Web (the cure) | implementor T1 | PASS | `authContext.sync-hydration.orch1204.test.tsx` T1: valid stored session + hung getSession → `isAuthReady===true`, `user.id` set, `loading===false` on first paint without awaiting getSession. Re-run green (41/41). |
| SC-2-Web (revoked still signs out) | **A1** | PASS | Adversarial test: every server-revoked error shape (401/403/`session_not_found`/`AuthSessionMissingError`/`bad_jwt`) classifies to `invalid_session` via the REAL `classifyBootSessionProbe`; transport errors fail-open to `keep_session`. Source-true: probe stays under `bootSessionProbedRef` one-shot in the getSession-resolved branch; timeout branch is probe-FREE (no `supabase.auth.getUser(` call). |
| SC-3-Web (clean logged-out) | implementor T2 | PASS | No stored session → null/null/true → `isAuthReady===false` (bootstrapping). No false signed-in flash. |
| SC-4-Web (ceiling cannot clobber) | **A3** | PASS | Source slice of the `hardCeilingTimer` setTimeout body: contains `setLoading(false)` + `bootstrapTimedOutRef.current = true`, contains NEITHER `setUser(null)` NOR `setSession(null)`. Logic: a hydrated `signed_in_ready` user survives a `loading` flip (status is loading-independent for a usable session+user). |
| SC-5-Web (SSR/prerender safe) | **A2** | PASS | `readStoredWebSession()` returns null when `typeof window === "undefined"` (verified via the production guard text + the off-window logic case → null/null/true). Prerender tree therefore matches origin/main (no new #418/#425). See §6 note. |
| SC-6-Native (byte-identical) | **A4** | PASS | `Platform.OS = ios` AND `= android` WITH a stored session → null/null/true (no synchronous hydration). The off-web disjunct of the guard is pinned in source. Native initial state identical to pre-change. |
| SC-7-Web (optional #6) | N/A | N/A | Item #6 (lock-timeout reduction) was correctly OMITTED (SPEC OQ-1 recommendation). `supabase.ts` untouched. |

---

## 3. Findings

### P3-1 (LOW) — implementor's behavioral T1 does not independently fail-on-revert
**Evidence:** Step 0.5 re-run. With the three initializers reverted to `useState(null/null/true)`,
the implementor test's behavioral cases (T1/T2/T2b/T2c) stay GREEN; only its Surface-B source-text
assertions (4 cases) go RED. Root cause: `computeInitialAuthState()` re-declares
`readStoredWebSession` + the initializer expressions LOCALLY inside the test rather than importing
production behavior, so reverting the production file cannot change the local computation.
**Impact:** The fix IS still pinned (any revert deletes the source lines → 4 Surface-B FAILs), so
the regression net holds — but the *behavioral* T1 is a cure-direction demonstration, not a
fails-on-revert behavioral guard. Low severity (no runtime impact; net is intact).
**Required fix:** None mandatory. The tester adversarial test partially closes this from a
different direction (structural revert anchors tied to the exact production statements).
**Retest:** Already covered — see §5.

### P4-1 (NOTE) — clean, well-scoped fix with strong in-source invariant comments
The fix is exactly the three lazy initializers + comment-only ceiling/timeout-branch invariant
notes. The `readStoredWebSession()` web+SSR guard pre-existed and is reused. The ORCH-1106 probe,
ORCH-1102 ceiling, ORCH-0887-A race, ORCH-1004 late-adopt, and Constitution #6 sign-out paths are
untouched. Good defensive engineering.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Checked out / ran at:** branch `1204-web-auth-bootstrap-lock`, fix commit `37ed1f861`.
- **Procedure:** backed up `AuthContext.tsx`, reverted the three initializers to the pre-fix
  `useState(null)` / `useState(null)` / `useState(true)` (true line-deletion of the fix), ran the
  implementor test, then restored from backup.
- **FAIL on revert (captured):** 4 RED assertions, all Surface-B source-text:
  - `Expected pattern: /const initialStored = readStoredWebSession\(\);/`
  - `Expected pattern: /const \[session, setSession\] = useState<Session \| null>\(\(\) => initialStored\);/`
  - `Expected pattern: /const \[user, setUser\] = useState<User \| null>\(\(\) => initialStored\?\.user \?\? null\);/`
  - `Expected pattern: /const \[loading, setLoading\] = useState<boolean>\(\(\) => initialStored === null\);/`
  - Behavioral T1/T2/T2b/T2c stayed GREEN (see P3-1).
- **PASS on restore (captured):** all 30 implementor-suite assertions green; combined AuthContext
  suite 41/41.

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/context/__tests__/authContext.adversarial.orch1204.test.tsx`
- **Angle (DIFFERENT from happy-path):** A1 server-revoked sign-out (behavioral, via the REAL
  `classifyBootSessionProbe`) + A3 ceiling-cannot-clobber (source slice) + A4 native parity +
  A2 SSR + structural revert anchors tied to the exact production statements (hydration present,
  probe one-shot gated, timeout branch probe-FREE, both guard disjuncts present, loading derives
  from stored session). 11 assertions, all green at fix (`37ed1f861`).
- **fails-on-revert verified at `37ed1f861`:** reverting the three initializers turns 2 adversarial
  assertions RED:
  - `STRUCTURE: hydration is present AND the probe stays one-shot ... timeout branch probe-FREE`
    (the hydration line `useState<User | null>(() => initialStored?.user ?? null)` is gone)
  - `loading uses the lazy () => initialStored === null form, NOT useState(true)`
  Restored → all 11 green again.
- **In-diff confirmation:** `git diff origin/main...HEAD --name-only` after commit shows BOTH
  `AuthContext.tsx`, the implementor happy-path test, AND this adversarial test (see §8).
- **Append-only:** no existing test file modified; this is a NEW file.

---

## 6. SSR / hydration-mismatch note (A2)

`readStoredWebSession()` short-circuits to `null` when `typeof window === "undefined"`
(AuthContext.tsx:91), so the Expo-web static-export prerender produces the SAME null/null/true
initial tree as origin/main — the lazy initializers cannot read `localStorage` server-side. A full
Expo-web static export was not run in this leg (heavy; the guard is unconditional and proven by
precise reasoning + the off-window logic case, which SPEC §9.b A2 permits). No new React #418/#425
hydration warning is introduced because the server tree is byte-identical to pre-change and the
client re-reads `localStorage` only on the first client render — the standard SSR-safe pattern.

---

## 7. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No new interactive surface. |
| 2 | One owner per truth | PASS | `session/user/loading` still owned solely by AuthProvider; hydration is an initializer, not a competing writer. |
| 3 | No silent failures | PASS | `readStoredWebSession` try/catch returns null on parse error (logged-out treatment, not a swallow); probe sign-out path logs via console.warn. |
| 4 | One query key per entity | N/A | No query keys touched. |
| 5 | Server state server-side | PASS | No Zustand change; session state is React state as before. |
| 6 | Logout clears everything | PASS | SIGNED_OUT + signOut() clear paths untouched; revoked-session probe still drives full clear. |
| 7 | Label transitional | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Net change is 3 initializers + comments; no parallel new path. |
| 9 | No fabricated data | PASS | Hydrates the REAL persisted token; `hasUsableBusinessSession` gates garbage. |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | PASS | Single `supabase` client; no new instance. |
| 12 | Validate at right time | PASS | Probe validates against server post-hydration (ORCH-1106 intact). |
| 13 | Exclusion consistency | N/A | |
| 14 | Persisted-state startup | PASS | This fix IS the hydration gate done correctly (web reads persisted token at mount; native unchanged). |

No violations → no automatic P0.

---

## 8. Device / parity matrix

| Surface | Ships here? | Verdict | Evidence |
|---------|-------------|---------|----------|
| Business Web | YES (the cure target) | PASS (deterministic A1–A4) / A5 orchestrator-owned | Jest + source-true; live multi-tab = A5 (downstream). |
| Business iOS | YES | PASS (A4 native parity) | `Platform.OS=ios` → null/null/true; no synchronous hydration; bootstrap byte-identical. |
| Business Android | YES | PASS (A4 native parity) | `Platform.OS=android` → null/null/true. |
| Buyer/anon Web | YES (must not break) | PASS | Anon routes never `useAuth`; logged-out path (SC-3) → null/null/true unchanged. |
| Consumer iOS/Android | NO | skipped | `app-mobile` has its own AuthContext; this change is `mingla-business`-only. |
| Admin Web | NO | skipped | Separate codebase. |
| Business Web preview | YES | covered by Business Web row | |

**Edge-fn live deploy state:** N/A — no edge function, migration, or RLS touched (front-end-only).

**Physical-device HITL:** A5 (Seth's Samsung, ≥3 same-origin tabs, cold reload → `/rest/v1/brands`
fires + brand switcher loads, no "Loading brands…" wedge) is the orchestrator's post-deploy
live-fire per SPEC §9.b A5 + this dispatch. NOT attempted in this leg.

---

## 9. Discoveries for Orchestrator (not fixed here — out of scope)

- **D-1 (pre-existing, unrelated):** `src/hooks/__tests__/authScopedQueryReadiness.test.ts` fails
  to RUN with `SyntaxError: Cannot use import statement outside a module` under the default
  node/ts-jest config. Proven pre-existing: fails identically on origin/main's AuthContext with the
  ORCH-1204 test stashed. A jest transform/config gap, not an ORCH-1204 regression.
- **D-2 (pre-existing, unrelated):** `src/hooks/__tests__/brandListState.test.ts` fails one
  source-text assertion (`Expected substring: "!isError && brand === null"`) — product source has
  drifted from the asserted string. Proven pre-existing on origin/main. Worth a backlog
  housekeeping item; zero relation to ORCH-1204.
- **D-3 (process note):** the broad `jest -t "auth"` whole-repo run reports ~45 suite failures /
  5 test failures, but these are whole-repo environment/transform noise (search, events, trips,
  notifications) — the directly-relevant suites are clean (AuthContext 41/41, coldLoadAuthGates
  18/18). Not a regression signal.

---

## 10. Verification log (commands run)

- `jest src/context/__tests__/` at fix → 41/41 PASS (3 suites).
- Step 0.5: reverted initializers → implementor test 4 Surface-B FAIL (behavioral green); restored → PASS.
- Adversarial test at fix → 11/11 PASS; reverted → 2 FAIL; restored → 11/11 PASS.
- `tsc --noEmit` → 0 errors in ORCH-1204 files (31 pre-existing `packages/phone-input` errors, unrelated).
- `coldLoadAuthGates` suite → 18/18 PASS.
- D-1/D-2 proven pre-existing on origin/main (stash + checkout origin/main AuthContext).
- Tree left clean: only the new adversarial test file added; AuthContext.tsx byte-identical to `37ed1f861`.

---

## 11. Routing

CONDITIONAL PASS → the deterministic leg is complete and clean. The sole outstanding condition is
the externally-owned **A5 live Samsung multi-tab fire**, which the orchestrator performs
post-deploy. On A5 success, the orchestrator flips
`I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION` → ACTIVE and routes to CLOSE. If A5 reproduces the wedge,
route to REWORK (implementor) citing SC-1-Web.
