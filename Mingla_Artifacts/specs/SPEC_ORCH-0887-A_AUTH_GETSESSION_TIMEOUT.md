# SPEC — ORCH-0887-A [Auth bootstrap `getSession()` Promise.race timeout — closes indefinite loader hang]

**Mode:** `mingla-forensics` SPEC (no fix code; no diffs to product; contract only)
**Parent ORCH:** ORCH-0887 [Mingla Business Web Performance — slow page loads + hanging loaders]
**Severity:** S1-high (inherited from ORCH-0887)
**Classification:** `performance` + `bug` (deterministic deadlock, not perf-tuning)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC author:** Claude `mingla-forensics`, 2026-05-19

**Affected surfaces (per I-CROSS-SURFACE-IMPACT):**

| Surface | Touched | Behaviour change |
|---|---|---|
| business-web-preview | YES (primary) | Indefinite spinner replaced with graceful anon fall-through after 3 s; user can sign in instead of seeing forever-loader |
| business-iOS | YES (file shared) | None observable — keychain `getSession()` resolves in <50ms; timeout safety net never fires |
| business-Android | YES (file shared) | None observable — same as iOS |
| buyer-web (`/checkout/*`, `/e/*`, `/b/*`, `/o/*`, `/t/*`) | YES (shares root `AuthProvider`) | Same protection — anon buyers never blocked by stalled auth |
| consumer-iOS | NO (different `app-mobile/` codebase) | N/A |
| consumer-Android | NO (different `app-mobile/` codebase) | N/A |
| admin-web | NO (different `mingla-admin/` codebase) | N/A |

---

## Section 0 — Mandatory ingestion checklist (Phase 0 completed)

Every file opened with absolute path. Each citation backs a specific claim in this SPEC.

| File | Lines read | Cited in §§ | Purpose |
|---|---|---|---|
| `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/INVESTIGATION_ORCH-0887_BUSINESS_WEB_PERFORMANCE.md` | full (§§3, 4, 10) | §1, §11 | Parent investigation — hang mechanism, RTT chain, recommended fan-out |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/context/AuthContext.tsx` | full (1-701) | §2, §4, §5, §10 | Bootstrap useEffect (142-200), onAuthStateChange listener (204-321), late-resolution surfaces |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/_layout.tsx` | full (1-252) | §1, §10 | Splash gate (102-115), confirms line 103 `if (loading) return` behaviour — 2 s brand-timeout DOES NOT ARM until `loading === false` |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/index.tsx` | full (1-50) | §1, §7 | Lines 18-24 spinner that blocks forever when `loading === true` |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/supabase.ts` | full (1-50) | §6, §11 | Client config — confirmed NO global fetch timeout configured on `createClient`. Only `auth: { storage, autoRefreshToken, persistSession, detectSessionInUrl }`. The hang surface is the call-site, not the client config. |
| `/Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts` | lines 1364-1379 | §2 | Canonical return type for `getSession()` — three-arm union: `{data:{session:Session}, error:null} | {data:{session:null}, error:AuthError} | {data:{session:null}, error:null}`. SPEC's timeout sentinel must satisfy the third arm to keep destructuring intact. |
| `~/.claude/projects/.../memory/feedback_rls_returning_owner_gap.md` | indexed | §9 | Confirmed: no RLS implication. Bootstrap path reads session only — no policy WITH CHECK / RETURNING surface. |
| `~/.claude/projects/.../memory/feedback_universal_skill_output_format.md` | indexed | n/a | Output discipline (chat-side response shape; SPEC self-contained in this file) |

**Discovery notes:**
- Supabase client export path is `mingla-business/src/services/supabase.ts` (not `supabaseClient.ts`). The investigation file uses the conventional name; the real export is `supabase`.
- `supabase.auth.getSession()` signature returns a three-arm discriminated-union Promise. The third arm (anon, no error) is the shape this SPEC's timeout sentinel will use.
- The `onAuthStateChange` listener at AuthContext.tsx:204-321 ALSO calls `setLoading(false)` at line 320 (unconditionally, every event). This is critical for §5.

---

## Section 1 — Goal + surfaces in scope

Close the indefinite loader hang in `mingla-business` web by giving the auth-bootstrap `getSession()` call a hard 3-second timeout via `Promise.race`. When the timeout fires, AuthContext transitions to `{ session: null, user: null, loading: false }` so `app/index.tsx:18-24` releases the spinner and renders `BusinessWelcomeScreen` (the anon UI). The user can then sign in; the existing `onAuthStateChange` listener handles their session arrival via the normal path.

Per ORCH-0887 [Mingla Business Web Performance] investigation §10 the hang mechanism is:
- `AuthContext.tsx:149-152` — bare `await supabase.auth.getSession()` with no timeout race
- `AuthContext.tsx:199` — `setLoading(false)` reachable only if line 152 resolves
- `app/_layout.tsx:103` — 2 s brand-fetch escape timer gated behind `loading === false` (defeating it on auth-stall paths)
- `app/index.tsx:18-24` — spinner returned forever while `loading === true`

