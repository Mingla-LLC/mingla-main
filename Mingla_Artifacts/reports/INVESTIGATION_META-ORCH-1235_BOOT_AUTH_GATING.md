# INVESTIGATION — META-ORCH-1235 (BOOT/AUTH GATING angle)

**Symptom:** business.usemingla.com intermittently freezes on a loading screen; a manual reload fixes it.
**Angle:** trace app boot → auth/session init → first-render gating on business WEB; find the gate that intermittently never resolves and freezes the whole app on a spinner.
**Method:** read-only, evidence-first (file:line). No code changed.

---

## 1. The boot → first-render gating sequence (file:line)

Provider tree, outermost → innermost (`mingla-business/app/_layout.tsx:738–791`):

```
GestureHandlerRootView
 └ SafeAreaProvider
   └ ErrorBoundary (outer, ORCH-0964)
     └ QueryClientProvider (queryClient singleton)
       └ AuthProvider                     ← owns the boot loading gate
         └ KeyboardRoot
           └ PostHogAnalyticsProvider
             └ RootLayoutInner            ← renders the WEB loading screen
```

Two side-effect imports run at module load BEFORE anything renders:
- `_layout.tsx:26` `import "../src/diagnostics/chunkReloadGuard"` — web-only, one auto-reload on a failed JS-chunk fetch (`chunkReloadGuard.ts:43–55`).
- `_layout.tsx:27` `silenceStripeForwardRef`.

### The ONLY whole-app web loading gate

On web there is **no native splash** — `SplashScreen.preventAutoHideAsync()`/`hideAsync()` are documented no-ops on web (`_layout.tsx:125–129`, `281–284`). The native splash gate (`brandReady` / `splashHidden`, `_layout.tsx:270–288`) therefore does **not** gate web render. The web "loading screen" is one of two identical orange spinners, both driven by the **same** `loading` flag from `useAuth()`:

1. **`RootLayoutInner` → `AuthResolvingScreen`** (`_layout.tsx:205–211`, returned at `_layout.tsx:678–680`) — shown when `authResolving` is true.
2. **`app/index.tsx` boot spinner** (`index.tsx:79–85`) — shown when `loading && !bootDeadlineExpired`.

`authResolving` is computed by `isWebAuthResolving` (`coldLoadAuthGates.ts:332–348`):
```
isWeb && !hasUser && (loading || hasStoredWebSession)
```

So the whole-app freeze reduces to: **`loading` (from AuthContext) is stuck `true`, OR `loading` flipped false but `user` is still null while a stored web session string exists** — and the backstop that is supposed to break that never fires.

---

## 2. Auth/session init — how `loading` / `user` resolve (AuthContext.tsx)

### Initial state (ORCH-1204 synchronous hydration) — `AuthContext.tsx:199–202`
```
const initialStored = readStoredWebSession();           // web-only, reads sb-…-auth-token
const [session] = useState(() => initialStored);
const [user]    = useState(() => initialStored?.user ?? null);
const [loading] = useState(() => initialStored === null); // <-- KEY
```
- If a **usable** stored web session exists at first paint → `loading` starts **false**, `user` is set → no spinner, app renders immediately. **This is why a reload almost always fixes the freeze** (see §5).
- If `readStoredWebSession()` returns **null** → `loading` starts **true** → the app shows the spinner and now depends entirely on the async `bootstrap()` (or a backstop) to flip `loading` false.

`readStoredWebSession` (`AuthContext.tsx:101–111`) returns null when: not web, `window` undefined, key absent, JSON parse throws, OR `hasUsableBusinessSession` is false (no non-empty `access_token`, `authReadiness.ts:37–41`).

### The async bootstrap — `AuthContext.tsx:266–425`
- Races `supabase.auth.getSession()` against a 3s timeout (`AUTH_BOOTSTRAP_TIMEOUT_MS = 3000`, `AuthContext.tsx:64`, race at `:281–285`).
- On timeout sentinel → reads stored session, `setLoading(false)` (`:286–305`).
- On resolve → `setSession/setUser`, then for a logged-in user runs the ORCH-1106 `getUser()` probe, `ensureCreatorAccount`, recovery, analytics, and finally `setLoading(false)` at **`:424`** (the single tail `setLoading(false)` for the success path).

