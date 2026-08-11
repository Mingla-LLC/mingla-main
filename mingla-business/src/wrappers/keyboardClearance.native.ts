// #1890 [keyboard-clearance-overshoot] — the ONE occluder budget, native side.
//
// This app has FOUR independent mechanisms that compensate for the soft
// keyboard, not two: the SmartScrollView wrapper (96 consumers), Ari's
// inputWrap paddingBottom, the raw-<Modal> Paystack bank picker's
// KeyboardAvoidingView, and the group-chat composer. Before this module each
// re-typed its own idea of what the Done bar costs, and they disagreed in
// three different directions at once — an 11pt undershoot here, a 42dp dead
// band there. The terms live here, once, and every surface reads them.
//
// Moved VERBATIM out of SmartScrollView.native.tsx (#1834); the derivation is
// byte-identical, so DEFAULT_BOTTOM_OFFSET is unchanged on every branch
// (78.5 iOS 26+ / 67.5 iOS <26 / 57.16 Android). SmartScrollView.native.tsx
// re-exports all of these, so its public surface is unchanged too — #1834's
// two suites read those names off that module and must keep passing untouched.
//
// Measurement space note (#1834 AMENDMENT 3): every figure here is SCREEN
// space. On Android `measureInWindow` is window-relative and the app window
// starts 30.58dp below the screen origin, so comparing it directly against
// `keyboardDidShow`'s `endCoordinates.screenY` overstates clearance by 30.58dp.

import { Platform } from "react-native";

/** The bar's own height. Mirrors the library's KEYBOARD_TOOLBAR_HEIGHT. */
export const KEYBOARD_TOOLBAR_HEIGHT = 42;

/** The library's own rule, evaluated on the same inputs it evaluates. */
export const KEYBOARD_HAS_ROUNDED_CORNERS =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

/** The library's own OPENED_OFFSET: the bar floats this far above the keyboard. */
export const OPENED_OFFSET = KEYBOARD_HAS_ROUNDED_CORNERS ? -11 : 0;

/**
 * What the Done bar actually COSTS above the keyboard's top edge: its height
 * plus however far it floats. 53 on iOS 26+, 42 everywhere else — derived, so
 * an OS bump or a library change to OPENED_OFFSET moves it automatically.
 *
 * Confirmed to the pixel at #1890 INVESTIGATE: iPhone SE3 / iOS 26.5 measured
 * Done-bar top 354.0pt against a keyboard top of 407.0pt (= 53.0), and the
 * physical Samsung measured 453.0dp against 495.1dp (= 42.1).
 */
export const DONE_BAR_OCCUPIED = KEYBOARD_TOOLBAR_HEIGHT - OPENED_OFFSET;

/** The visible gap every keyboard-compensating surface promises ABOVE the bar. */
export const MIN_VISIBLE_CLEARANCE = 12;

/**
 * Is the Done bar present inside a RAW RN <Modal>'s own native window?
 *
 * MEASURED by #1841, not reasoned about. The two platforms genuinely differ:
 *
 *   - iOS: the accessory bar is attached to the SYSTEM KEYBOARD window, so it
 *     composites above every app window. #1841 measured it rendering in the
 *     root window and showing THROUGH a `transparent` Modal — 396.0pt observed
 *     against 396.5pt predicted. A raw <Modal> therefore DOES need to clear it.
 *   - Android: KeyboardStickyView is an ordinary view and only occludes inside
 *     its own window. #1841's colour census counted 17 orange Done rows in the
 *     root window and 0 inside the Modal. Nothing to clear.
 *
 * #1890 F-3/F-4: the two Paystack forms budgeted a flat 42 here, which is dead
 * space on Android and 11pt short on iOS 26+. This is the name that makes the
 * occluder a per-window fact instead of an assumption.
 */
export const DONE_BAR_PRESENT_IN_RAW_MODAL = Platform.OS === "ios";