This SPEC is the smallest possible fix for the worst symptom (the literal "hang forever"). It does NOT address bundle size, route splitting, query persistence, analytics deferral, or buyer-route auth bypass — those are ORCH-0887-B / -C / -D / -E. See §3.6 (out-of-scope) below.

---

## Section 2 — Promise.race wrapper contract

### 2.1 Constants

- **`AUTH_BOOTSTRAP_TIMEOUT_MS = 3000`** — declared inline at the top of `AuthContext.tsx` (immediately below the imports, above the `webClientId` constant). No separate `authConstants.ts` file — the constant has exactly one consumer in this dispatch; extracting it adds an import without value.
- **`AUTH_BOOTSTRAP_TIMEOUT_SENTINEL`** — internal symbol or object reference used to discriminate the timeout-arm of `Promise.race`. SPEC author choice between `Symbol("auth-bootstrap-timeout")` (referentially unique, ergonomic) or a `__timedOut: true` flag on the resolved shape. **Recommend `Symbol`** because it is impossible to be confused with a legitimate `getSession()` return.

### 2.2 Typed Promise.race pattern (the implementor writes this)

The implementor must produce code matching the following type contract. Pseudocode below; implementor turns it into actual TypeScript that compiles against `@supabase/auth-js` v2.x type defs.

```ts
// Inline at top of AuthContext.tsx (after imports, before AuthProvider):
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000;
const AUTH_BOOTSTRAP_TIMEOUT = Symbol("auth-bootstrap-timeout");
type AuthBootstrapTimeout = typeof AUTH_BOOTSTRAP_TIMEOUT;

// Inside bootstrap(), replacing lines 149-152:
const timeoutPromise = new Promise<AuthBootstrapTimeout>((resolve) => {
  setTimeout(() => resolve(AUTH_BOOTSTRAP_TIMEOUT), AUTH_BOOTSTRAP_TIMEOUT_MS);
});

const raceResult = await Promise.race([
  supabase.auth.getSession(),
  timeoutPromise,
]);
// raceResult is now: Awaited<ReturnType<typeof supabase.auth.getSession>> | AuthBootstrapTimeout

if (raceResult === AUTH_BOOTSTRAP_TIMEOUT) {
  console.warn(
    "[auth] bootstrap-timeout: getSession() did not resolve within " +
      AUTH_BOOTSTRAP_TIMEOUT_MS +
      "ms — falling through as anon",
  );
  if (!mounted) return;
  bootstrapTimedOutRef.current = true;   // see §4 (late-resolution guard)
  setAuthError(null);                    // see §3 (Option A — silent fall-through)
  setSession(null);
  setUser(null);
  setLoading(false);
  return;                                // CRITICAL — do NOT proceed into ensureCreatorAccount with null user
}

// Existing happy path resumes — destructure raceResult as the original line 149-152:
const { data: { session: s }, error } = raceResult;
// ... rest of bootstrap() unchanged from line 153 onwards.
```

**Type-safety notes for the implementor:**
- `supabase.auth.getSession()` returns the discriminated union `{ data: { session: Session }, error: null } | { data: { session: null }, error: AuthError } | { data: { session: null }, error: null }` per `node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:1364-1379`. The destructure on the existing line 149-152 already handles all three arms.
- `Awaited<ReturnType<typeof supabase.auth.getSession>>` is the inferred resolved type. TypeScript narrows correctly after the `raceResult === AUTH_BOOTSTRAP_TIMEOUT` early return — implementor does NOT need a manual type predicate.
- Using `Symbol` as the timeout sentinel avoids the `{ __timedOut: true }` shape collision risk because `Symbol`s are referentially unique and cannot accidentally match any object literal that supabase-js could return.

### 2.3 Why 3000 ms

