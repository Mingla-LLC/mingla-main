/**
 * Issue #1638 — tab-switch tactile acknowledgement, per platform.
 *
 * BEFORE: `GlassBottomNav` fired `Haptics.impactAsync(Medium)` behind a bare
 * `Platform.OS === 'ios'` check, so ANDROID GOT NOTHING. On the platform where the
 * destination-screen wait is longest (#1638 investigation, F-2/F-3) the app was also
 * completely silent to the touch — only the spotlight pill moved. Same delay, worse
 * feel, for a reason that has nothing to do with speed.
 *
 * WHY NOT JUST DROP THE `Platform.OS === 'ios'` GUARD?
 * Because `impactAsync` is the WRONG API on Android, and expo's own JSDoc says so
 * (node_modules/expo-haptics/src/Haptics.ts):
 *
 *   "Android's `Vibrator` API is not recommended for implementing haptics feedback.
 *    Instead, you should use `performAndroidHapticsAsync`, which is similar to iOS
 *    haptic feedback and does not require `VIBRATE` permission."
 *
 * Verified against the installed native module (expo-haptics 15.0.8,
 * android/src/main/java/expo/modules/haptics/HapticsModule.kt):
 *   - `impactAsync('medium')` → `Vibrator.vibrate(createWaveform([0,43],[0,50]))`, a
 *     43ms motor buzz. It needs `android.permission.VIBRATE` — which this app does NOT
 *     declare in `app.json` → `expo.android.permissions` — and it reads as a
 *     notification, not as an acknowledgement, when fired on every tab tap.
 *   - `performAndroidHapticsAsync(type)` → `View.performHapticFeedback(constant)`, the
 *     platform-native path. No permission required, and `performHapticFeedback` honours
 *     the system "Touch feedback" setting, so a user who has turned haptics OFF gets
 *     silence for free — no preference plumbing of our own.
 *
 * WHY `Context_Click`? (CORRECTED 2026-08-06 BY DEVICE TEST — the original
 * reasoning below was based on a wrong premise and produced a silent haptic.)
 *
 * The first implementation chose `Clock_Tick` to avoid `Segment_Tick`, which is
 * API 34+ and would throw on an API 33 device. That reasoning was sound but the
 * premise was not checked: the SM-A725F this issue was filed against runs
 * **Android 14 / API 34**, not 33. `Segment_Tick` fires fine on it.
 *
 * More importantly, `Clock_Tick` was IMPERCEPTIBLE on that device. Verified on
 * hardware by firing every constant in the guaranteed set 1.5s apart and having
 * the operator report what he could feel:
 *
 *   Clock_Tick    -> resolved OK, FELT NOTHING
 *   Keyboard_Tap  -> resolved OK, FELT NOTHING
 *   Context_Click -> resolved OK, FELT IT              <- chosen
 *
 * Note every one of those RESOLVED SUCCESSFULLY. Android accepts the request and
 * silently does nothing if the constant is too weak for the device's motor, so a
 * green promise proves the call was made, NOT that the user felt anything. This
 * is only decidable on hardware by a human.
 *
 * `Context_Click` is in the five-constant set `HapticsRecord.kt` guarantees on
 * every API level (CLOCK_TICK, CONTEXT_CLICK, KEYBOARD_TAP, LONG_PRESS,
 * VIRTUAL_KEY), so it is safe on API 33 devices too — we keep the original
 * safety property while fixing the perceptibility.
 *
 * NEVER THROWS. `performAndroidHapticsAsync` does not `await` the native call
 * (see expo-haptics/src/Haptics.ts), so a native rejection would otherwise surface as an
 * unhandled rejection. Every call site here is `.catch(() => {})`-terminated, and a
 * synchronous throw (e.g. an older binary whose native module has no `performHapticsAsync`)
 * rejects the async function's own promise and is caught by the same handler.
 *
 * OTA-SAFE: pure JS over an API that already exists in the installed native module
 * (expo-haptics >= 14 / SDK 52; this app is pinned to SDK 54). No native rebuild needed.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Fire the tactile acknowledgement for a bottom-nav tab switch.
 *
 * Fire-and-forget by contract: returns `void`, never rejects, never throws. Callers must
 * not await it — the whole point is that the acknowledgement does not sit on the tap frame.
 */
export function triggerTabSwitchHaptic(): void {
  try {
    if (Platform.OS === 'ios') {
      // Unchanged from the pre-#1638 behaviour — iOS already felt right.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      return;
    }
    if (Platform.OS === 'android') {
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
      return;
    }
    // web / any other platform: no haptics engine worth invoking. Silence is correct.
  } catch {
    // Defensive: a synchronous throw from the native bridge must never reach the
    // Pressable's onPress and break navigation. Constitution #3 does not apply —
    // there is nothing actionable to surface to a user for a missing haptic motor.
  }
}