### The listener — `onAuthStateChange` (`AuthContext.tsx:429–614`)
Registered synchronously right after `bootstrap()` is invoked. Applies late sessions and also calls `setLoading(false)` at `:613`.

### Backstops that exist to prevent an infinite spinner
- **AuthContext hard ceiling** `AUTH_RESOLUTION_HARD_CEILING_MS = 7000` (`:82`), armed as an **independent `setTimeout`** at `:248–263` (web only). At 7s it force-sets `bootstrapTimedOutRef = true` and `setLoading(false)` regardless of the lock subsystem.
- **UI-gate deadline** in `_layout.tsx:415–446` + `670–672` (`isAuthResolutionExpired`, ceiling 7000ms, `coldLoadAuthGates.ts:368–387`) — anchored in a **module-level** timestamp (`authResolveStartedAt`, `_layout.tsx:170–180`) so it survives remounts/render-loops; at expiry it `<Redirect href="/" />`.
- **index.tsx deadline** (`index.tsx:15–77`) — same module-level-anchor pattern; at expiry falls through to BusinessWelcomeScreen.
- **GoTrue web-lock clamp** `webResilientLock` with `WEB_LOCK_ACQUIRE_TIMEOUT_MS = 2300` (`supabase.ts`, the `lock: webResilientLock` option), shorter than the 3s bootstrap timeout so an orphaned cross-tab lock self-heals before bootstrap gives up.

### The Zustand persist / `_hasHydrated` gate — NOT a whole-app freeze
`currentBrandStore.hasHydrated` flips reliably via `onRehydrateStorage` (`currentBrandStore.ts:148–150`) — it fires even on a rehydration error. It feeds:
- the **native** splash gate `brandReady` (`_layout.tsx:270–274`, web no-op), and
- the **tabs** `brandPointerPending` which only changes *which tabs show* (`app/(tabs)/_layout.tsx:96–110`); the tabs layout renders `<Slot />` unconditionally (`(tabs)/_layout.tsx` host return), so it never blocks the whole app.

So hydration is **not** a whole-app freeze candidate on web.

---

## 3. Every gate that can hang, and its never-resolves failure mode

| Gate | Where | Never-resolves failure mode | Bounded? |
|---|---|---|---|
| `loading` (AuthContext) stuck true | `AuthContext.tsx:202` init + `:424/:613` flips | `bootstrap()`/listener never reach `setLoading(false)` (lock deadlock, awaited probe hangs, StrictMode unmount-bail) | YES — 7s hard ceiling `:248–263` |
| `authResolving` stuck (loading false, user null, **stored-session string present**) | `_layout.tsx:335–340`, `isWebAuthResolving` | A stale/partial `sb-…-auth-token` string with `"access_token"` substring lingers in localStorage but never produces a real `user`; spinner stays up even after `loading` flips | YES — `isAuthResolutionExpired` 7s `_layout.tsx:670–672` |
| index.tsx boot spinner | `index.tsx:79–85` | `loading` stuck true | YES — `index.tsx:61` deadline |
| Brand-recovery resolving (`brandRecoveryResolving`) | `useCurrentBrandRecovery.ts:209–217` → `brandReady` `_layout.tsx:270–274` | Only gates **native** splash; web ignores it. Plus 2s `BRAND_FETCH_TIMEOUT_MS` (`_layout.tsx:135,261–268`) | N/A on web |
| Zustand `_hasHydrated` | `currentBrandStore.ts:148–150` | `onRehydrateStorage` fires even on error; tabs render `<Slot />` anyway | N/A (not whole-app) |

