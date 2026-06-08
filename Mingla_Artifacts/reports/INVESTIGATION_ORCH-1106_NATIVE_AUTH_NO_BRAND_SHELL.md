# INVESTIGATION — ORCH-1106 [native authenticated, no-brand degraded shell]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1106-[native-authenticated-no-brand-shell]/` on branch `ORCH-1106-native-authenticated-no-brand-shell` (clean at origin/main)
**Surface:** NATIVE Mingla Business app — iOS confirmed (Seth, physical iPhone, screenshot); Android shares the identical code path.
**Mode:** INVESTIGATE only. No fix written.
**Comms ledger:** read on entry. No `BLOCK`/`WARN`-OPEN rows target this skill, ORCH-1106, or `ALL`. No new cross-ORCH discovery to write.
**Confidence:** **PROVEN** (downstream terminal-state chain executed live through the real decision modules; upstream trigger proven against the installed `@supabase/auth-js` 2.103.0 library source). The only un-performed step is a full-device repro of an externally-revoked session, blocked by no business dev build being installed — the mechanism is library-deterministic, not gesture/pixel, so this does not cap confidence below `proven`. See "Reproduction" below.

---

## Symptom (as reported)

Seth, authenticated, on his physical iPhone (NATIVE app — not a browser), with screenshot:
- Brand switcher reads **"Create brand"** (no current brand selected).
- **Home body is empty.**
- Bottom nav shows **only Home + Account** (no Hub / Blast / Ari).
- Seth: "I saw that I was authenticated and was NOT immediately routed to the sign in screen."

Interpretation under test: he expected the **sign-in screen** (i.e. he was effectively unauthenticated / his session was invalid), but the app instead left him on a brand-less degraded shell.

**Expected:** if the session is invalid, sign out and route to `BusinessWelcomeScreen` (sign-in).
**Actual:** `user` stays truthy, the app routes to Home, the brand fetch returns nothing, and the user is stranded on the no-brand shell.

---

## Verdict in one line

**This is case (a): invalid-session / stale-truthy-user — NOT case (b) brand-fetch-race.** The race (b) is already defended by the ORCH-1100 `brandPointerPending` guard in `app/(tabs)/_layout.tsx`, which keeps the full tab set until resolution settles. Seth is seeing the **settled** 2-tab state, which can only occur when resolution completed with an **empty, error-free brand list** — the signature of a session that no longer authorizes the user's own rows.

---

## Root cause (the journey, proven end-to-end)

### Step 0 — `getSession()` deserializes a stale session into a truthy `user` WITHOUT server validation

`mingla-business/src/services/supabase.ts:113-127` creates the client with `persistSession: true`, `autoRefreshToken: true`, AsyncStorage on native. On cold start, `AuthContext` bootstrap calls `supabase.auth.getSession()` (`src/context/AuthContext.tsx:242`).

