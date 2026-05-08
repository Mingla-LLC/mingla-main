# Runtime QA Report: ORCH-0751 RevenueCat Anonymous Logout Guard

> Date: 2026-05-07
> Mode: RUNTIME QA / TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:0 P3:0 P4:3

## 1. Layman Summary

The fresh startup check passed: on Android, Mingla reached the unauthenticated Welcome state and did not show the old startup RevenueCat anonymous logout failure.

The retry found a real remaining bug on explicit sign-out. RevenueCat successfully logged out the identified user, but a second logout attempt immediately followed after RevenueCat had already become anonymous, producing the native RevenueCat error ORCH-0751 was meant to remove.

The good part: sign-in still works and RevenueCat still merges the anonymous user into the signed-in user. The bad part: sign-out still has a duplicate cleanup race.

## 2. Inputs Reviewed

- Runtime prompt: `Mingla_Artifacts/prompts/RUNTIME_QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Static QA: `Mingla_Artifacts/reports/QA_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`
- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0751_REVENUECAT_ANONYMOUS_LOGOUT.md`

## 3. Platform / Device

- Platform tested: Android emulator
- Device: `emulator-5554`
- Package: `com.mingla.app.v2`
- Metro/dev client: app-mobile Metro already running on port `8082`
- Launch method:

```bash
adb reverse tcp:8082 tcp:8082
adb shell pm clear com.mingla.app.v2
adb shell am start -a android.intent.action.VIEW -d 'com.mingla.app.v2://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8082' com.mingla.app.v2
```

## 4. Runtime Gate Results

| Gate | Result | Evidence |
|---|---|---|
| Fresh no-session startup | PASS | App data was cleared with `adb shell pm clear`; logs show `[AUTH] No session — user not authenticated`, `[AUTH] Auth state change: INITIAL_SESSION \| hasSession=false`, and `[NAV] Render: WelcomeScreen (not authenticated)`. |
| No `[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)` | PASS | No matching log line in captured Android logcat window. |
| No `LogOut was called but the current user is anonymous` from Mingla cleanup | PASS | No matching log line in captured Android logcat window. |
| RevenueCat product/offering warning classified separately | PASS / ORCH-0752 | Log shows Play Store offerings configuration error; this is the known product/offering configuration issue and not the anonymous logout bug. |
| Initial sign-in / `loginRevenueCat(user.id)` runtime proof | PASS | Logs show Google sign-in, Supabase `SIGNED_IN`, and RevenueCat `Logging in from $RCAnonymousID... -> eff78416...`, then `Logged in successfully`. |
| Explicit sign-out | FAIL | Logs show `[ACTION] Sign out pressed`, RevenueCat `Logged out successfully`, then RevenueCat native error `Called logOut but the current user is anonymous`. |
| Sign back in after sign-out | NOT RUN | The gate already failed on explicit sign-out; retest after implementation rework. |

## 5. Relevant Log Evidence

Fresh no-session startup:

```text
05-07 18:56:19.981 I/ReactNativeJS: [NAV] Render: AuthLoading screen | hydrated=true, authLoading=true
05-07 18:56:20.289 I/ReactNativeJS: [AUTH] Initializing — fetching session...
05-07 18:56:21.222 D/ReactNativeJS: [RevenueCat] Initial App User ID - null
05-07 18:56:22.877 D/ReactNativeJS: [RevenueCat] Identifying App User ID: $RCAnonymousID:b2601ea50b094943888cf4c2c5dd70ef
05-07 18:56:25.363 I/ReactNativeJS: [AUTH] No session — user not authenticated
05-07 18:56:25.676 I/ReactNativeJS: [NAV] Render: WelcomeScreen (not authenticated)
05-07 18:56:30.235 I/ReactNativeJS: [AUTH] Auth state change: INITIAL_SESSION | hasSession=false, userId=undefined
05-07 18:56:30.775 I/ReactNativeJS: [NAV] Render: WelcomeScreen (not authenticated)
```

No ORCH-0751 failure lines were present in the captured log window:

```text
[AUTH_CLEANUP] RevenueCat logout failed (initial-no-session)    not observed
LogOut was called but the current user is anonymous              not observed
logoutRevenueCatIfIdentified failed                              not observed
```

Separate RevenueCat configuration warning observed:

```text
05-07 18:56:25.079 E/ReactNativeJS: [RevenueCat] Error fetching offerings - PurchasesError(code=ConfigurationError, underlyingErrorMessage=You have configured the SDK with a Play Store API key, but there are no Play Store products registered in the RevenueCat dashboard for your offerings...)
```

