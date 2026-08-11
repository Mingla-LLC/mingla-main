/**
 * #1627 [keyboard-guard-vacuity]: SmartKeyboardAvoidingView — WEB variant.
 *
 * WHY THIS FILE EXISTS. `react-native-keyboard-controller` is a NATIVE
 * keyboard library. Web has no soft keyboard that overlaps content, so every
 * one of its primitives is inert there — but a single named import from the
 * package ROOT in a platform-agnostic `.tsx` drags the library's whole
 * 12-primitive barrel into `__common`, the eager chunk every guest downloads
 * before ANY route renders. Measured on `3745ea19f`: 60,418 B raw /
 * 12,719 B gzip / 9,966 B brotli, for twelve primitives web uses none of.
 *
 * This wrapper is the platform boundary. Metro resolves `.native.tsx` on iOS
 * and Android and THIS file on web, so the library is reachable from the
 * native graph only.
 *
 * CONVENTION. `X.tsx` = web/default, `X.native.tsx` = native — the split this
 * directory already uses for `SmartScrollView`, `KeyboardRoot`,
 * `KeyboardToolbarRoot`, `useKeyboardIsVisible` and `useKeyboardHeight`. Do
 * NOT add a `.web.tsx` here: that inverts the local convention and leaves
 * node/jest resolving the NATIVE file by default. (`packages/phone-input`
 * uses the opposite split; each package keeps its own.)
 *
 * Invariants: I-PROPOSED-1627-NO-NATIVE-KEYBOARD-LIBRARY-IN-THE-WEB-GRAPH
 * (DRAFT) · I-1104-NO-KBC-ON-WEB · I-PROPOSED-KEYBOARD-LIBRARY-ONLY.
 */

import React from "react";
// NOTE: composed from `View`, NOT from react-native's own
// `KeyboardAvoidingView`. Importing that name from "react-native" trips the
// orch-0892 gate's pattern 2 (RE_KAV_FROM_RN_NAMED), and #1841 forbids new
// SAFELIST entries. A plain View is also the honest implementation: there is
// no keyboard to avoid on web, so the only job left is to be the flex box the
// native element was, in the same position in the tree.
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

export type SmartKeyboardAvoidingViewProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Accepted and IGNORED on web. Kept in the type so the two call sites pass
   * the identical prop set on every platform and the `.native` variant — which
   * does honour it — needs no per-platform branch at the call site.
   */
  behavior?: "height" | "padding" | "position";
  /** Accepted and IGNORED on web, for the same reason as `behavior`. */
  keyboardVerticalOffset?: number;
};

/**
 * A real box, deliberately — never a Fragment. Both call sites place this
 * element as a flex sibling inside a `<Modal>` / flex column, and the library's
 * own `KeyboardAvoidingView` renders a `View` there. Collapsing it to a
 * Fragment removes a layout node the surrounding flex arithmetic depends on,
 * which is how a pure bundle fix turns into a visual regression.
 */
export function KeyboardAvoidingView({
  children,
  style,
  // Destructured purely to keep them off the spread onto `View` — RN warns on
  // unknown props, and forwarding `behavior` to a DOM node on web is noise.
  behavior: _behavior,
  keyboardVerticalOffset: _keyboardVerticalOffset,
}: SmartKeyboardAvoidingViewProps): React.ReactElement {
  return <View style={style}>{children}</View>;
}
