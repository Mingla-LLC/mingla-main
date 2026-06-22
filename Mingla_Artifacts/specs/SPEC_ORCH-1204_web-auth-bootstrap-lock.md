# SPEC — ORCH-1204 [business-web auth-bootstrap lock — brand switcher wedges on "Loading brands…" despite a valid session]

- **Phase:** SPEC (root cause ALREADY PROVEN LIVE; this document is the binding build contract).
- **Worktree:** `~/Desktop/mingla-orchs/1204-[web-auth-bootstrap-lock]` on branch `1204-web-auth-bootstrap-lock` (rebased to origin/main).
- **Anchor:** `~/Desktop/mingla-main` is read-only except this SPEC output.
- **Evidence of record:** `~/Desktop/mingla-main/Mingla_Artifacts/evidence/ORCH-1202/LIVE_SAMSUNG_rootcause.txt` (live capture on Seth's signed-in Samsung Galaxy A72, Chrome, business.usemingla.com, ~8 same-origin tabs).
- **Comms acks this turn:** COMMS-0052 (BLOCK, OPEN) — business-app OTA blocked; this SPEC's shipping note complies (Vercel `[deploy]` only, NO `eas update`). COMMS-0055 (WARN) — ORCH-ID renumber; 1204 is past the collision range.

---

## 1. Executive summary

On business-web (`business.usemingla.com`), a user who is genuinely signed in (a valid Supabase session sits in `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` with a live `access_token`, `user.id`, refresh token, ~7 days to expiry) can get permanently wedged on "Loading your brands…", then dumped to an empty "Create brand" screen on reload — even though nothing is wrong with their session.

The proven mechanism: gotrue's Navigator-Locks auth-token lock (`lock:sb-…-auth-token`) is orphaned/contended in the multi-tab + AuthProvider-remount case ("orphaned lock from a component unmount"). `supabase.auth.getSession()` (and gotrue init `_recoverAndRefresh`, which also takes the lock) cannot resolve under the 3000ms `AUTH_BOOTSTRAP_TIMEOUT_MS` because ORCH-1100's `webResilientLock` only bounds the acquire to 2300ms. The 3s "use stored web session" fallback is reactive, races the lock, and is gated by `if (!mounted) return` (the provider remounts), so it never durably hydrates `user`. The 7s hard ceiling then releases the loading gate treating the user as logged out. Net: `isAuthReady` never becomes true → `useBrands` (`enabled = isAuthReady && accountId !== null`) never runs → `/rest/v1/brands` fires 0 times → the brand switcher spins forever.

**The fix (web-only):** hydrate `session`/`user`/`loading` **synchronously at AuthProvider mount** from the valid persisted token via a `useState` initializer, exactly the way native resolves bootstrap behind the splash. With `user`/`session` populated on the FIRST render and `loading=false`, `isAuthReady` is true on first paint independent of the contended gotrue lock; `useBrands` fires immediately. Every existing safety net (the 3s race, the 7s ceiling, the ORCH-1106 revoked-session probe, the ORCH-1004 late-adopt) continues to run in the background to catch a locally-valid-but-server-revoked token — it just no longer gates first paint. Native iOS/Android bootstrap is byte-identical.

---

## 2. Scope & non-goals

### In scope (web-only behavioral change)
- Change the AuthProvider React state initialization in `mingla-business/src/context/AuthContext.tsx` so that, on web with a valid stored session, `session`/`user` are set and `loading` is `false` on the FIRST render (via `useState` initializers).
- Make the synchronous-hydration path consistent with the existing background bootstrap so ORCH-1106 (revoked-session probe) is neither skipped nor double-fired, and ORCH-0887-A / ORCH-1004 / ORCH-1102 keep holding.
- SSR/no-window safety for the Expo-web static-export prerender (no React #418/#425 hydration mismatch).
- The Step 0.5 regression-test contract (implementor happy-path + adversarial-tester angles) + a DRAFT invariant.

### Optional, clearly-labeled secondary hardening (item #6 — MAY include only if low-risk)
- Reduce gotrue lock contention (e.g. lower `WEB_LOCK_ACQUIRE_TIMEOUT_MS` further below 2300ms, or make the lock-free fallback in `webResilientLock` more aggressive). **This is NOT the cure** and the implementor must NOT let it expand scope or add risk. The PRIMARY cure (synchronous hydration, item #1) stands alone; #6 is belt-and-suspenders. If there is any doubt about regressing the ORCH-1100 cross-tab lock behavior, OMIT #6 entirely.

### Explicit non-goals (do NOT do)
- **No native behavioral change.** iOS/Android AuthProvider bootstrap MUST be byte-identical. Every change gates on `Platform.OS === "web"` or rides the already-web-only `readStoredWebSession()` (which returns `null` off web).
- **No new dependency, no migration, no edge function.** Pure-JS client change.
- **No `eas update` for mingla-business** (COMMS-0052 — business OTA crashes on the PostHog native module). Ship via Vercel `[deploy]`; the pure-JS change rides the next business native build.
- **No change to the route gates' decision logic** in `coldLoadAuthGates.ts` or `app/_layout.tsx`. They already short-circuit on `user !== null` / `hasUser`, so synchronous hydration flows through them correctly with NO edit. Do not touch them.
- **No change to `useBrands.ts` / `useBrandListShim.ts`.** They are correct; the bug is upstream (the `isAuthReady` signal never went true). Touching them would mask, not fix.
- **No removal or relaxation of any existing safety net** (3s race, 7s ceiling, ORCH-1106 probe, ORCH-1004 late-adopt, Constitution #6 sign-out/clear).
- **No widening to the consumer app** (`app-mobile`) — different AuthContext, out of scope.

### Assumptions
- `readStoredWebSession()` (AuthContext.tsx:90-100) is the correct, already-defined reader: it guards `Platform.OS !== "web"` and `typeof window === "undefined"`, reads the same `WEB_AUTH_STORAGE_KEY`, and returns the parsed session ONLY if `hasUsableBusinessSession(parsed)` (a non-empty `access_token`). It returns `null` on parse error. This is the single source of truth for the initializer.
- A `useState(initializer)` lazy initializer runs exactly once, on mount, before first render commit — so it cannot create a render loop.

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | n/a — separate AuthContext, not in scope | none | n/a |
| 2 | Consumer Android (`app-mobile/` Android) | NO | n/a — separate AuthContext, not in scope | none | n/a |
| 3 | Buyer/anonymous Web (`mingla-business/` `/e/ /t/ /b/ /exp/ /checkout*` etc.) | NO (verify-no-regression only) | Anon buyer routes have NO stored session → initializer returns `null` → behavior byte-identical to today (route gates already exempt these). | none (assert unchanged) | automatic (shared AuthContext; anon path unchanged) |
| 4 | Business iOS | NO | byte-identical — every change gated to web | none | automatic (web-gated, native untouched) |
| 5 | Business Android | NO | byte-identical — every change gated to web | none | automatic (web-gated, native untouched) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | separate app, separate auth; untouched | none | n/a |
| 7 | **Business Web (`mingla-business/` web — the FIX target)** | **YES** | Signed-in user with a valid stored session: brand switcher and every auth-gated query (`useBrands`) load on first paint, NO "Loading brands…" wedge, regardless of gotrue lock contention or open-tab count. | `mingla-business/src/context/AuthContext.tsx` (+ optionally `mingla-business/src/services/supabase.ts` for item #6) | n/a (single web surface) |

The only behavioral change is on Business Web (surface 7). All other surfaces are unchanged because the change is web-gated and the anon-buyer web path has no stored session (initializer returns `null` → today's bootstrap path).

---

## 4. Layered specification

This is a single-layer (React Context / client state) change. No DB, edge, service, hook, or realtime layer is touched.

### 4.1 Context layer — `mingla-business/src/context/AuthContext.tsx`

#### 4.1.a Add a web-only synchronous-hydration helper (module scope, next to `readStoredWebSession`)

`readStoredWebSession()` already returns the usable stored web session or `null` (web-only + SSR-guarded). Add a tiny companion that the `useState` initializers call, so the read happens **once** and both `session`/`user`/`loading` derive from the same snapshot:

> Illustrative shape (≤3 lines — NOT the implementation):
> ```ts
> // Web-only, SSR-safe (readStoredWebSession returns null off-web / no-window).
> const bootstrapStoredWebSession = (): Session | null => readStoredWebSession();
> ```
The implementor MAY call `readStoredWebSession()` directly inside each initializer instead of adding this alias — either is acceptable. What is REQUIRED is that the read is SSR-safe (returns `null` when `typeof window === "undefined"`) and web-only (returns `null` when `Platform.OS !== "web"`), both of which `readStoredWebSession()` already guarantees.

#### 4.1.b Change the three `useState` calls (AuthContext.tsx:175-177) to lazy initializers

**BEFORE (lines 175-177):**
```ts
const [session, setSession] = useState<Session | null>(null);
const [user, setUser] = useState<User | null>(null);
const [loading, setLoading] = useState(true);
```

**AFTER (exact initializer logic):**
```ts
const [session, setSession] = useState<Session | null>(() => readStoredWebSession());
const [user, setUser] = useState<User | null>(() => readStoredWebSession()?.user ?? null);
const [loading, setLoading] = useState<boolean>(() => readStoredWebSession() === null);
```

Precise semantics the implementor MUST honor:
- **Native (any platform ≠ web):** `readStoredWebSession()` returns `null` → `session=null`, `user=null`, `loading=true`. **Byte-identical to today.** This is the non-negotiable native-parity guarantee — initial state is unchanged off-web.
- **Web, no stored session (logged-out, or anon buyer route):** `readStoredWebSession()` returns `null` → `session=null`, `user=null`, `loading=true`. **Identical to today** — the existing bootstrap runs and resolves to signed-out cleanly. No false "logged-in" flash.
- **Web, valid stored session present:** `session=<stored>`, `user=<stored.user>`, `loading=false` on the FIRST render. → `deriveBusinessAuthStatus` returns `signed_in_ready` (loading=false, usable session, `user.id` present) → `isBusinessAuthReady` returns `true` → `isAuthReady === true` on first paint → `useBrands` `enabled` flips true → `/rest/v1/brands` fires. **The cure.**

> **Why three independent `() => readStoredWebSession()` reads are safe:** each runs exactly once at mount (lazy initializer). Calling `readStoredWebSession()` up to 3 times at mount is a trivial synchronous `localStorage.getItem` + `JSON.parse`; cost is negligible and there is no consistency risk (single-threaded JS, same key, same render tick). The implementor MAY hoist a single `const initialStored = readStoredWebSession();` ABOVE the three `useState` calls and reference it in all three initializers to read once — **this is the PREFERRED form** (one read, obviously consistent). Either form is acceptable; the hoisted single-read is cleaner. (Note: a hoisted const is computed on every render, but the value is only consumed by the lazy initializers on mount — harmless; if the implementor prefers strictly-once, keep the `() => readStoredWebSession()` lazy form in each initializer.)

#### 4.1.c Bootstrap effect (lines 210-392) — make it idempotent with the synchronous hydration

The existing `bootstrap()` async function (lines 238-390) MUST still run after mount. With synchronous hydration it now runs against already-populated state. Required consistency edits:

1. **ORCH-1106 probe must NOT double-fire and must NOT be skipped.** The probe is already guarded by `bootSessionProbedRef` (lines 311-312: `if (!bootSessionProbedRef.current) { bootSessionProbedRef.current = true; … }`). The synchronous initializer does NOT touch this ref, and does NOT run any probe. So:
   - The `getSession()` race still resolves (or times out) in the background; when it resolves to a real session with `s.user`, the existing `if (!bootSessionProbedRef.current)` block runs the `getUser()` revoked-session validation **exactly once**, signing out a server-revoked-but-locally-valid token. **This is unchanged and MUST be preserved.**
   - **CRITICAL ORCH-1106 PRESERVATION:** the bug means `getSession()` can TIME OUT (3s) without resolving the real session. On timeout, the code today takes the `raceResult === AUTH_BOOTSTRAP_TIMEOUT` branch (lines 258-269) which sets state from `readStoredWebSession()` and `return`s **WITHOUT running the `getUser()` probe** (the probe lives only in the success branch, gated behind `s?.user`). That is the SAME behavior as today (the timeout path never probed). Synchronous hydration does NOT change this: the probe still only runs if/when `getSession()` actually resolves with a user. **The implementor MUST NOT add a probe to the timeout branch** (that would be new behavior + could sign out a valid user on a slow network — out of scope and dangerous). The revoked-session guarantee is "best-effort, runs when getSession resolves," exactly as ORCH-1106 shipped it. Document this in a code comment.
   - **Hardening note (implementor SHOULD add):** because the wedge case is precisely "`getSession()` times out under the lock," consider whether the existing TOKEN_REFRESHED / INITIAL_SESSION late-adopt path (ORCH-1004, lines 421-452) eventually resolves a real session and THEN runs the probe. It does NOT — the late-adopt path (lines 460-549) only runs the probe under `_event === "SIGNED_IN"`, not passive events. This is **unchanged from today** and is acceptable (the probe is best-effort). Do NOT add probe logic to the passive late-adopt path; that is out of scope.

2. **The success branch `setSession(s)` / `setUser(s?.user ?? null)` (lines 283-284) is idempotent with the initializer.** If `getSession()` resolves with the same session, re-setting identical state is a no-op-ish re-render (React bails on `Object.is`-equal primitives but the session object is a new reference — one extra render, harmless). If it resolves with a refreshed token, the newer session correctly overwrites the hydrated one. **No edit needed; confirm and leave as-is.**

3. **The timeout branch (lines 258-269) already calls `readStoredWebSession()` and sets state.** With synchronous hydration this is now redundant-but-harmless (it re-sets the same stored session it already hydrated). **Leave as-is** — it remains the correct fallback for the case where the stored session changed between mount and timeout (it won't, but defensive). The `if (!mounted) return` at line 262 is fine; even if the provider unmounts before the timeout, the synchronously-hydrated state already drove the first paint, so the brand query already fired.

#### 4.1.d 7s hard-ceiling (lines 222-235) — confirm it CANNOT clobber a hydrated user

The hard-ceiling timer (lines 224-235) only does two things: `bootstrapTimedOutRef.current = true` and `setLoading(false)`. It does **NOT** call `setUser(null)` or `setSession(null)`. Therefore it can NEVER downgrade a synchronously-hydrated valid `user`/`session` to signed-out — it only releases the loading gate (which is already `false` when we hydrated). **This invariant already holds; the implementor MUST NOT change the ceiling to clear user/session, and MUST add a one-line comment locking this:** "ORCH-1204: the ceiling releases only `loading`; it MUST NOT clear `user`/`session` — a synchronously-hydrated valid web session must survive the ceiling."

Confirm the same for the UI-gate ceiling (`isAuthResolutionExpired` in coldLoadAuthGates.ts:370-387): it returns `false` immediately when `hasUser` is true (line 384). With a hydrated user, `user !== null` on first render → `authResolutionExpired` is `false` → no redirect. **No edit to coldLoadAuthGates.ts.** (Confirmed by reading `_layout.tsx:415-427`: `markAuthResolveStart()` only runs `if (isWeb && authResolving && user === null)`, and `authResolving` is false when `user !== null` — so the resolution window is never even started for a hydrated user.)

#### 4.1.e ORCH-1004 late-adopt (lines 396-461) — consistency with new initial state

The `onAuthStateChange` listener applies passive late events (INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED) when `bootstrapTimedOutRef.current` is true and the event carries a usable session (lines 421-452). With synchronous hydration:
- `bootstrapTimedOutRef` is set true by EITHER the 3s timeout branch OR the 7s ceiling. In the wedge case both fire. A subsequent TOKEN_REFRESHED with a real session will correctly clear the gate and apply the (already-hydrated, possibly-refreshed) session — **no duplicate analytics** because the SIGNED_IN-only block (lines 480-549) is still gated to `_event === "SIGNED_IN"`. **No edit needed; confirm the gating is intact.**
- No `#185` self-redirect loop is introduced: with a hydrated user, the layout renders the Stack (no redirect), so no navigation churn.

### 4.2 Optional item #6 — `mingla-business/src/services/supabase.ts` (lock contention reduction)

**ONLY if the implementor judges it strictly low-risk.** Candidate, in priority order (pick at most ONE, or NONE):
- (a) Lower `WEB_LOCK_ACQUIRE_TIMEOUT_MS` (line 74) from 2300 to a smaller value (e.g. 1500ms) so an orphaned lock self-heals faster, still comfortably under `AUTH_BOOTSTRAP_TIMEOUT_MS` (3000). Keep the `< AUTH_BOOTSTRAP_TIMEOUT_MS` comment invariant true.
- (b) Leave `webResilientLock` exactly as-is (RECOMMENDED default — the synchronous hydration cure makes the lock irrelevant to first paint, so touching the cross-tab lock adds risk for no first-paint benefit).

**Hard rule for #6:** it must not change native (already web-gated via `Platform.OS === "web"` spread at supabase.ts:125), must not break the ORCH-1100 cross-tab self-heal, and must not be presented as the cure. If chosen, it gets its own one-line success criterion and a note that the primary cure stands without it. **Default expectation: OMIT #6.**

---

## 5. Success criteria

All criteria are Business-Web-only (the sole covered surface). "First render" = the initial React commit of `AuthProvider` + `RootLayoutInner`, before any `await`.

- **SC-1-Web (THE CURE):** With a valid stored web session in `localStorage` and `getSession()` artificially hung (never resolves), `AuthProvider`'s first render yields `session` non-null, `user` non-null (with `user.id`), and `loading === false`; therefore `isAuthReady === true` on first paint and `useBrands` is `enabled`. Observable: `/rest/v1/brands` fires WITHOUT awaiting `getSession()`. (This is the exact symptom inversion of the Samsung capture, where `/rest/v1/brands` fired 0 times.)
- **SC-2-Web (no false sign-out, server-revoked):** With a stored session present BUT the server having revoked it, the background `getSession()`→`getUser()` ORCH-1106 probe still runs exactly once (when `getSession()` resolves) and, on a positively-identified `invalid_session` verdict, signs the user out (clears stores + RQ cache, sets `user`/`session` null) and routes to sign-in. Synchronous hydration does NOT skip or double-fire this probe (`bootSessionProbedRef` honored).
- **SC-3-Web (clean logged-out):** With NO stored session (real logged-out user, or an anon buyer route), first render yields `session=null`, `user=null`, `loading=true`; the existing bootstrap resolves to signed-out and the route gates redirect to sign-in (or render the public buyer page) exactly as today. No regression, no false "loading brands" wedge, no spinner trap.
- **SC-4-Web (ceiling cannot clobber):** The 7s `AUTH_RESOLUTION_HARD_CEILING_MS` timer firing does NOT clear a synchronously-hydrated `user`/`session`; it only sets `loading=false` + `bootstrapTimedOutRef`. A hydrated user survives the ceiling and the app renders the brand list.
- **SC-5-Web (SSR/prerender safe):** During the Expo-web static-export prerender (`typeof window === "undefined"`), the `useState` initializers return `session=null`, `user=null`, `loading=true` (because `readStoredWebSession()` returns `null` off-window). The client hydration then re-reads `localStorage` on the first client render. No React hydration-mismatch warning / #418 / #425 (see §6 SSR guard).
- **SC-6-Native (byte-identical):** On iOS and Android, `readStoredWebSession()` returns `null` (Platform gate) → initial state is `session=null`, `user=null`, `loading=true` — identical to pre-change. Native bootstrap, splash timing, and the ORCH-1106 native probe are unchanged.
- **SC-7-Web (optional #6, only if included):** If lock hardening is included, the cross-tab orphaned-lock self-heal still works (a second tab can still acquire/steal the lock) and `WEB_LOCK_ACQUIRE_TIMEOUT_MS < AUTH_BOOTSTRAP_TIMEOUT_MS` still holds. If #6 is omitted, this SC is N/A.

---

## 6. SSR / hydration-mismatch guard (the exact guard)

Mingla's Expo-web build statically prerenders pages in Node (no `window`). History: ORCH-0951 / ORCH-1103 hit hydration-mismatch issues (React #418/#425) when client-only state diverged from the server-rendered tree.

The guard here is **automatic and already correct** because of how `readStoredWebSession()` is written (AuthContext.tsx:90-91):
```ts
if (Platform.OS !== "web" || typeof window === "undefined") return null;
```
- **On the server (prerender):** `typeof window === "undefined"` → initializer returns `null` → server-rendered HTML reflects `loading=true` (the `AuthResolvingScreen` spinner / no user). This is the SAME tree the server has always produced (today's `useState(null/null/true)`).
- **On the client (hydration):** React's hydration pass uses the SERVER-rendered HTML for the FIRST commit, then the effect/state takes over. Because `useState` initializers on the client run during the initial client render, the client's FIRST render with a stored session would compute `loading=false`. **This is exactly the ORCH-0951/1103 mismatch risk** if React were doing classic SSR hydration of the same component tree.

**However**, this is NOT classic hydration of differing markup, and the existing codebase already proves the pattern is safe: `_layout.tsx`'s `hasStoredSupabaseWebSession()` (lines 184-198) ALREADY reads `localStorage` synchronously during render (it is called at line 334 in `RootLayoutInner`'s render body, feeding `isWebAuthResolving` / `shouldRedirectToSignInFromRoute`), and that read ALREADY diverges between server (returns `false`) and client (may return `true`) on the first client render — with no #418/#425 reported since ORCH-1102/1115/1139 shipped. The Expo-web static export renders a SHELL (spinner) and the client takes over routing; Expo Router does not do strict text-node hydration reconciliation on this auth shell.

**Therefore the binding guard is:** the initializer MUST funnel through `readStoredWebSession()` (which contains the `typeof window === "undefined"` + `Platform.OS !== "web"` guards) and MUST NOT read `window.localStorage` directly in the initializer. This guarantees the server initializer returns `null` (matching today's server tree) and the divergence is confined to the same client-only auth-shell boundary that `hasStoredSupabaseWebSession()` already crosses safely.

**Implementor verification step (REQUIRED):** after the change, run the Expo-web static export (`npx expo export -p web` in `mingla-business`, or the project's existing web build command) and confirm no new React hydration warning appears in the build output vs. baseline `origin/main`. If a NEW #418/#425/#423 warning appears, STOP and request a SPEC amendment (do not ship a hydration regression).

---

## 7. How every preserved safety net continues to hold

| Net | ID | What it does | How it survives synchronous hydration |
|-----|----|--------------|-----|
| getSession race timeout | ORCH-0887-A | 3s `Promise.race` → fall through as stored session / anon | Still runs in `bootstrap()`. Now races against ALREADY-hydrated state; on timeout it re-sets the same stored session (harmless). No change. |
| Late-session adoption | ORCH-1004 | Apply passive INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED after timeout | Still runs in `onAuthStateChange`; clears `bootstrapTimedOutRef`, applies refreshed session, SIGNED_IN-only analytics gating intact → no duplicate analytics, no #185. No change. |
| Hard ceiling | ORCH-1102 | 7s wall-clock release of `loading` (web) | Only sets `loading=false` + `bootstrapTimedOutRef`; NEVER clears `user`/`session`. A hydrated user survives it (SC-4). Comment added to lock the invariant. No logic change. |
| Revoked-session probe | ORCH-1106 | One `getUser()` after a locally-trusted session; sign out on `invalid_session` | `bootSessionProbedRef` un-touched by initializer → probe runs exactly once when `getSession()` resolves with a user; never double-fires, never skipped. Best-effort timeout-path behavior unchanged (probe only on resolve). No change. |
| Sign-out / clear-everything | Constitution #6 | `signOut()` + SIGNED_OUT handler clear stores, RQ cache, analytics | Untouched. A server-fired SIGNED_OUT still clears the hydrated session via `setSession(null)`/`setUser(null)` in the handler. No change. |
| Route gates | ORCH-1102/1103/1115/1139 | Redirect / loading / public-route exemptions | `coldLoadAuthGates.ts` + `_layout.tsx` gate on `user !== null` / `hasUser`; a hydrated user makes `authResolving=false`, `redirectToSignIn=false`, `authResolutionExpired=false` automatically. NO edit to these files. |

---

## 8. Invariants

### Preserved (verify, do not break)
- **I-AUTH-BOOTSTRAP-TIMEOUT** (ORCH-0887-A): the 3s race still exists and still flips `loading`. Preserved — unchanged.
- **ORCH-1102 bounded-loading** (`AUTH_RESOLUTION_HARD_CEILING_MS` + `isAuthResolutionExpired`): still exist; now provably cannot clobber a hydrated user (SC-4).
- **ORCH-1106 boot-session-probe fail-OPEN**: `classifyBootSessionProbe` defaults to `keep_session`; probe runs at most once. Preserved.
- **ORCH-1100 web lock** (`webResilientLock`, `WEB_LOCK_ACQUIRE_TIMEOUT_MS < AUTH_BOOTSTRAP_TIMEOUT_MS`): if item #6 is included, this inequality MUST still hold. If omitted, untouched.
- **I-PROPOSED-1115-PUBLIC-BUYER-ROUTE-ALLOWLIST** + ORCH-1139 exempt routes: untouched (no route-gate edit).
- **Constitution #6** (clear-everything on sign-out): untouched.

### New (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)

**`I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION`**
- **Rule:** On web (`Platform.OS === "web"`), when a valid persisted Supabase session exists in `localStorage` (`hasUsableBusinessSession`), the `AuthProvider`'s INITIAL React state MUST yield a ready auth state on the FIRST render — `session` non-null, `user` non-null, `loading === false`, hence `isAuthReady === true` — independent of, and without awaiting, `supabase.auth.getSession()` or the gotrue Navigator-Locks auth-token lock. Off-web, or with no usable stored session, initial state MUST remain `{ session: null, user: null, loading: true }` (today's behavior).
- **Enforcement:** the three `useState` initializers in `AuthContext.tsx` derive from `readStoredWebSession()` (web-only + SSR-guarded). A code comment tags the block `I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION`.
- **Regression test:** `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx` (see §9) renders `AuthProvider` with a mocked `localStorage` holding a valid session AND a `supabase.auth.getSession` mock that NEVER resolves, then asserts a consumer reads `isAuthReady === true` and `user.id` set on first paint. FAILS when the initializers are reverted to `useState(null/null/true)`.

---

## 9. Test cases & regression contract (Step 0.5)

### 9.a Implementor happy-path test (fails-on-revert) — REQUIRED
**File:** `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx`

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (CURE) | Valid stored session + hung getSession | mock `Platform.OS='web'`; mock `window.localStorage.getItem(WEB_AUTH_STORAGE_KEY)` → JSON of a session with `access_token`, `user.id`; mock `supabase.auth.getSession` → a Promise that NEVER resolves; mock `onAuthStateChange` → no-op subscription | A test consumer of `useAuth()` reads `isAuthReady === true`, `user.id === '<id>'`, `loading === false` on the FIRST committed render (synchronously, before any `act`/flush that would resolve getSession) | context |
| T2 (no-store passthrough) | No stored session | `localStorage.getItem` → `null`; getSession hung | First render: `user === null`, `loading === true`, `isAuthReady === false` (today's bootstrapping state) | context |

**Fails-on-revert proof:** reverting the initializers to `useState<...>(null)` / `useState(true)` makes T1 fail (`isAuthReady` would be `false` / `loading` `true` while getSession hangs). The implementor MUST run the test against the reverted initializers and paste the FAIL output, then restore and paste PASS.

### 9.b Adversarial-tester angle (DIFFERENT axis — for mingla-tester, not the implementor)
The tester MUST attack from angles the happy-path test does NOT cover:
- **A1 — server-revoked stored session (SC-2):** stored session present but `getUser()` returns a 401 / `session_not_found`. Assert the background probe STILL signs the user out (stores cleared, RQ cache cleared, `user` → null, route → sign-in). Synchronous hydration must NOT mask a dead session.
- **A2 — SSR safety (SC-5):** simulate `typeof window === 'undefined'`; assert initializers return `null`/`null`/`true` and the Expo-web static export produces no NEW React hydration warning vs `origin/main`.
- **A3 — ceiling cannot clobber (SC-4):** valid stored session hydrated; advance fake timers past 7000ms; assert `user`/`session` are still non-null after the ceiling fires (only `loading` changed).
- **A4 — native parity (SC-6):** `Platform.OS='ios'`; assert initial state is `null`/`null`/`true` and getSession is still awaited (no synchronous hydration off-web).
- **A5 — multi-tab live-fire (the proven repro):** on Seth's Samsung (or any web browser with ≥3 same-origin tabs open + a valid session), cold-reload and confirm `/rest/v1/brands` fires and the brand switcher loads (no "Loading brands…" wedge). This is the exact inversion of the LIVE_SAMSUNG_rootcause.txt capture. Human-in-the-loop (drive Seth's device; do not puppet it).

### 9.c Regression prevention (structural safeguard)
- **Safeguard:** the DRAFT invariant `I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION` + its test T1.
- **Protective comment** (at the initializer block): `// ORCH-1204 [web-auth-bootstrap-lock]: web hydrates session/user/loading SYNCHRONOUSLY from the valid persisted token so isAuthReady is true on first paint — the gotrue Navigator-Locks lock contention (multi-tab + AuthProvider remount) can make getSession() exceed the 3s bootstrap timeout, which previously left isAuthReady false → useBrands disabled → "Loading brands…" wedge. readStoredWebSession() is web-only + SSR-guarded so native is byte-identical and prerender returns null. I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION. DO NOT revert to useState(null/null/true).`

---

## 10. Implementation order

1. **(Optional, default OMIT) Item #6** — if and only if low-risk, adjust `WEB_LOCK_ACQUIRE_TIMEOUT_MS` in `supabase.ts` (keep `< 3000`). Recommend skipping.
2. **AuthContext.tsx** — change the three `useState` calls (lines 175-177) to lazy initializers per §4.1.b (PREFERRED: hoist one `const initialStored = readStoredWebSession();` and reference it). Add the protective comment (§9.c).
3. **AuthContext.tsx** — add the one-line ceiling-invariant comment at lines 224-235 (§4.1.d): the ceiling must not clear `user`/`session`. (Comment only — no logic change.)
4. **AuthContext.tsx** — confirm (comment if helpful) that the timeout branch does NOT add a probe and the ORCH-1106 `bootSessionProbedRef` gate is intact (§4.1.c). No logic change.
5. **Write the test** — `authContext.sync-hydration.orch1204.test.tsx` (T1 + T2), prove fails-on-revert.
6. **Verify SSR** — run the Expo-web static export; diff hydration warnings vs `origin/main` (§6). 
7. **Run gates** — existing auth/coldLoadAuthGates jest suites must stay green (no edits to those files; this proves no regression).

---

## 11. Allowlist & DO-NOT-TOUCH

### Allowlist (implementor MAY change ONLY these)
- `mingla-business/src/context/AuthContext.tsx` — the three `useState` initializers + comments (the ONLY logic change).
- `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx` — NEW test file.
- `mingla-business/src/services/supabase.ts` — **ONLY IF** item #6 is included (default: NOT touched).

### DO-NOT-TOUCH (stop-and-amend before touching)
- `mingla-business/src/hooks/useBrands.ts` — correct; the gate signal was the bug, not this hook.
- `mingla-business/src/hooks/useBrandListShim.ts` — correct.
- `mingla-business/src/utils/authReadiness.ts` — `deriveBusinessAuthStatus` / `isBusinessAuthReady` / `hasUsableBusinessSession` are correct and produce the right result given a hydrated session.
- `mingla-business/src/utils/coldLoadAuthGates.ts` — route gates already short-circuit on `hasUser`; no edit.
- `mingla-business/app/_layout.tsx` — gates already short-circuit on `user !== null`; no edit.
- The ORCH-1106 probe logic, ORCH-1004 late-adopt block, ORCH-0887-A race, ORCH-1102 ceiling LOGIC, Constitution #6 sign-out path — comments only, no behavior change.
- Native code paths (anything not web-gated).

Touching anything outside the allowlist requires a SPEC amendment (`Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-1204_web-auth-bootstrap-lock.md` or an in-file append) BEFORE the edit — never silently widen.

---

## 12. Open questions
- **OQ-1 (item #6):** include the optional lock-timeout reduction, or omit? **SPEC recommendation: OMIT** — the synchronous-hydration cure makes the lock irrelevant to first paint; touching the cross-tab lock adds ORCH-1100 regression risk for zero first-paint benefit. Implementor defaults to omit unless Seth/orchestrator directs otherwise.
- No other open questions — the root cause is proven and the fix is fully specified.

---

## 13. Downstream routing & shipping note
- **Next phase:** IMPLEMENT — `mingla-implementor` (claude side). Then TEST — `mingla-tester` (web side, must run the §9.b adversarial angles including the A5 live-fire on Seth's device). Then orchestrator CLOSE (flips `I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION` to ACTIVE).
- **Worktree:** `~/Desktop/mingla-orchs/1204-[web-auth-bootstrap-lock]` on branch `1204-web-auth-bootstrap-lock`.
- **Shipping:** Vercel `[deploy]` (web) ONLY. **NO `eas update` for mingla-business** — COMMS-0052 (business OTA crashes on the PostHog native module). The pure-JS change rides the next business native build. No migration, no edge deploy, no new dependency.
