# INVESTIGATION — ORCH-1400 [ios-app-splash-freeze-on-invite-signin]

**Mode:** INVESTIGATE (native iOS, source-level + repro attempt). NO fixes proposed.
**Dispatched by:** mingla-orchestrator (conductor). **Surface:** `mingla-business`, iOS STORE build 1.1.2.
**Author:** mingla-forensics. **Date:** 2026-07-18. **Status:** root cause **SUSPECTED** (source-proven vulnerability; exact trigger needs Seth's device logs).

> Read-only investigation against the anchor. No commits, no product-code edits, no git mutations.
> Read-only `git log`/`git show`/`git diff` were used ONLY to reconstruct what the 1.1.2 store build
> shipped (the dispatch explicitly asked to check the store build's gate) — no branch/commit/reset.

---

## 1. Symptom (expected vs actual)

- **Reported:** rambleawaypod@gmail.com already signed in (persisted session). Seth opened the biz app
  manually (not via deep link). He went to sign in and entered `support@usemingla.com` via EMAIL
  sign-in (a SECOND account over the existing session). The app **froze on the "splash" screen** —
  it never reached the main UI. Happened **once**, not confirmed reproducible.
- **Expected:** the sign-in completes and the app lands on Home (or shows an error and returns to the
  code field).
- **Actual:** a full-screen branded loading screen stayed up indefinitely.

**Critical disambiguation (evidence-driven):** there are TWO "splash-like" surfaces in this app, and
they are NOT the same screen:
1. The **native launch splash** — ORANGE background / WHITE Mingla logo (ORCH-1011, `cce8c85fc`),
   shown by `expo-splash-screen` at cold launch only.
2. The **branded in-app loading screens** — WARM/cream gradient + orange spinner + Mingla logo. Two
   of these exist: `app/index.tsx`'s boot spinner (`#fff9f5`) and, crucially, the
   **BusinessWelcomeScreen `otp-verifying` "Signing you in…" screen**.

The evidence below shows the frozen surface was almost certainly **#2 — the "Signing you in…"
screen** — not the native launch splash, because the native splash-hide gate is provably bounded in
1.1.2 and cannot hang. A user would reasonably call the branded "Signing you in…" loader "the splash."

---

## 2. Investigation manifest (files read, in trace order)

| File | Layer | Why |
|------|-------|-----|
| `mingla-business/app/_layout.tsx` | root layout | splash gating (`preventAutoHideAsync`/`hideAsync`), `loading`+`brandReady` gate |
| `mingla-business/src/context/AuthContext.tsx` | auth bootstrap | `loading` lifecycle, session-swap events, native lock behavior, verifyEmailOtp |
| `mingla-business/app/index.tsx` | route | what renders during `loading` on native |
| `mingla-business/app/auth/index.tsx` | route | `/auth` redirect-when-authed behavior |
| `mingla-business/src/services/supabase.ts` | client | native vs web auth-lock config |
| `mingla-business/src/hooks/useCurrentBrandRecovery.ts` | hook | `brandReady`/`brandRecoveryResolving` inputs |
| `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` | component | email/OTP submit UI + `otp-verifying` mode (the frozen surface) |
| `mingla-business/src/services/oneSignalService.ts` | native svc | identity re-bind on swap (login-without-logout) |
| `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js` + `lib/locks.js` | library | native `lockNoOp` + `_acquireLock` in-memory queue (no acquire timeout) |
| git history of `AuthContext.tsx` | provenance | exactly what shipped in 1.1.2 vs HEAD |

---

## 3. What the 1.1.2 STORE build actually contains (provenance)

`AuthContext.tsx` changed at `12ff89a79` (ORCH-1294, 2026-07-03) and then NOT AGAIN until
`26cd280bb` (ORCH-1373 batch, 2026-07-18). The 1.1.2 version bump was `73aba0381` (2026-07-14). The
iOS 1.1.2 build was cut between 07-14 and 07-18, so **it ships the `12ff89a79` AuthContext**.

`git diff 12ff89a79 HEAD` on `AuthContext.tsx` = **ONLY the ORCH-1377 work** (the
`bootstrapResolvedRef` guard + constant rename). Therefore the 1.1.2 store build **already has**:
- **ORCH-1294** — `setLoading(false)` fires on the LOCAL `getSession()` read, BEFORE the un-timed
  network chain (`AuthContext.tsx:454-455`). So `loading` releases fast.
- **ORCH-1292** — the 7s loading-gate release backstop is armed on **native** (`AuthContext.tsx:334`).
- **ORCH-1254** — onAuthStateChange Supabase side-effects deferred out of the auth lock via `setTimeout(0)`.

It **lacks only ORCH-1377** (the `bootstrapResolvedRef` guard on the 7s backstop).

**Consequence for the hypothesis:** because 1.1.2 already fast-releases `loading` and has the native
7s backstop, and `brandReady` has its own 2s backstop, **the native splash-hide gate is bounded and
cannot hang.** The dispatch's primary hypothesis (readiness gate never re-satisfies / bootstrap
deadlocks leaving the NATIVE splash up) is **REFUTED for the 1.1.2 build** (see F-4).

---

## 4. Q-scorecard

- **Q1 — Can a session swap re-raise `loading` and re-show the native splash?**
  **Verdict:** No (refuted). `loading` is monotonic true→false: it is set `true` only at initial
  `useState` (`AuthContext.tsx:249`) and `onAuthStateChange` only ever calls `setLoading(false)`
  (`:852`). The native splash also cannot re-appear after `hideAsync()` (`expo-splash-screen` has no
  re-show API). See F-4. Confidence: proven (source).

- **Q2 — Can the native splash-hide gate hang on a cold launch in 1.1.2?**
  **Verdict:** No (refuted). Gate = `loading===false && brandReady` (`_layout.tsx:291-303`). `loading`
  released fast (ORCH-1294) with a 7s native backstop (ORCH-1292); `brandReady` has a 2s backstop
  (`brandFetchTimedOut`, `_layout.tsx:276-289`). See F-4. Confidence: proven (source).

- **Q3 — Is there a full-screen branded loader with NO timeout that a swap can leave stuck?**
  **Verdict:** YES. BusinessWelcomeScreen `otp-verifying` mode ("Signing you in…", logo + orange
  spinner) has no timeout and, on verifyOtp SUCCESS, is dismissed ONLY by `user` flipping + a route
  redirect. See F-1. Confidence: proven (source) that the surface is un-timed; the trigger is F-2.

- **Q4 — Is there an un-bounded native auth-lock path that makes `verifyOtp` hang forever,
  specifically worse during a swap over an active session?**
  **Verdict:** YES. Native uses auth-js `lockNoOp` (no `navigator.locks`, `supabase.ts:125` omits the
  bounded web lock); `_acquireLock` serializes every auth op behind an in-memory `pendingInLock`
  queue with NO acquire timeout; `verifyOtp` has no `withTimeout`. An active session runs a background
  `autoRefreshToken` loop that competes for the lock — absent for a logged-out user. See F-2.
  Confidence: suspected→probable (source-proven vulnerability; the stalled-fetch trigger needs logs).

- **Q5 — Does the 1.1.2-only missing ORCH-1377 guard cause the freeze?**
  **Verdict:** No, but it is a real latent bug shipped in 1.1.2 (drops a late passive event carrying an
  unusable session → "authed shell under a dead token"). It corrupts session/user state, not the
  splash/loading gate. See D-1. Confidence: proven (source) as a bug; ruled out as THE freeze.

---

## 5. Findings (ranked hang candidates)

### F-1 — PRIMARY (most likely the frozen surface Seth saw): `otp-verifying` "Signing you in…" screen has NO timeout and depends entirely on a post-swap redirect to dismiss

- **Symptom:** a full-screen branded loader (Mingla logo + "Signing you in…" + orange spinner on the
  warm gradient) that never advances to Home. Visually reads as "the splash."
- **Layer:** code (component).
- **Probe/Evidence:**
  - `BusinessWelcomeScreen.tsx:387-409` — `handleVerifyCode` sets `setMode("otp-verifying")` (`:392`)
    then `await onVerifyEmailOtp(...)`. On **success** it does **nothing** to leave the mode — the
    comment at `:400-403` says it relies on "AuthContext SIGNED_IN listener … Index gate redirects to
    /(tabs)/home automatically." The `finally` (`:404-406`) only resets `submittingOtp`, NOT `mode`.
  - `BusinessWelcomeScreen.tsx:849-853` — `mode === "otp-verifying"` renders
    `<View style={verifyingWrapper}><ActivityIndicator size="large" color={colors.primary[500]} /></View>`
    inside the same `LinearGradient` (`:466-467`, warm gradient) + `SafeAreaView`, with the Mingla logo
    still visible and heading "Signing you in…" (`:565-569`). No timeout, no deadline, no error escape
    on the success path.
- **Mechanism:** if verifyOtp never resolves (F-2) OR the post-success redirect never fires, `mode`
  stays `"otp-verifying"` forever → the branded loader is permanently stuck. There is NO analog of
  `app/index.tsx`'s web-only `bootDeadlineExpired` escape here, and none on native at all.
- **Severity:** **CONFIRMED ROOT CAUSE (of the stuck surface).** The trigger that keeps it stuck is F-2.

### F-2 — PRIMARY (the trigger): native auth lock is un-bounded; `verifyOtp` can hang forever, worse during a swap over an active session

- **Symptom:** `onVerifyEmailOtp` (→ `supabase.auth.verifyOtp`) never resolves → F-1 stays stuck.
- **Layer:** code (service) + library.
- **Probe/Evidence:**
  - `src/services/supabase.ts:113-127` — on **native**, `lock` is deliberately omitted
    (`...(Platform.OS === "web" ? { lock: webResilientLock } : {})`, `:125`). The bounded, self-healing
    lock (`webResilientLock`, 2300ms, `:74-111`) is **WEB ONLY**. Native keeps the auth-js default.
  - `@supabase/auth-js/.../GoTrueClient.js:126,133-139` — the default lock is chosen as: custom
    `settings.lock` → else `navigatorLock` **iff** `isBrowser() && navigator.locks` → else `lockNoOp`.
    React Native has no `navigator.locks`, so native resolves to **`lockNoOp`** (`:28-30`:
    `async function lockNoOp(name, acquireTimeout, fn) { return await fn(); }` — **`acquireTimeout` is
    ignored**; there is no `ProcessLockAcquireTimeoutError` path because `processLock` is not used).
  - `@supabase/auth-js/.../GoTrueClient.js:2229-2280` — `_acquireLock` serializes EVERY auth op through
    an in-memory queue regardless of lock impl: `if (this.lockAcquired) { … await last; return await
    fn(); }`. If the in-flight holder never resolves, `lockAcquired` stays `true` forever and every
    subsequent op (`getSession`, `verifyOtp`, `getUser`) chains `await last` and hangs **with no
    timeout**.
  - `AuthContext.tsx:1178` — `supabase.auth.verifyOtp({...})` has **no `withTimeout` wrapper**, unlike
    the sibling boot probe `await withTimeout(supabase.auth.getUser(), AUTH_PROBE_TIMEOUT_MS, …)`
    (`:494`). The team bounds getUser but left verifyOtp unbounded.
  - `supabase.ts:116` — `autoRefreshToken: true`. supabase-js runs a background auto-refresh ticker
    while a session exists and the app is active; each tick calls `_acquireLock`.
- **Mechanism:** during a SECOND-account sign-in the rambleawaypod session is still active, so the
  background auto-refresh loop is live and periodically holds the lock. If an auto-refresh (or any
  in-flight auth fetch — GoTrue fetches have no network timeout) STALLS on a flaky/slow connection,
  `lockAcquired` stays true; the `verifyOtp` Seth submits queues behind it via `await last` and never
  resolves → F-1 hangs. A logged-out user has NO active session → NO auto-refresh loop → the lock is
  idle at sign-in, which is why a first-time sign-in does not exhibit this and why the swap is
  race-timing dependent ("happened once").
- **Severity:** **CONFIRMED ROOT CAUSE (architectural vulnerability).** The specific stalled fetch is
  **SUSPECTED** and only device logs can confirm which op stalled.

### F-3 — SECONDARY (alt native-splash path, needs logs): native-module identity re-bind on a swap without a preceding `SIGNED_OUT`

- **Symptom:** if instead the TRUE native orange splash was stuck, that requires a native-thread block
  or crash-relaunch loop (JS timeout backstops cannot rescue a dead JS thread / a crash).
- **Layer:** code (native services) + runtime.
- **Probe/Evidence:**
  - A session SWAP fires SIGNED_IN with **no** preceding SIGNED_OUT, so the analytics/identity services
    are NOT reset between accounts. On SIGNED_IN (`AuthContext.tsx:751-757`) and on warm-restore
    bootstrap (`:565-575`), `loginToOneSignal`, `revenueCatService.identify`, `setAppsFlyerUserId`,
    `registerAppsFlyerDevice`, mixpanel/posthog identify all fire for the NEW user while the SDKs are
    still logged in as the OLD user.
  - `oneSignalService.ts:100-113` — `loginToOneSignal` calls `OneSignal.login(userId)` (native bridge)
    login-while-logged-in-as-another, without a `logout()` first.
- **Mechanism:** a native module deadlocking the JS thread or crashing during the re-bind, then
  crash-relaunching into the same boot bind, would appear as a frozen ORANGE native splash. This is
  **the only mechanism that leaves the true native launch splash up**, but it is NOT provable from
  source.
- **Severity:** **SUSPECTED CONTRIBUTOR.** Lower likelihood than F-1/F-2; requires device logs.

### F-4 — RULED OUT: native splash-hide readiness gate deadlock (the dispatch's primary hypothesis) — for the 1.1.2 build

- **Symptom (hypothesized):** `SplashScreen.hideAsync()` never called because `loading`/`brandReady`
  never satisfy.
- **Layer:** code.
- **Probe/Evidence:**
  - `_layout.tsx:291-303` — hide gate `if (loading || !brandReady || splashHidden) return;`.
  - `loading` is monotonic (set true only at `AuthContext.tsx:249`; `onAuthStateChange` only ever
    `setLoading(false)` at `:852`), released fast on the local getSession read (`:454-455`, ORCH-1294),
    with a native 7s backstop (`:334`, ORCH-1292 — present in 1.1.2 per §3).
  - `brandReady` (`_layout.tsx:285-289`) has a 2s `brandFetchTimedOut` backstop (`:276-283`).
  - `expo-splash-screen` cannot re-show the native splash after `hideAsync()`.
- **Mechanism:** all three inputs are bounded, so the native splash hides reliably; a session swap
  cannot re-raise it.
- **Severity:** **RULED OUT** (for 1.1.2). Confidence: proven (source).

---

## 6. Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-1294/1292/1254 comments assert `loading` and the splash gate are bounded on native. TRUE for 1.1.2. |
| **Schema** | N/A (no DB involvement in the hang path). |
| **Code** | Native auth lock is UN-bounded (`lockNoOp`, `supabase.ts:125`); `verifyOtp` and the `otp-verifying` screen are UN-timed. **This is the gap.** |
| **Runtime** | Not observed live (no repro; see §7). The hang requires a stalled in-flight auth fetch — a runtime/network condition. |
| **Data** | A swap leaves `currentBrandStore` holding the prior account's brand id (no SIGNED_OUT to clear it) — see D-2. |

**Flagged contradiction:** the code comments treat "native already resolves; the splash covers native
boot" as a settled invariant, but that reasoning covers only the LAUNCH splash / `loading` gate — it
does NOT cover the post-boot `otp-verifying` loader, which is un-timed and rides the un-bounded native
lock. The invariant's scope is narrower than the comments imply.

---

## 7. Repro evidence (Track 2 — simulator)

**Not run to completion. Honest negative-capable outcome.**
- Environment probe: NO booted iOS simulator, NO `mingla-business` dev build installed on any sim, NO
  Metro on :8081. Maestro is present but there is nothing to drive.
- Building a fresh iOS dev build via `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` is a heavy operation and, more
  importantly, **cannot reproduce this bug**: the root cause (F-2) is a release-timing race on a
  STALLED network fetch holding the native auth lock while an auto-refresh competes — a dev build with
  fast local Metro and a healthy network will not stall the lock, and the event "happened once."
- Per the dispatch ("if you cannot build/run iOS in this environment, say so and deliver Tracks 1 + 3
  fully — they are the higher-value parts anyway"), Track 2 is deferred with this reasoning. The F-1/F-2
  vulnerability is fully source-proven; the missing piece (which fetch stalled) is a **device-log**
  question, not a sim question.

If a sim repro is still wanted later, the deterministic way to force it is to inject a hang into the
auth lock (e.g., temporarily make an auto-refresh/getSession fetch never resolve while submitting an
OTP) — i.e., simulate the stall rather than hope to catch the race. Mark any such instrumentation
`[ORCH-1400-DIAG]` and reap it.

---

## 8. Track 3 — Device-log capture plan for Seth (the single most useful next step)

The 1.1.2 store build is not breakpoint-debuggable, but its `console.*`/`NSLog`/`os_log` output IS
capturable, and **`console.*` is NOT stripped in this build** (no `transform-remove-console` in
`package.json`), so un-`__DEV__`-gated warns reach the device log. Relevant un-gated lines to watch
for: `[auth] loading-gate-backstop …` (`AuthContext.tsx:349`), `[auth] boot-session-probe: …`
(`:501/:534`), `[OneSignal] login failed:` (`oneSignalService.ts:113`), `[auth] getSession …` (`:414`).
(Note: many `[auth] auth-event`/`bootstrap-*` info lines are `__DEV__`-gated and will NOT appear.)

**Fastest path — macOS Console.app (no Xcode project needed):**
1. Connect the iPhone via USB, unlock it, tap **Trust**.
2. Open **Console.app** (Applications → Utilities). In the left sidebar select the iPhone under
   **Devices**.
3. Click **Start** (streaming). In the search bar filter by process — type `Mingla` or the bundle
   name — and optionally add `auth` or `OneSignal` to the filter.
4. On the phone: reproduce — be signed in as account A, then WITHOUT signing out, go to sign in and
   submit a DIFFERENT email (account B), and let it hang.
5. When it freezes on "Signing you in…", **immediately** in Console.app hit **Pause**, then
   **Save** (⌘S) the visible log (or Edit → Select All → Copy). Send it to this investigation.

**Alternative — `idevicesyslog` (libimobiledevice, terminal):**
1. `brew install libimobiledevice` (if not present).
2. `idevicesyslog -u <UDID> | tee ~/Desktop/orch1400-devicelog.txt` (get `<UDID>` from
   `idevice_id -l` or Finder). Reproduce as above; the file captures everything.

**Alternative — Xcode → Window → Devices and Simulators → select device → Open Console.** Same stream,
inside Xcode.

**What to look for in the capture (this is what discriminates F-1/F-2 vs F-3):**
- If the log **goes quiet** right after the OTP submit and stays quiet (no crash, no further auth
  lines) → consistent with **F-1/F-2** (a hung auth-lock/verifyOtp; the JS thread is alive but blocked
  awaiting the lock).
- If you see a **crash report / `SIGABRT` / native stack** (OneSignal/RevenueCat/AppsFlyer frames) or
  a repeating boot sequence → consistent with **F-3** (native crash-relaunch loop on the true splash).
- Capture the **~30s BEFORE** the freeze too — a `[auth] boot-session-probe` or auto-refresh line that
  starts and never completes points squarely at F-2's stalled-holder.

---

## 9. Blast radius / cross-surface

- **In scope:** Business iOS native (email-OTP sign-in over an active session). The same un-bounded
  native lock + un-timed verifyOtp pattern exists on **Business Android** (identical `supabase.ts`
  gate). Worth checking the **consumer app** (`app-mobile/`) for the same native-lock omission +
  un-timed OTP verify — likely a shared class.
- **Out of scope:** Buyer/anonymous web and Business web preview (web has the bounded `webResilientLock`
  and the `bootDeadlineExpired`/`authResolutionExpired` escapes — the prior web pass already covered
  ORCH-1404 and the wrong-account dead-end).

---

## 10. Discoveries for orchestrator (side issues — register, do not fix here)

- **D-1 (latent, shipped in 1.1.2):** the missing ORCH-1377 `bootstrapResolvedRef` guard means the 7s
  backstop fires on EVERY boot where the app stays open ~7.5s, arming `bootstrapTimedOutRef` on a
  healthy boot. On a subsequent PASSIVE auth event carrying an UNUSABLE session it is dropped
  (`AuthContext.tsx:609-622`) → "authed shell under a dead token." Fixed on main by ORCH-1377 but
  **only reaches users via a NATIVE rebuild** (not OTA-eligible if native-affecting; confirm). Not the
  splash freeze.
- **D-2 (data integrity):** a second-account sign-in fires no SIGNED_OUT, so `currentBrandStore` keeps
  the PRIOR account's brand id under the NEW session → wrong-brand / degraded Home after a successful
  swap. Independent of the freeze; should be specced (clear stores / re-resolve brand on a user-id
  change, not only on SIGNED_OUT).
- **D-3 (identity hygiene):** OneSignal/RevenueCat/AppsFlyer are re-`login()`'d for the new user
  without a `logout()` of the old on a swap (F-3). Even if not the crash cause, it mis-attributes the
  device to the wrong user until the next explicit signOut.

---

## 11. Recommended fix DIRECTION (NOT an implementation — for the SPEC phase)

Ordered by leverage; a SPEC should decide the exact shape:
1. **Bound the native auth lock** — give native the same self-healing treatment web has: provide a
   `lock` on native that clamps the acquire wait (mirror `webResilientLock`) so a stalled holder can
   never block queued auth ops indefinitely. This closes the root vulnerability (F-2) at the library
   boundary.
2. **Time-bound `verifyOtp`** — wrap `supabase.auth.verifyOtp` in `withTimeout` (the codebase already
   has the helper and uses it for the getUser probe) so a hung verify rejects instead of hanging.
3. **Give the `otp-verifying` screen a deadline/escape** — a timeout that returns the user to the code
   field with a retry message (parity with the web `bootDeadlineExpired` philosophy: never an infinite
   spinner), so even an un-anticipated stall can't strand the user (F-1).
4. **Separately:** address D-2 (clear/re-resolve brand on user-id change) and consider D-3
   (logout-before-login on identity services for a swap).

Any one of (1)/(2)/(3) breaks the freeze; (1) is the deepest and also protects `getSession`/`getUser`;
(3) is the last-line UX guarantee.

---

## 12. Confidence + honest gaps

- **Confidence:** root cause **SUSPECTED (leaning probable).** The VULNERABILITY (un-bounded native
  auth lock + un-timed verifyOtp + un-timed `otp-verifying` screen, made worse by the swap's active
  auto-refresh loop) is **proven from source**. What is NOT proven without device logs: (a) that this
  path (F-1/F-2) — rather than a native crash-loop (F-3) — is what fired on Seth's single occurrence,
  and (b) which specific in-flight auth fetch stalled.
- **Root cause cannot be fully sealed without Seth's device logs.** That is the honest state, and
  §8 is the plan to get them. The source-level fix DIRECTION (§11) does not depend on the logs — items
  (1)-(3) are correct hardening regardless of which candidate fired.