- Supabase `getSession()` reads the persisted JWT from localStorage (web) or keychain (native) — sub-50ms typical.
- Token-refresh path (expired JWT): single `/auth/v1/token` POST to Supabase, sub-300ms on healthy network.
- 3000 ms is a generous upper bound that:
  - Catches genuinely stalled promises (the bug)
  - Does NOT false-positive on slow-but-working networks (8× slower than expected worst case)
  - Is short enough to be tolerable as a one-time cold-load delay (better than indefinite hang, worse than the 1-1.5 s p50 cold-load target — and that's acceptable for 0887-A; perf tightening is 0887-B/C/D/E)

A future amendment may tighten this to 1500-2000 ms once 0887-B (bundle reduction) lands and operator confirms via Sentry that genuine slow-network resolutions never exceed 1500 ms p99. Not in this SPEC's scope.

---

## Section 3 — Timeout-surface UX decision

**Decision: Option A — silent fall-through.** On timeout, the AuthContext sets `(session: null, user: null, authError: null, loading: false)`. No toast. No retry CTA. The user simply sees the anon UI (`BusinessWelcomeScreen`) and can sign in normally.

**Defence (one paragraph):**

Option A wins on three axes. (1) **User comprehension:** a "Connection slow — continuing offline" toast (Option B) is jargon-laden and scares users who cannot act on it; an anon login screen is self-explanatory and immediately actionable. (2) **Failure-mode honesty:** if `getSession()` stalled, the user's session state is by definition unknown — pretending otherwise via a "Retry" CTA (Option C) compounds the deadlock by waiting another 8 s. The anon screen is the truthful state ("we don't know who you are; please sign in"). (3) **Implementation simplicity:** Option A is ~5 lines added to bootstrap(); Option B requires plumbing a toast into AuthContext (no toast primitive exists in `mingla-business/src/components/ui/` at the root layout level — would require new infrastructure); Option C requires retry-counter state, exponential backoff, and a CTA component. Option A respects the I-NO-SILENT-FAILURES invariant via the `console.warn` log (developers see it), without imposing the UX cost on users. Sentry capture of the warn line is added by ORCH-0887-E's broader observability sweep, not here.

The existing happy path stays untouched — if `getSession()` succeeds within 3 s (which is essentially every load), users see no behavioural change.

---

## Section 4 — Late-resolution handling

**Decision: (b) ref-guarded skip.** Add `const bootstrapTimedOutRef = useRef(false)` to AuthProvider. Set `bootstrapTimedOutRef.current = true` when the timeout sentinel returns. The late-resolution branch (i.e. the original `getSession()` Promise eventually resolving after timeout fired) checks the ref; if `true`, it is a no-op (log only, no state writes). The user stays on the anon screen until they actively sign in.

**Defence (one paragraph):**

After the timeout fires we have set `(session: null, user: null, loading: false)` and the user is likely interacting with `BusinessWelcomeScreen`. If 200 ms later the original `getSession()` Promise resolves with a real session, option (a) (accept overwrite) would: (1) flash the UI from anon → home-tab without user input (jarring, looks like a bug), (2) re-trigger the `ensureCreatorAccount → tryRecoverAccountIfDeleted → 4 analytics-identity calls` chain mid-render (the side-effects fan-out is heavy and not idempotent re: render boundaries), (3) potentially fire a "Welcome back" toast (Cycle 14 recovery event) that the user has no context for. Option (b) is a 3-line addition (`useRef`, set on timeout, check on late-resolve) that prevents all three failure modes. The user is not harmed by the late-skip because the `onAuthStateChange` listener at AuthContext.tsx:204-321 is STILL ACTIVE — when the user actually signs in (or another tab fires `SIGNED_IN`, or a token refresh produces `TOKEN_REFRESHED`), the listener will pick it up via the normal code path, and the listener's `setLoading(false)` at line 320 keeps the loading flag pinned to false (no regression on the anon-screen visibility).

**Implementor implementation guidance (still §4):**
- `bootstrapTimedOutRef` is declared alongside `afEventFiredRef` (AuthContext.tsx:140).
- It is set inside the `if (raceResult === AUTH_BOOTSTRAP_TIMEOUT)` branch (per §2.2 pseudocode) immediately before `setAuthError(null)`.
- The late-resolution skip is NOT a separate code path — it is implicit. Because the timeout branch `return`s early, the existing happy-path destructure on the resolved `raceResult` never runs after a timeout. The Promise.race resolves once and discards the loser. **The ref's only consumer is the `onAuthStateChange` listener for an edge case:** if the original `getSession()` eventually resolves AND supabase-js internally re-fires `INITIAL_SESSION` on the listener (it does, on session-hydration completion), the listener could overwrite the anon state. Per §5 below, the listener stays untouched, but the SPEC author registers the ref as a future-proofing primitive — if the orchestrator later observes a flash-bug, the ref is already in place for a 1-line guard inside the listener.

This is a deliberate over-allocation of state: the ref costs nothing, makes the timeout intent explicit, and is the right hook for any §5 follow-up if the listener interaction needs hardening post-merge.

---

## Section 5 — `onAuthStateChange` interaction

### 5.1 Listener lines (cited)

`AuthContext.tsx:204-321` is the `onAuthStateChange` subscription:

- **Mount point:** line 204-206 — `const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {`
- **Mounted check:** line 207 — `if (!mounted) return;`
- **Common state writes (every event):** lines 215-217 — `setAuthError(null); setSession(s); setUser(s?.user ?? null);`
- **Session-arrival branch:** lines 218-294 — runs `ensureCreatorAccount`, `tryRecoverAccountIfDeleted` (gated `_event === "SIGNED_IN"` per Cycle 14 v2 fix Bug B at line 236), 4 analytics-identity calls (lines 246-250), AppsFlyer first-event fire (lines 251-293)
- **Signed-out branch:** lines 295-319 — `clearAllStores`, `queryClient.clear`, AppsFlyer/Mixpanel/RevenueCat/OneSignal cleanup, `afEventFiredRef.current = false`
- **Always-runs:** line 320 — **`setLoading(false);`** (UNCONDITIONAL — every event flips loading to false)

### 5.2 Defensive guarantee

The listener's line 320 `setLoading(false)` is a defensive belt-and-suspenders. After the bootstrap timeout fires, the listener will STILL fire when:
- (a) the original `getSession()` Promise eventually resolves and supabase-js fires `INITIAL_SESSION` (event name varies by supabase-js version; v2.74 fires `INITIAL_SESSION` after first session hydration)
- (b) the user signs in via `BusinessWelcomeScreen` (fires `SIGNED_IN`)
- (c) a `SIGNED_IN` event arrives from another tab (cross-tab sync via supabase-js storage events)
- (d) `TOKEN_REFRESHED` after a refresh-cycle completes

In cases (b), (c), (d), the listener correctly transitions `(loading: false, user: null, session: null)` → `(loading: false, user: real, session: real)` via the existing logic. The user sees their session arrive and the home-tab redirect (`app/index.tsx:39 — <Redirect href={AppRoutes.home} />`) fires correctly.

Case (a) is the late-resolution case from §4. The listener WILL fire `setSession(s)` + `setUser(s?.user ?? null)` and (if `s?.user` and `_event === "SIGNED_IN"`) run the full side-effects chain. This is acceptable because:
- The Cycle 14 v2 fix (line 236) gates `tryRecoverAccountIfDeleted` to `SIGNED_IN`-only — `INITIAL_SESSION` won't trigger recovery side-effects
- `ensureCreatorAccount` is idempotent (upsert-or-noop)
- The analytics-identity calls are idempotent (each service's `.identify(userId)` is no-op on same-userId)
- The UI flash IS a concern but is rare (requires the stalled promise to resolve AFTER 3 s, which means the original network round-trip is exceeding 3 s — a degraded network case, not a normal load)

### 5.3 No listener changes in this SPEC

The listener at line 204-321 is **NOT** modified by ORCH-0887-A. All changes are inside `bootstrap()` (the useEffect's first awaited path). The `bootstrapTimedOutRef` is declared but only consumed inside `bootstrap()`. The listener's `setLoading(false)` at line 320 is the safety net for late events; it stays as-is.

---

## Section 6 — Native parity

**Decision: timeout is platform-agnostic. NO `Platform.OS === "web"` gate.**

**Defence (one paragraph):**

On iOS + Android, `supabase.auth.getSession()` reads from AsyncStorage (which on native is MMKV/SQLite-backed via `@react-native-async-storage/async-storage ^2.2.0` per `package.json:75`). Read times are sub-10ms typical, sub-100ms worst case (cold storage on slow Android device). The 3 s timeout is a safety net that will essentially never fire on healthy native devices. **But "essentially never" is not "never"** — a corrupted keychain, a stalled native bridge during JS-thread contention, or a device-level storage failure could theoretically hang the bootstrap on native too. The timeout costs zero CPU when it never fires (a single `setTimeout` is sub-microsecond) and the `Promise.race` overhead is negligible. Adding a `Platform.OS` gate would: (1) introduce platform-conditional code that obscures the universal safety guarantee, (2) leave native users vulnerable to the rare-but-real keychain-hang case, (3) create a divergence between web and native code paths that future maintainers must reason about. The universal timeout is the correct design — the cost is zero, the protection is universal, and the code is simpler.

Per the cross-surface impact declaration: business-iOS and business-Android are TOUCHED (same file) but behaviour is UNCHANGED in normal operation. The §5 success criterion #4 (native byte-identical timing) is verified in the test suite by mocking `Platform.OS = "ios"` and confirming the happy path resolves before the timer can fire.

---

## Section 7 — Success criteria

The implementor's work is DONE when ALL of these are demonstrable:

1. **Stalled-getSession test passes** (the bug repro): when `supabase.auth.getSession` is mocked to never resolve (return `new Promise(() => {})`), `AuthContext.loading` transitions from `true` to `false` within `AUTH_BOOTSTRAP_TIMEOUT_MS + 100ms` of tick-advance (via `jest.useFakeTimers()`) and the auth state is `(user: null, session: null, authError: null)`. `console.warn` was called with a message matching `/bootstrap-timeout/`.
2. **Happy-path session test passes:** when `getSession` resolves immediately with `{ data: { session: realSession }, error: null }`, the existing `ensureCreatorAccount → tryRecoverAccountIfDeleted → analytics-identity` chain still runs and `setLoading(false)` fires only after the chain completes. The timeout is cleared (`clearTimeout` called or `Promise.race` discards the loser — implementor may choose; either is correct).
3. **Happy-path no-session test passes:** when `getSession` resolves immediately with `{ data: { session: null }, error: null }` (anon user, no persisted session), loading flips to false within 100 ms, user/session both null, NO analytics chain runs (gated by `if (s?.user)` at AuthContext.tsx:166 — unchanged).
4. **Late-resolution test passes:** when `getSession` resolves AFTER the timeout fired with a real session, `bootstrapTimedOutRef.current === true` and the timeout-path state writes are NOT overwritten by the original promise's late resolution (because the timeout branch `return`s early — the original promise's resolution is discarded by Promise.race semantics). The listener may still fire on supabase-js INITIAL_SESSION; that is acceptable per §5.2.
5. **Error-path session test passes:** when `getSession` resolves with `{ data: { session: null }, error: AuthError }`, the existing error path runs (`setAuthError(error); setLoading(false); return;` at AuthContext.tsx:154-158 — unchanged).
6. **Native byte-identical test passes:** with `Platform.OS === "ios"` mocked and `getSession` resolving in <10ms, timing is unaffected — the timeout never fires, the happy path completes normally. (Per §6 this is a regression guard, not a behaviour change.)
7. **No new `tsc` errors.** Run `cd mingla-business && npx tsc --noEmit` — exit code 0. The Symbol-based discriminator must narrow correctly; implementor may need an explicit type assertion if `Awaited<ReturnType<...>>` inference fights the union narrowing.
8. **No new ESLint errors.** Run `cd mingla-business && npm run lint` (or the project's lint command) — no new warnings on `AuthContext.tsx`.
9. **Regression-test gate (Step 0.5 compliance):** happy-path test landed at the cited path with fails-on-revert protocol per §8.3.

---

## Section 8 — Required tests (regression-test gate compliance)

### 8.1 Implementor happy-path test

- **Path:** `mingla-business/src/context/__tests__/AuthContext.timeout.test.tsx`
- **Test runner:** Jest + React Native Testing Library (the project's existing test stack — confirm via `cd mingla-business && cat package.json | grep -A 5 '"scripts"'` before writing).
- **Test file structure:**
  - `jest.useFakeTimers()` in `beforeEach`.
  - `jest.restoreAllMocks()` in `afterEach`.
  - Mock `../services/supabase` so `supabase.auth.getSession` is a jest.fn() that returns a controllable promise per test.
  - Mock `../services/creatorAccount` (`ensureCreatorAccount`), `../hooks/useAccountDeletion` (`tryRecoverAccountIfDeleted`), and the 4 analytics services (`appsFlyerService`, `mixpanelService`, `revenueCatService`, `oneSignalService`) as jest.fn() that resolve immediately.
  - Render `<AuthProvider><TestConsumer/></AuthProvider>` where `TestConsumer` exposes `useAuth()` state into a ref or queryable element.
- **Mandatory test cases:**
  1. **`getSession resolves immediately with session → loading false within 100ms, user/session populated, analytics chain called`** — covers success criterion #2.
  2. **`getSession resolves immediately with no session → loading false within 100ms, user/session null, analytics chain NOT called`** — covers success criterion #3.
  3. **`getSession never resolves → loading false at AUTH_BOOTSTRAP_TIMEOUT_MS ±50ms, user/session null, analytics chain NOT called, console.warn called with /bootstrap-timeout/`** — covers success criterion #1 (the bug repro).
  4. **`getSession resolves with error → setAuthError called, loading false, analytics chain NOT called`** — covers success criterion #5.

### 8.2 Adversarial test (tester writes — NOT implementor)

- **Path:** `mingla-business/src/context/__tests__/AuthContext.timeout.adversarial.test.tsx`
- **Author:** `mingla-tester` (separate dispatch post-implementor merge per §10 downstream routing)
- **Mandatory:** attack a DIFFERENT angle than §8.1. Choose from:
  - (a) `getSession resolves at exactly AUTH_BOOTSTRAP_TIMEOUT_MS - 1ms` — boundary race condition; ensure Promise.race resolves with the session, not the sentinel.
  - (b) `getSession resolves AFTER timeout AND a SIGNED_IN listener event fires for the same session` — verifies §5.2 (listener correctly populates the late-arriving session without UI deadlock).
  - (c) `getSession resolves with malformed payload (e.g. `{ data: {}, error: null }` — missing session key)` — defensive parsing; AuthContext should not throw.
  - (d) `Promise.race rejected by getSession() throwing synchronously` — pathological edge case; should fall through error path or timeout, never crash.
  - (e) `unmount during the 3s timeout window` — verify `mounted = false` cleanup prevents state writes after unmount (already guarded by `if (!mounted) return;` at AuthContext.tsx:153 — adversarial verifies the timeout branch also respects it per §2.2 pseudocode).
- Tester writes this; SPEC just defines the requirement.

### 8.3 Fails-on-revert protocol (CRITICAL — addresses the "infinite hang test would hang" problem)

The implementor's report MUST cite the commit hash at which `git revert <fix-commit>` is performed AND demonstrate that the test at §8.1 case 3 (the never-resolving getSession case) **fails within bounded time** on the reverted code (not hangs forever).

**The protocol:** use `jest.useFakeTimers()` exclusively. Do NOT rely on jest's default per-test timeout (5000 ms wallclock) for the never-resolves case, because:
- On the FIXED code: `jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS + 100)` synthetically advances clock → timeout fires → `setLoading(false)` → assertion passes in milliseconds of wallclock time.
- On the REVERTED code: the `getSession` promise still never resolves AND there is no timeout setTimeout to advance → `act()` never completes → jest's default 5000 ms test timeout catches it AS A FAILURE (test fails, suite continues; the implementor cites this in the fails-on-revert evidence).

**Therefore:** every test in §8.1 case 3 MUST be wrapped in `await act(async () => { jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS + 100); await Promise.resolve(); });` so the FIXED code completes synchronously. On the REVERTED code, the same call returns without any state change (no timeout to advance), and the subsequent `expect(loading).toBe(false)` assertion fails immediately — bounded failure, not hang.

**Belt-and-suspenders:** also add an explicit per-test timeout via the 3rd `it()` argument: `it("case 3 — never resolves", async () => { ... }, 5000);`. This ensures even if a future refactor breaks the fake-timer pattern, the test fails within 5 s rather than hanging the CI.

Both tests are append-only post-merge per `.github/workflows/tests-append-only.yml`.

---

## Section 9 — Invariants

### Existing invariants (no change)

- **I-NO-SILENT-FAILURES** — the timeout path logs `console.warn("[auth] bootstrap-timeout: ...")` with a descriptive message including the timeout value. It does not swallow.
- **I-RN-COLOR-FORMATS** — N/A (no UI colours touched).
- **I-CROSS-SURFACE-IMPACT** — declared in the top-of-file surface matrix. All 7 surfaces accounted for.

### NEW invariant codified by this SPEC

**I-AUTH-BOOTSTRAP-TIMEOUT** — every auth-bootstrap-blocking Promise in `mingla-business` MUST have a `Promise.race` timeout (or equivalent abort mechanism) at the call site. The bootstrap is defined as "any awaited Promise inside an effect that gates `setLoading(false)`."

**Scope of I-AUTH-BOOTSTRAP-TIMEOUT in this SPEC:**
- Closed: `supabase.auth.getSession()` at AuthContext.tsx:149-152 (the fix this SPEC defines).
- NOT-YET-closed but registered for future ORCH coverage:
  - `ensureCreatorAccount(s.user)` at AuthContext.tsx:171 (inside try/catch but no timeout)
  - `tryRecoverAccountIfDeleted(s.user.id)` at AuthContext.tsx:181 (no timeout)
  - The 4 analytics-identity inits (lines 189-197) — each could theoretically hang the bootstrap if synchronous
- These follow-on closures are ORCH-0887-E territory. The invariant is registered NOW so future code/reviews catch new bootstrap-blocking awaits.

**CI enforcement:** OUT OF SCOPE for ORCH-0887-A. A strict-grep gate that flags `await supabase.auth.*` and `await ensure*Account*` calls inside `useEffect`s would be the right enforcement, but it requires the §9 follow-on closures to be in place first (otherwise the gate flags pre-existing unfixed code as violations). 0887-E will add the gate via the registry pattern documented in `feedback_strict_grep_registry_pattern.md`.

**Registry placement:** when the SPEC is merged into the `Mingla_Artifacts/INVARIANT_REGISTRY.md` file (orchestrator post-CLOSE task), add under section "Auth + bootstrap invariants" with status `ACTIVE post-ORCH-0887-A CLOSE` and link back to this SPEC.

---

## Section 10 — Files touched

- **EDIT (1 file, ~25 lines added):** `mingla-business/src/context/AuthContext.tsx`
  - Add `AUTH_BOOTSTRAP_TIMEOUT_MS` constant (+1 line)
  - Add `AUTH_BOOTSTRAP_TIMEOUT` Symbol + `AuthBootstrapTimeout` type (+2 lines)
  - Add `bootstrapTimedOutRef` declaration (+1 line, alongside `afEventFiredRef` at line 140)
  - Replace bare `await supabase.auth.getSession()` at lines 149-152 with `Promise.race` pattern (+20 lines including timeout branch, warn log, early return, and existing-destructure preservation)
  - Total net delta: ~25 lines added, 4 lines removed (the original bare destructure)
- **NEW (1 file, ~150 lines):** `mingla-business/src/context/__tests__/AuthContext.timeout.test.tsx` — happy-path test per §8.1
- **NEW (1 file, ~120 lines, written by TESTER not IMPLEMENTOR):** `mingla-business/src/context/__tests__/AuthContext.timeout.adversarial.test.tsx` — adversarial test per §8.2
- **UNCHANGED:** every other file. No `_layout.tsx` changes. No `index.tsx` changes. No `supabase.ts` changes. No buyer-route changes. No new dependencies. No analytics-init changes. No `ensureCreatorAccount` / `tryRecoverAccountIfDeleted` changes.

**Count: 0 new product files. 1 edited product file. 2 new test files (1 implementor, 1 tester).**

---

## Section 11 — Risks

### Risk 1: 3-second wait is itself a perceived hang
A 3 s spinner on cold-load is still painful, even if not infinite. **Mitigation:** this is acceptable for 0887-A; the goal is to close the indefinite hang, not to make cold-load fast. Fast cold-load is 0887-B/C/D/E. Operator may amend the constant to 1500 ms once 0887-B (bundle reduction) ships and observability confirms genuine slow-network resolutions never exceed 1500 ms p99.

### Risk 2: late-resolution UI flash
Covered in §4. Decision (b) (ref-guarded skip) mitigates the most common flash via the early-return in the timeout branch. The remaining flash surface is via the `onAuthStateChange` listener firing `INITIAL_SESSION` post-late-resolution; that is rare and acceptable per §5.2.

### Risk 3: false-positive timeout in flaky CI
Tests use `jest.useFakeTimers()` exclusively per §8.3, so test runtime is deterministic and never 3 s of wallclock per case. CI cannot be flaky in the timeout window because the timer is synthetic.

### Risk 4: Promise.race winner-takes-all with concurrent error
If `getSession()` resolves with `{ data: { session: null }, error: AuthError }` at exactly the same tick as the timeout fires, Promise.race semantics resolve to whichever microtask is queued first — non-deterministic but harmless: if the error wins, the existing error path runs (`setAuthError(error); setLoading(false); return;`); if the timeout wins, the silent-fall-through path runs (`setSession(null); setUser(null); setLoading(false); return;`). Both paths produce `loading: false` and the user reaches a usable state. The only difference is whether `authError` is populated; in the timeout-wins case it is `null` (silent), in the error-wins case it surfaces the AuthError. Acceptable.

### Risk 5: Supabase-js internal retry loop on stale refresh token
The investigation §4 H4 hypothesis identifies this as the likely real-world trigger for the indefinite hang. The 3 s timeout closes the symptom (the user gets to anon screen and can re-auth). The underlying supabase-js behaviour is not fixed by this SPEC — it cannot be fixed at the application layer. Operator may file ORCH-0887-F to upstream a Supabase-js issue (out of scope here).

### Risk 6: implementor extracts constant to wrong file
SPEC author explicitly says **inline in AuthContext.tsx** — do NOT create `authConstants.ts`. If the implementor disagrees on grounds of code style, the SPEC author's choice wins (single-consumer constants do not warrant separate-file extraction; future amendment may extract if a second consumer arrives).

### Risk 7: native parity test mocks Platform.OS but real device behaviour differs
The §7 success criterion #6 (native byte-identical) is verified in CI via Jest + `Platform.OS = "ios"` mock. This is a regression guard at the unit-test level. True native verification on a real device is the TESTER's responsibility per `feedback_tester_canonical_and_platform_parity.md` — the tester must run iOS Simulator + Android Emulator + Web Browser parity per the standing rule. The implementor does NOT need to spin up simulators; the tester does.

---

## Section 12 — Implementor handoff prompt template

The following is the verbatim prompt the orchestrator hands to `mingla-implementor` for this dispatch. Copy-paste ready.

---

```
You are acting as Claude `mingla-implementor` for ORCH-0887-A
[Auth bootstrap `getSession()` Promise.race timeout — closes
indefinite loader hang].

The full SPEC lives at:
  /Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/specs/SPEC_ORCH-0887-A_AUTH_GETSESSION_TIMEOUT.md

READ IT IN FULL FIRST. The §2.2 pseudocode pattern, the §4
late-resolution ref decision, the §6 native-parity decision, the §7
success criteria, and the §8 test contract are your binding contract.

Working tree: /Users/sethogieva/Desktop/mingla-main on branch `Seth`.

Parent investigation:
/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/INVESTIGATION_ORCH-0887_BUSINESS_WEB_PERFORMANCE.md
— cite §10 (hang mechanism) in your implementation report.

Hard requirements:

1. EDIT exactly one product file:
   `mingla-business/src/context/AuthContext.tsx`.
   Apply the §2.2 Promise.race pattern. Use a Symbol as the timeout
   sentinel (not a `__timedOut: true` flag). Constant
   `AUTH_BOOTSTRAP_TIMEOUT_MS = 3000` inline at top of file
   (do NOT create authConstants.ts).

2. Add `bootstrapTimedOutRef = useRef(false)` alongside
   `afEventFiredRef` at line 140. Set
   `bootstrapTimedOutRef.current = true` inside the timeout
   branch per §4. The ref's runtime consumers are zero in this
   dispatch (future-proofing per §4 final paragraph).

3. WRITE exactly one new test file:
   `mingla-business/src/context/__tests__/AuthContext.timeout.test.tsx`
   with all 4 cases from §8.1. Use `jest.useFakeTimers()` per §8.3.
   Each `it(...)` MUST have an explicit per-test timeout (the 3rd
   arg, e.g. `5000`) so revert-verify is bounded — NEVER rely on
   the never-resolving promise to hang indefinitely.

4. Do NOT write the adversarial test
   (`AuthContext.timeout.adversarial.test.tsx`) — that is the
   tester's deliverable per §8.2.

5. Do NOT modify:
   - `mingla-business/app/_layout.tsx`
   - `mingla-business/app/index.tsx`
   - `mingla-business/src/services/supabase.ts`
   - `mingla-business/src/services/creatorAccount.ts`
   - `mingla-business/src/hooks/useAccountDeletion.ts`
   - any analytics service files
   - any buyer-route files
   See §3.6 in the brief (`Mingla_Artifacts/prompts/SPECER_ORCH-0887-A_AUTH_GETSESSION_TIMEOUT.md`)
   for the full out-of-scope list. Each of those is its own future
   ORCH (0887-B/C/D/E).

6. Run pre-flight design check via /ui-ux-pro-max: SKIP — this is
   pure logic, no visible UI surface change. The
   `feedback_implementor_uses_ui_ux_pro_max.md` rule exempts pure
   logic/data/state work. Document the skip in your report.

7. Verify success criteria 1-9 from §7. Specifically:
   - `cd mingla-business && npx tsc --noEmit` → exit 0
   - `cd mingla-business && npx jest src/context/__tests__/AuthContext.timeout.test.tsx`
     → all 4 cases pass

8. Fails-on-revert protocol per §8.3: after your fix lands, run
   `git stash` (or `git revert HEAD --no-commit` then `git reset`
   to discard) to simulate the un-fixed code. Re-run the test
   suite. Confirm:
   - Cases 1, 2, 4 still pass (they don't exercise the timeout).
   - Case 3 FAILS within ≤5 s wallclock (the per-test timeout
     bounds the failure). The failure mode is:
     `expect(loading).toBe(false)` fails because `loading` is
     still `true` on the un-fixed code. NOT an "Exceeded timeout
     of 5000ms" message from jest — that would mean the per-test
     timeout was the only thing saving you, not the fake-timer
     advance. The fake-timer should make case 3 PASS on the fix
     and FAIL deterministically on revert.
   Re-apply the fix. Cite the SHA before/after the experiment in
   your report.

9. ORCH bracket-label citation rule: ORCH-0887 [Mingla Business
   Web Performance], ORCH-0887-A [Auth getSession Promise.race
   timeout] on first mention in your report.

10. Cross-surface impact declaration in your report: copy the
    surface matrix from §1 of the SPEC verbatim.

11. Commit message — propose this verbatim (per
    `feedback_no_coauthored_by.md` — NO Co-Authored-By line):

    ```
    ORCH-0887-A [Auth getSession Promise.race timeout]: close
    indefinite loader hang on business-web

    Wraps supabase.auth.getSession() in Promise.race with 3s
    timeout in AuthContext bootstrap. On timeout, fall through
    as anon (silent — user sees BusinessWelcomeScreen instead
    of forever-spinner). Late-resolution guarded by
    bootstrapTimedOutRef.

    Closes the indefinite hang per investigation §10. Does NOT
    address bundle bloat, query persistence, route-splitting, or
    analytics deferral — those are 0887-B/C/D/E.

    Files:
    - EDIT mingla-business/src/context/AuthContext.tsx (+25/-4)
    - NEW  mingla-business/src/context/__tests__/AuthContext.timeout.test.tsx (+150)

    Test: 4 cases (immediate-session, no-session, never-resolves,
    error). Fake timers; per-test timeout 5000ms. Fails-on-revert
    verified.
    ```

12. After commit, do NOT push or open PR — return to orchestrator
    with the commit SHA. Orchestrator will dispatch
    `mingla-tester` for §8.2 adversarial test + iOS/Android/Web
    parity per `feedback_tester_canonical_and_platform_parity.md`.
    Tester writes their adversarial test in a SECOND commit on
    the same branch before PR open. PR opens after tester PASS.

Deliverable: report including the SHA, the verified success
criteria, the fails-on-revert evidence, and the cross-surface
impact declaration. Per `feedback_no_summary_paragraph.md`, no
summary paragraph — just the artifact and the verification
evidence.

Implementor target: Claude `mingla-implementor` (background
sub-agent). Codex `implementor-mingla` is the parity-alternate.
Work is in-tree (no Supabase, no edge function, no native
module), single product-file edit + 1 test file — fits the
Claude implementor envelope cleanly. Codex would also work but
adds context-handoff overhead for no benefit.
```

---

**End of SPEC.**