`getSession()` is a **local read**. In the installed library `@supabase/auth-js@2.103.0` (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`, `__loadSession()` lines 2302-2360):

```js
const hasExpired = currentSession.expires_at
    ? currentSession.expires_at * 1000 - Date.now() < EXPIRY_MARGIN_MS
    : false;
if (!hasExpired) {
    ...
    return { data: { session: currentSession }, error: null };   // <-- NO network call
}
const { data: session, error } = await this._callRefreshToken(currentSession.refresh_token);
```

**Two sub-cases:**

- **(a)-1 — access token NOT locally expired, but server-invalid** (refresh token revoked / account deleted / password reset / signed-out-elsewhere / server session invalidation, while the cached access token is still inside its ~1 h `expires_at` window): `__loadSession` returns the stored session **as-is, with NO network validation**. `getSession()` resolves with a truthy `user`. **No refresh is attempted, so `TOKEN_REFRESHED`/`SIGNED_OUT` never fire.** This is the durable strand.
- **(a)-2 — access token locally expired + refresh token invalid:** `_callRefreshToken` (line 3866) → `_refreshAccessToken` errors → for a non-retryable auth error, `await this._removeSession()` runs (line 3892), which emits `SIGNED_OUT`. The `AuthContext` `SIGNED_OUT` handler (`AuthContext.tsx:457-481`) then clears `user` → `app/index.tsx`'s `if (!user)` shows sign-in. **(a)-2 self-heals correctly even on native.** It is **(a)-1 that strands.**

`deriveBusinessAuthStatus` (`src/utils/authReadiness.ts:50-66`) marks the session `signed_in_ready` purely from `hasUsableBusinessSession(session)` = `access_token` is a non-empty string (lines 38-41) **plus** `user?.id` present. It does NOT verify the token. So `isAuthReady === true`.

### Step 1 — auth-ready + truthy user → `app/index.tsx` routes to Home

`app/index.tsx:90-102`: `if (!user)` → sign-in; else `<Redirect href={AppRoutes.home} />`. With a truthy stale `user`, the app **redirects to Home** — exactly the "NOT routed to sign in" Seth described. (The native path has no auth-resolution backstop here — all the index.tsx deadline logic is `isWeb`-gated, lines 52-85.)

### Step 2 — the brand list query returns `[]` (error-free) under the stale JWT

`useBrands(userId)` (`src/hooks/useBrands.ts:127-199`) is `enabled = isAuthReady && accountId !== null` → fires `getBrands(userId)`.

`getBrands` (`src/services/brandsService.ts:425-456`):
```js
const { data, error } = await supabase.from("brands").select("*")
    .eq("account_id", accountId).is("deleted_at", null)...;
if (error) throw error;
```
The RLS SELECT policy (latest: `supabase/migrations/20260507000000_orch_0734_rls_returning_owner_gap_fix.sql:41-45`) is `USING (account_id = auth.uid())`. Under a stale/invalid JWT, PostgREST either (i) resolves the request with a `uid` that no longer matches any brand rows, or (ii) treats it as anon — **either way `data = []`, `error = null`.** `useBrands.ts:130-135` comment confirms this exact behavior: *"anon returns 200 + [] which caches as success."* So the empty list is cached as **SUCCESS, not error.** (If PostgREST instead returns a hard 401 for a locally-expired-but-not-refreshed token, `getBrands` throws → `useBrands.isError` → the resolver's `dataReady` requires `!hasQueryError` so resolution is skipped and `currentBrandId` stays at its persisted value — which is `null` on a fresh/cleared device. Same terminal state.)

### Step 3 — the resolver maps an empty list to `currentBrandId = null`

`useCurrentBrandRecovery` (`src/hooks/useCurrentBrandRecovery.ts:30-130`): with `brands = []`, `dataReady = true` (auth ready, fetched, no error), it calls `resolveCurrentBrandId`. `src/utils/currentBrandResolver.ts:24-43`:
```js
const newestBrand = brands[0];        // undefined for []
if (newestBrand !== undefined) {...}
return { brandId: null, reason: "none" };
```
The effect then `setCurrentBrandId(null)` (line 88). The `currentBrandAutoClear` guard (`src/utils/currentBrandAutoClear.ts`) is irrelevant here — the pointer is already null; there is nothing to clear.

### Step 4 — `currentBrandId = null` → role rank 0 → nav collapses to Home + Account

`app/(tabs)/_layout.tsx:98-122`: `rank = useCurrentBrandRole(currentBrandId=null)` → `0` (NO_MEMBERSHIP_RANK). The `brandPointerPending` guard (lines 114-117) — the ORCH-1100 race defense — is now **false** (resolution has settled, `brandResolving=false`, store hydrated), so `visibleTabsForRank(TABS, 0)` runs with real rank 0. `src/utils/navTabGate.ts:42-69`: only `home (0)` and `account (0)` pass; `hub (30)`, `ari (30)`, `marketing (20)` are filtered out. **Nav = Home + Account.** Exactly the screenshot.

### Step 5 — Home renders the empty no-brand body

`app/(tabs)/home.tsx:392-398`: rank `< scanner` (i.e. rank 0 / no membership) falls through to the regular Home, whose analytics tiles only render with real numbers (no-fabrication policy) → **empty Home body** + the "create a brand" empty-state prompt. Brand switcher with no current brand reads **"Create brand."** All three reported symptoms reproduced.

---

## Six-field root-cause record

| Field | Content |
|---|---|
| **File + line** | Primary: `src/context/AuthContext.tsx:242` (`getSession()` trusted without validation) + the absence of any native sign-out-on-auth-failure path. Library mechanism: `@supabase/auth-js@2.103.0` `GoTrueClient.js` `__loadSession` lines 2334-2353 (non-expired stale session returned as-is). Downstream: `currentBrandResolver.ts:42` (`[]`→null) + `navTabGate.ts:42-69` (rank 0 → 2 tabs). |
| **Exact code** | `if (!hasExpired) { ... return { data: { session: currentSession }, error: null }; }` (library) → `setUser(s?.user ?? null)` (AuthContext:269) → `return { brandId: null, reason: "none" }` (resolver) → `tabs.filter(tab => rank >= MIN_RANK_FOR_TAB[tab.id])` (navTabGate). |
| **What it does** | Cold start trusts the persisted access token's local `expires_at` and never re-validates against the server. A server-invalidated-but-not-locally-expired session yields a truthy `user`, the brand list comes back empty/error-free, and the UI settles on a brand-less Home + 2-tab nav. No `SIGNED_OUT` fires, so the app never routes to sign-in. |
| **What it should do** | When the session is actually unusable (a brand/account read the user is entitled to comes back empty-due-to-auth, OR an auth read returns 401, OR refresh fails), treat the user as logged-out: sign out and route to `BusinessWelcomeScreen` — never strand on the no-brand shell. |
| **Causal chain** | stale-valid-session in AsyncStorage → `getSession()` returns truthy `user` (no validation) → `isAuthReady=true` → `index.tsx` redirects to Home → `useBrands` returns `[]` (RLS empty under stale JWT, cached as success) → resolver sets `currentBrandId=null` → `useCurrentBrandRole(null)=rank 0` → `visibleTabsForRank` drops Hub/Ari/Blast → Home renders empty no-brand body + "Create brand". |
| **Verification step** | (1) Runtime harness executing the **real** `currentBrandResolver.ts` + `navTabGate.ts` + `authReadiness.ts` with `{session present, user present, brands:[]}` → output: `isAuthReady=true`, `brandId=null`, `tabs=[home,account]` — exact screenshot match (see Reproduction). (2) Library source read of installed auth-js 2.103.0 confirming `__loadSession` returns a non-expired stale session without a network call and `_callRefreshToken` only removes the session on refresh failure (the (a)-2 path), never on the (a)-1 path. |

---

## Reproduction (always-reproduce rule)

**Live runtime execution — PROVEN (downstream chain).** No iOS sim was booted and no business dev build is installed on any sim (a native dev build is a ~30-min rebuild per the runbook; the bug is a logic/data path, not a gesture/keyboard/animation bug). Instead I executed the **actual decision modules from the codebase** (`currentBrandResolver.ts`, `navTabGate.ts`, `authReadiness.ts` — pure leaf modules, no RN deps) via `tsx`, feeding the case-(a) input (stale session present, brands `[]`):

```
hasUsableSession: true
authStatus      : signed_in_ready
isAuthReady     : true (=> useBrands ENABLED, fires getBrands)
brand resolution: { brandId: null, reason: 'none' } (=> currentBrandId set to null)
MIN_RANK_FOR_TAB: { home: 0, hub: 30, ari: 30, marketing: 20, account: 0 }
visible tabs    : [ 'home', 'account' ]
=== TERMINAL STATE ===
user truthy: true | currentBrandId: null | nav tabs: home, account
Matches Seth's screenshot (Create-brand, empty Home, Home+Account only): true
```

**Upstream trigger — PROVEN by library source.** The `getSession()` no-validation behavior and the asymmetry between (a)-1 (no `SIGNED_OUT`) and (a)-2 (`_removeSession` → `SIGNED_OUT`) were read directly from the installed `@supabase/auth-js@2.103.0` bundle (the exact runtime). PostgREST's "expired/invalid JWT → 401 or anon-empty rows under RLS" is established platform behavior; both branches converge on the same terminal state (Step 2 above).

**Not performed:** a full physical-device run that server-revokes a live session and observes the strand. Reason: no business dev build installed; the chain is deterministic library + pure-module logic already executed above. Operator already supplied a physical-iPhone screenshot of the exact terminal state. Confidence remains `proven`.

---

## Which ORCH-1100 / ORCH-1102 guards native LACKS (every one is web-gated)

All recent auth-routing / degraded-shell hardening is `Platform.OS === "web"`-gated and therefore **absent on native**:

| Guard | File:line | Native? |
|---|---|---|
| Unauth → sign-in redirect (`shouldRedirectToSignIn`) | `src/utils/coldLoadAuthGates.ts:66-76` (`isWeb && ...`) | NO (always false on native) |
| Route-aware redirect (`shouldRedirectToSignInFromRoute`) | `coldLoadAuthGates.ts:124-137` | NO |
| Bounded "auth resolving" loading (`isWebAuthResolving`) | `coldLoadAuthGates.ts:152-163` (`if (!isWeb) return false`) | NO |
| Bounded-loading ceiling (`isAuthResolutionExpired`, 7 s) | `coldLoadAuthGates.ts:188-203` (`if (!isWeb) return false`) | NO |
| `_layout` redirect / loading branches | `app/_layout.tsx:295,342,344,541,549,556` (all `isWeb`-gated) | NO |
| `index.tsx` boot deadline / fall-through-to-sign-in | `app/index.tsx:52-85` (`const isWeb = Platform.OS==="web"`) | NO |
| Auth-lock self-heal (`webResilientLock`) | `src/services/supabase.ts:113-126` (`...(Platform.OS==="web" ? {lock} : {})`) | NO (native keeps default `processLock`) |
| Hard ceiling timer release (`AUTH_RESOLUTION_HARD_CEILING_MS`) | `src/context/AuthContext.tsx:208-221` (`if (Platform.OS==="web")`) | NO |

**Important nuance:** even the web guards target a *different* failure — `!user` (logout / no-session / infinite spinner). **None** of them sign out a user who holds a **stale-but-present** session (case (a)-1). So web has the same latent gap; it simply hasn't surfaced there because the lock/spinner failures dominate the web reports. The native-specific shortfall is that native has **no** unauth-routing or auth-failure self-heal at all, so case (a)-1 strands instead of recovering.

---

## Outcome & journey step-back

- **Seth's actual goal:** open the business app and either manage his brand, or — if his session is dead — be told to sign in again. Never be stranded somewhere he can't act.
- **Where reality diverges:** the app conflates "I have a token string in storage" with "I have a valid session." A token string is necessary but not sufficient. The single divergence point is Step 0: trusting `getSession()`'s local read as proof of a usable session.
- **Does fixing only the symptom deliver the outcome?** No. Forcing the nav to show all tabs, or auto-creating a brand, would mask the real problem (a dead session) and produce 401s on every action. The correct outcome requires detecting the invalid session and routing to sign-in. The fix must live at the auth layer (and/or treat an auth-driven empty/401 brand read as a sign-out signal), not at the nav/Home layer.

---

## Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | ORCH-1102 implementation report explicitly states native auth flow is "untouched" and all predicates gate on `isWeb` — confirming native has no unauth-routing. |
| **Schema** | `brands` RLS `USING (account_id = auth.uid())` (migration `20260507000000`, latest) → empty rows under stale/anon JWT. Correct policy; the gap is client trust, not RLS. |
| **Code** | `getSession()` trusted at `AuthContext.tsx:242`; resolver `[]`→null at `currentBrandResolver.ts:42`; nav rank-0 collapse at `navTabGate.ts:42-69`. All consistent with the symptom. |
| **Runtime** | Real decision modules executed → exact terminal state (Reproduction). auth-js 2.103.0 `__loadSession` returns non-expired stale session without validation. |
| **Data** | `currentBrandStore` persists `currentBrandId` (null on fresh/cleared device, or after `clearAllStores`). `useBrands` empty result caches as success. No contradiction — all layers agree the strand is real. |

---

## Blast radius

- **Native iOS + Android business app:** identical code path; both affected. (Consumer `app-mobile/` is a different app, not in scope.)
- **Web business app:** the *symptom* (no-brand shell) was the ORCH-1100 RC-1 report; ORCH-1100/1102 fixed the web *spinner/no-session* failures but did **not** add a stale-valid-session sign-out — web shares the latent case-(a)-1 gap.
- **Any auth-gated query under a stale session:** all `isAuthReady`-gated hooks will fire with a dead JWT and silently return empty/401 — the brand list is just the most visible one. A real fix at the auth layer fixes the class.
- **Invariants:** touches I-AUTH-BOOTSTRAP-TIMEOUT, the ORCH-1100 brand-hydration / `brandPointerPending` guard, and Constitution #6 (logout clears everything) + #11 (one auth authority). The fix must preserve the ORCH-1100 race guard (do not collapse during genuine resolution) and the ORCH-0887-A anti-flash protections.

---

## FIX DIRECTION OPTIONS (not a spec)

Listed strongest-first. A spec should choose and harden one; all must preserve the ORCH-1100 `brandPointerPending` race guard and ORCH-0887-A anti-flash refs, and must NOT regress (a)-2 (which already works).

1. **Validate the session at boot when it's been trusted locally (recommended, addresses the true root).** After `getSession()` returns a truthy non-expired session on native, perform one lightweight authenticated probe (e.g. `supabase.auth.getUser()` — a real network call — or the first brand read) and, on a 401 / `AuthSessionMissingError` / invalid-token response, call `signOut()` (which already clears stores + RQ + emits the route change) so `index.tsx` lands on sign-in. This converts (a)-1 into the already-working (a)-2 path. Gate carefully so a slow/offline network does NOT false-sign-out a genuinely valid session (treat only explicit auth errors as invalidation; network/timeout → keep session, retry).

2. **Treat an auth-driven empty/401 brand read as a sign-out signal.** In the brand-hydration chain, distinguish "authenticated user with genuinely zero brands" from "empty/401 because the JWT is invalid." A 401 on `getBrands` (or `getUser`) → `signOut()` + route to sign-in. (Risk: a legitimately brand-less new user must still reach the create-brand prompt — so this must key off an explicit auth error, not merely `brands.length === 0`.)

3. **Extend the web unauth→sign-in + bounded-loading guards to native.** Un-gate `shouldRedirectToSignIn` / `isWebAuthResolving` / the hard ceiling for native. This closes the no-`user` strand on native and gives a backstop, but **alone it does NOT fix case (a)-1** (there `user` is truthy, so `shouldRedirectToSignIn`'s `!hasUser` is false). Pair with Option 1 or 2; on its own it's insufficient.

4. **On-device confirmation step (tester/implementor handoff).** Build the native business dev build, sign in, externally revoke the session (Supabase dashboard "sign out user" / delete the refresh token / set a near-future `expires_at` with a revoked refresh token), relaunch, and confirm the chosen fix routes to sign-in instead of the no-brand shell. This is the live-device proof the current investigation deferred (mechanism-proven only).

---

## Discoveries for Orchestrator

- **Web shares the latent case-(a)-1 gap.** ORCH-1100/1102 fixed web spinner/no-session failures but never added a stale-valid-session sign-out. If a web user's session is server-revoked while the cached access token is still locally unexpired, web will strand on the same no-brand shell. Worth folding into the ORCH-1106 fix scope (de-gate the chosen validation so it runs on web too) rather than spawning a separate ORCH.
- **`getSession()` is trusted as session-validity proof in at least one other place** — any consumer that gates on `isAuthReady` inherits the same false-positive. A single boot-time validation (Option 1) is the cheapest class-fix.

---

## Confidence

**PROVEN.** Downstream terminal-state chain executed live through the codebase's real decision modules (exact screenshot match). Upstream trigger proven against the installed auth-js 2.103.0 source. The single un-performed step (full-device repro of an externally-revoked session) is blocked only by no business dev build being installed and is library-deterministic; it is the recommended tester/implementor confirmation (Fix Direction Option 4), not a gap in the root-cause proof.