**Net:** every whole-app web spinner is bounded by a 7s render-time deadline anchored in a module-level timestamp that survives remounts and render loops. The spinner is *not* designed to be infinite. The intermittent freeze is therefore most likely **the ~3–9s window before a backstop fires** (a real, observable "freeze on a loading screen" that a user reloads through), and/or a **race where the deadline anchor is cleared/reset** so it never accumulates.

---

## 4. The exact never-resolves / long-hang races

### RACE A (primary) — GoTrue Navigator-Locks deadlock holds `getSession()` past the race
`supabase.auth.getSession()` (`AuthContext.tsx:285`) runs **inside** `webResilientLock`. With multiple same-origin business tabs (and React StrictMode double-mount of `AuthProvider`), the per-origin Web Lock `lock:sb-gqno…-auth-token` can be orphaned. The clamp (`WEB_LOCK_ACQUIRE_TIMEOUT_MS = 2300`) is meant to steal it before the 3s bootstrap timeout, but the steal/heal itself is racy: if the acquire does not time out cleanly (lock held but not orphaned, microtask starvation under a render loop, or the steal rejection is not classified as `isAcquireTimeout`), `getSession()` does not resolve. Then:
- The 3s `timeoutPromise` (`:281–283`) is the next line of defense → `setLoading(false)` at `:303`. **But this timer is a microtask-scheduled `setTimeout` and runs in the same JS thread**; under a tight render loop or microtask starvation from the lock subsystem it can be delayed.
- The 7s hard ceiling (`:248–263`) is an **independent** `setTimeout` armed in the effect — this is the true backstop. Between t=0 and t≈7s the user sees the spinner. **That visible 3–7s freeze is the symptom.**

### RACE B — `authResolving` lingers after `loading` flips (stale stored-session string)
`loading` flips false (timeout branch, `:303`), but the timeout branch sets `user` from `readStoredWebSession()`; if that returns null while `hasStoredSupabaseWebSession()` (`_layout.tsx:184–198`, looser regex + substring match) returns **true** for a malformed/partial token, then `isWebAuthResolving` stays true (`loading` false, `user` null, `hasStoredWebSession` true) → spinner persists until the 7s UI-gate deadline (`_layout.tsx:670–672`). Note the two readers use **different** acceptance criteria (`AuthContext` requires a usable `access_token`; `_layout` only requires the substring `"access_token"`), so they can disagree — exactly the lingering-spinner case.

### RACE C — listener registered after the event already fired (the "reload reorders it" mechanism)
`onAuthStateChange` (`:429`) is registered **after** `bootstrap()` is invoked (`:427`). supabase-js fires `INITIAL_SESSION` once at client init. Ordering between the synchronous-hydration init, the `getSession()` resolution, and the first `INITIAL_SESSION` emission is **not deterministic** across loads. If the late real session arrives as a passive event after a bootstrap-timeout, it is only honored when `hasUsableBusinessSession(s)` is true and `bootstrapTimedOutRef` is set (`:456–487`); a passive event with no usable session is dropped (`:462–468`). A different interleaving on the next load lets the success branch (`:306–424`) win cleanly. This is the classic "reload resolves the listener/getSession race differently" mechanism.

### RACE D — awaited probe/account work between getSession and `setLoading(false)`
On the success path the `setLoading(false)` is the **last** statement at `:424`, AFTER an awaited `getUser()` probe (`:349`), `ensureCreatorAccount` (`:395`), and `tryRecoverAccountIfDeleted` (`:404`). If `getUser()` hangs (network stall, the same lock), `loading` stays true until the 7s ceiling. The probe has **no per-call timeout** of its own — only the outer 7s ceiling bounds it.

---

## 5. Why a reload recovers it (the ORCH-1204 mechanism)

On the freezing load, `readStoredWebSession()` returned null (or the lock blocked `getSession()`), so `loading` started/stayed true and the spinner showed. By the time the user reloads:
- The async `bootstrap()` from the previous load (and/or supabase-js token refresh) has **written a fresh, valid `sb-gqno…-auth-token` to localStorage**.
- On the reload, the **synchronous** initializer `readStoredWebSession()` (`AuthContext.tsx:199–202`) now finds a usable session → `loading` initializes **false** and `user` is set on the **first paint** → `isWebAuthResolving` is false → **no spinner, app renders immediately**, before `getSession()` / the lock / the listener even matter.
- Additionally, a reload tears down any orphaned Web Lock holder and re-runs the lock steal/heal from a clean state, and re-orders the getSession/listener interleaving (Race C) so it resolves cleanly.

