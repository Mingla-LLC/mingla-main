# Forensic Investigation: Build 3 SIGABRT Crash (2026-03-30)

## This is a DIFFERENT crash than builds 1-2

| | Build 2 crashes | Build 3 crash |
|---|---|---|
| Build | 1.0.0 (2) | **1.0.0 (3)** |
| Time after launch | T+16.5s / T+21min | **T+8.5s** |
| Crashing thread | Thread 18/22 | **Thread 5** |
| Thread count | 23 threads | **24 threads** (MapLibre loaded) |
| Key stack frame | `performVoidMethodInvocation` (RCTTurboModule.mm:441) | **Unsymbolicated Mingla binary frames** |
| React framework? | YES — React.framework in stack | **NO — only Mingla binary + system libs** |
| `Last Exception Backtrace` | Not present | **Present** (frames 0-14) |

## What the Crash Log Proves

### Hard facts

1. **Build 3 is confirmed** — `Version: 1.0.0 (3)`, different binary UUID (`37e96aec` vs old `b59d7a06`), different install path.

2. **NSException raised inside Mingla binary** — The `Last Exception Backtrace` shows:
   ```
   Frame 0: __exceptionPreprocess (CoreFoundation)
   Frame 1: objc_exception_throw (libobjc)
   Frame 2: -[NSException raise] (CoreFoundation)
   Frame 3: Mingla 0x1044ea630 (+501296)  ← THROWS the exception
   Frame 4: Mingla 0x1044e9428 (+496680)  ← calls frame 3
   Frame 5: Mingla 0x1044e91e8 (+496104)  ← calls frame 4
   Frame 6: Mingla 0x1044b785c (+292956)  ← dispatch entry point
   Frame 7-14: libdispatch (GCD serial queue drain)
   ```

3. **The exception originates in the Mingla binary** — NOT in React.framework, NOT in OneSignal, NOT in any other framework. The frames at +292K, +496K, +501K are all within the Mingla executable (`0x104470000 - 0x105453fff`, 15.9 MB).

4. **These frames are unsymbolicated** — The crash log shows raw offsets (`0x104470000 + 501296`) instead of function names. This means the dSYM (debug symbols) were NOT included or Apple couldn't symbolicate them.

5. **GCD serial queue dispatch** — Frame 6 (+292956) was dispatched onto a serial GCD queue (frames 7-14 are libdispatch serial drain). This means the crashing code was dispatched asynchronously, not called synchronously from JS.

6. **T+8.5s** — Launch at 18:44:17.343, crash at 18:44:25.888. Faster than build 2 crashes (T+16.5s). The animation fix may have moved the crash point earlier.

7. **Not React TurboModule** — The previous crash went through `performVoidMethodInvocation` in `React.framework`. This crash does NOT. The exception originates in `Mingla` binary directly.

### Clustered offsets analysis

| Offset | Hex | Notes |
|--------|-----|-------|
| +292956 | 0x4785C | Dispatch entry — ~293K into binary |
| +496104 | 0x791E8 | Clustered with next two — ~496K |
| +496680 | 0x79428 | 576 bytes from above — same function or adjacent |
| +501296 | 0x7A630 | 4662 bytes from 496680 — raises NSException |

Frames 3-5 (496K-501K) are clustered within ~5K of each other, strongly suggesting they're in the **same ObjC class or closely related functions**. Frame 6 (293K) is the entry point from GCD dispatch.

In an EAS-built Expo app, the first ~500K of the Mingla binary typically contains:
- `AppDelegate.swift` (confirmed at offset +21300 in Thread 0)
- Expo-generated native module registration
- ExpoModulesCore linked code
- Compiled native module implementations from Expo config plugins (OneSignal, AppsFlyer, etc.)

## What I Cannot Determine

**Without the dSYM, I cannot identify which function is crashing.** The offsets are meaningless without symbol mapping. This is the critical blocker.

## How to Get the dSYM

The dSYM was generated during the EAS build. To symbolicate:

