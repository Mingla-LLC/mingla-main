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
 * WHY `Clock_Tick` AND NOT `Segment_Tick`?
 * `Segment_Tick` is the semantically perfect constant ("the user is switching between a
 * series of potential choices"), but `HapticFeedbackConstants.SEGMENT_TICK` is **API 34+**.
 * `HapticsRecord.kt#toHapticFeedbackType()` resolves constants by REFLECTION and, on a
 * `NoSuchFieldException`, falls back to a hard-coded list of five constants that exist on
 * every API level — `CLOCK_TICK`, `CONTEXT_CLICK`, `KEYBOARD_TAP`, `LONG_PRESS`,
 * `VIRTUAL_KEY`. `SEGMENT_TICK` is NOT in that list, so on anything below API 34 it
 * **throws `HapticsNotSupportedException`** — including the Samsung SM-A725F (Android 13 /
 * API 33) that #1638 was filed against. `Clock_Tick` is in the guaranteed set, is a short
 * crisp tick rather than a buzz, and is Android's idiomatic "discrete selection changed"
 * feedback — the closest analogue of iOS's selection/impact acknowledgement.
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
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => {});
      return;
    }
    // web / any other platform: no haptics engine worth invoking. Silence is correct.
  } catch {
    // Defensive: a synchronous throw from the native bridge must never reach the
    // Pressable's onPress and break navigation. Constitution #3 does not apply —
    // there is nothing actionable to surface to a user for a missing haptic motor.
  }
}