In short: **the freeze is the cold path where first-paint hydration finds no usable session and the async session-resolve is blocked/slow; the reload hits the warm path where first-paint hydration finds the now-persisted session and skips the async gate entirely.**

---

## 6. Web vs native delta

- Native: splash (`preventAutoHideAsync`/`hideAsync`) is real and gates boot; `loading` resolves through the normal in-process `processLock` (no `lock` option set, `supabase.ts`); no Web Locks, so Race A cannot occur. `authResolving` is hard-false on native (`coldLoadAuthGates.ts:343`).
- Web: no splash; the **Web Locks API** is wired in (`lock: webResilientLock`), introducing the orphaned-lock deadlock class that does not exist on native. The synchronous-hydration init (`readStoredWebSession`, web-only) is the web's substitute for the splash gate and is the lever that makes reload recover.

The web path is the one with the extra failure surface (lock + dual stored-session readers with mismatched acceptance), and it lacks an *independent* per-`getSession()` / per-`getUser()` timeout — it relies on a single 7s ceiling.

---

## TOP CANDIDATE (single most likely never/long-resolves gate)

**`loading` (AuthContext) held true by a GoTrue Web-Locks deadlock on the `getSession()` call inside `webResilientLock`, surfaced as `AuthResolvingScreen` / index boot spinner — Race A, with the lingering-`authResolving` Race B as the secondary tail.**

- Boot gate that hangs: `loading` from `useAuth()` → `isWebAuthResolving` → `AuthResolvingScreen` (`mingla-business/app/_layout.tsx:335–340, 678–680`) and the index spinner (`mingla-business/app/index.tsx:79–85`).
- Exact race: `supabase.auth.getSession()` (`AuthContext.tsx:285`) runs inside `webResilientLock` (`supabase.ts`); an orphaned/contended per-origin Web Lock (`lock:sb-gqno…-auth-token`, multi-tab + StrictMode remount) blocks it; the 2.3s lock clamp and 3s bootstrap timeout can themselves be starved under the render loop, so `loading` stays true for the full visible window until the **independent 7s hard ceiling** (`AuthContext.tsx:248–263`) force-releases it. Secondary tail: `loading` flips but `authResolving` lingers because `hasStoredSupabaseWebSession()` (`_layout.tsx:184–198`, looser regex) sees a stale `access_token` string the stricter `readStoredWebSession` (`AuthContext.tsx:101–111`) rejects — spinner persists until the 7s UI-gate deadline (`_layout.tsx:670–672`).
- Why reload fixes it: ORCH-1204 synchronous hydration (`AuthContext.tsx:199–202`) — on the reload, a now-persisted valid `sb-…-auth-token` makes `loading` initialize **false** and `user` non-null at first paint, skipping the blocked async gate entirely; the reload also clears the orphaned lock and re-orders the getSession/listener race.

**Note for the SPEC phase:** the spinner is technically *bounded* at ~7s by the hard ceiling, so the user-visible "freeze" is the 3–7s window (a real freeze that prompts a reload). If users report a *truly indefinite* (>10s) freeze, the next suspect is the deadline anchor being reset — but the anchors are module-level and only cleared on a real user appearing (`_layout.tsx:417–419`, `index.tsx:58–60`), so a permanent hang would require `loading`/`authResolving` to flicker in a way that resets `mounted`/never lets the ceiling effect run; that should be confirmed with a live repro (multi-tab cold load with throttled network) before specing a fix. The highest-leverage hardening targets are: (a) an independent per-`getSession()`/`getUser()` timeout shorter than 7s, and (b) unifying the two stored-session readers so Race B cannot linger.