Blocked continuation:

```text
Android UI displayed: "Mingla isn't responding"
```

Retry sign-in evidence:

```text
05-07 19:00:17.874 I/ReactNativeJS: [AUTH] Google sign-in started
05-07 19:00:58.687 I/ReactNativeJS: [AUTH] Auth state change: SIGNED_IN | hasSession=true, userId="eff78416-0d36-4bca-b350-10a6c3f046cb"
05-07 19:00:59.270 D/ReactNativeJS: [RevenueCat] Logging in from $RCAnonymousID:b2601ea50b094943888cf4c2c5dd70ef -> eff78416-0d36-4bca-b350-10a6c3f046cb
05-07 19:00:59.570 D/ReactNativeJS: [RevenueCat] Logged in successfully as eff78416-0d36-4bca-b350-10a6c3f046cb. Created: false
```

Retry sign-out failure evidence:

```text
05-07 19:07:01.905 I/ReactNativeJS: [ACTION] Sign out pressed
05-07 19:07:02.449 D/ReactNativeJS: [RevenueCat] Logged out successfully
05-07 19:07:02.453 E/ReactNativeJS: [RevenueCat] Called logOut but the current user is anonymous
05-07 19:07:04.335 I/ReactNativeJS: [AUTH] Auth state change: SIGNED_OUT | hasSession=false, userId=undefined
```

Screenshots captured locally:

- `/tmp/mingla-qa/orch0751-android-startup.png` - bundle loading
- `/tmp/mingla-qa/orch0751-android-after-wait.png` - Welcome screen visible behind Android ANR overlay
- `/tmp/mingla-qa/orch0751-android-after-overlay.png` - post-overlay capture

## 6. Repo Gates Re-Run

From `app-mobile/` with `/opt/homebrew/bin` on PATH:

```bash
npm run test:orch-0751
npm run test:orch-0749
```

Results:

- `test:orch-0751`: PASS, 10/10 checks.
- `test:orch-0749`: PASS, existing auth/cache regression gate remains green.

## 7. Findings

### P1 High

**P1-001: Explicit sign-out still leaks RevenueCat anonymous logout error**
- **Evidence:** On retry, sign-out produced RevenueCat `Logged out successfully` followed immediately by RevenueCat native error `Called logOut but the current user is anonymous`.
- **Impact:** ORCH-0751's core runtime contract is still not met for explicit sign-out. The implementation likely prevents app-level warning spam, but it still allows two RevenueCat logout attempts to race.
- **Required action:** Rework the logout guard so concurrent/duplicate cleanup paths share one in-flight logout or otherwise serialize/short-circuit after the first logout transitions RevenueCat anonymous.
- **Retest:** Sign in, sign out, then sign back in while capturing logs. The retest must show no native RevenueCat anonymous logout error and still show `loginRevenueCat(user.id)` on sign-in.

### P4 Notes

**P4-001: Fresh no-session startup behavior is verified**
- **Evidence:** Cleared app data; logs reached no-session Welcome state; no ORCH-0751 anonymous logout warning appeared.

**P4-002: RevenueCat offerings warning is separate ORCH-0752**
- **Evidence:** Captured `PurchasesError(code=ConfigurationError)` for Play Store products/offering configuration.
- **Impact:** This should not be charged against ORCH-0751.

**P4-003: Earlier Android ANR/dev overlay was cleared enough to continue**
- **Evidence:** Retry reached Home/Profile, sign-out was tapped, and logs captured the relevant RevenueCat behavior.
- **Impact:** The runtime result is no longer blocked; it is a concrete ORCH-0751 failure.

## 8. Recommendation To Orchestrator

Send ORCH-0751 back to implementation.

The likely fix is to make `logoutRevenueCatIfIdentified()` concurrency-safe. Today two cleanup paths can both enter RevenueCat logout during the same sign-out. The first one succeeds and flips RevenueCat anonymous; the second one reaches native RevenueCat just late enough to emit the anonymous logout error.

Required rework:

1. Add an in-flight guard/shared promise around guarded RevenueCat logout.
2. Keep strict `logoutRevenueCat()` strict for any call sites that intentionally need hard failure.
3. Preserve `loginRevenueCat(user.id)` exactly.
4. Extend `test:orch-0751` so it catches duplicate guarded logout call sites or missing in-flight serialization.
5. Retest Android sign-in -> sign-out -> sign-in.

Do not close ORCH-0751 until explicit sign-out no longer emits the native RevenueCat anonymous logout error.