**Option 1 — From EAS:**
```bash
cd app-mobile
npx eas build:list --platform ios --limit 1
# Get the build ID, then:
npx eas build:view <build-id>
# Download the dSYM artifact
```

**Option 2 — Upload to Xcode:**
Download the `.ipa` and dSYM from the EAS build artifacts page:
`https://expo.dev/accounts/sethogieva/projects/mingla/builds/7b395c2f-15c2-4df4-83e1-0232a8ed0ccf`

Then drag the crash log into Xcode's Devices & Simulators → View Device Logs. With the dSYM present, Xcode will symbolicate the `Mingla +XXXXX` frames.

**Option 3 — atos command (if you have the dSYM):**
```bash
atos -o Mingla.app.dSYM/Contents/Resources/DWARF/Mingla -arch arm64 -l 0x104470000 0x1044ea630 0x1044e9428 0x1044e91e8 0x1044b785c
```

## What We Can Reason About (Without dSYM)

### The crash is in native code compiled into the app binary

This rules out JS-level issues. The crashing code is ObjC/Swift compiled by EAS into the Mingla binary. Given the onboarding-only reproduction:

**Most likely candidates (based on what native code runs during onboarding):**

1. **Expo Haptics native module** — `Haptics.impactAsync(Medium)` fires on the "Let's go" button (name save). The Expo Haptics module's native implementation is compiled into the Mingla binary by expo-modules-autolinking. If the device doesn't support a feedback type or the AudioToolbox API throws, NSException.

2. **Expo Location native module** — `useOnboardingResume` calls `Location.getForegroundPermissionsAsync()` during loading. Native implementation compiled into Mingla binary.

3. **OneSignal config plugin generated code** — The OneSignal Expo plugin generates native code during `npx expo prebuild`. This code lives in the Mingla binary, not in the OneSignal.framework.

4. **TextInput `.focus()` via deferred setTimeout** — The deferred focus at 400ms (OnboardingFlow.tsx:732-734) calls `firstNameRef.current?.focus()`. On iOS Fabric, `.focus()` dispatches a native `becomeFirstResponder` call. Inside a `scrollEnabled={false}` ScrollView, iOS may still try to scroll-to-visible and throw.

### The T+8.5s timing

- App launch → auth resolution (~1-2s)
- OnboardingLoader → useOnboardingResume async load (~2-6s)
- OnboardingFlow mounts → deferred focus at +400ms (~6.5-8.5s)
- **Total: ~8.5s matches the deferred TextInput.focus() path**

### Why existing users don't crash

You said: "when I sign in with a Google account that already exists, it works fine."

Existing users skip onboarding entirely — `hasCompletedOnboarding` is true, so `OnboardingFlow` never mounts. This confirms the crash is in code that ONLY runs during onboarding.

## Strongest Hypothesis (Without dSYM Proof)

**The deferred `TextInput.focus()` inside a `scrollEnabled={false}` ScrollView.**

Evidence chain:
- T+8.5s matches OnboardingLoader async load + 400ms deferred focus timer
- `focus()` dispatches native `becomeFirstResponder` on a GCD queue (matches the serial queue drain in crash stack)
- `scrollEnabled={false}` on the parent ScrollView (OnboardingShell.tsx:285) can cause iOS to throw when trying to scroll the focused field into view
- The original `autoFocus` was removed for exactly this reason (commit e7c56476 comment: "autoFocus on a TextInput inside a scrollEnabled={false} ScrollView causes a native crash on iOS Fabric")
- The deferred `focus()` at 400ms may still trigger the same native code path — `setTimeout` doesn't change the ScrollView constraint, just delays it

**But this is a hypothesis, not proof.** The unsymbolicated frames prevent confirmation.

## Recommended Next Steps

1. **Get the dSYM and symbolicate** — this is the ONLY way to know for certain. Everything else is inference.

2. **If dSYM confirms TextInput.focus()** — remove the deferred focus entirely. Let the user tap the field instead of auto-focusing. Zero risk.

3. **If dSYM shows something else** — we investigate that specific path.
