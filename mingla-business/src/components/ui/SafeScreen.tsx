/**
 * SafeScreen — canonical wrapper for full-screen routes.
 *
 * ORCH-0864 [SafeArea drift systemic + SafeScreen wrapper] — REWORK 5 of
 * ORCH-0859 [Tr2 Minimum Viable Trip]. Every full-screen route under
 * `mingla-business/app/` that is NOT nested inside a parent layout file
 * which already applies `paddingTop: insets.top` MUST wrap its root view
 * in this component (or use `useSafeAreaInsets` + manual paddingTop
 * application — but this wrapper is the preferred canonical path).
 *
 * Why this exists:
 *   - Pre-REWORK-5 every route rolled its own `useSafeAreaInsets` +
 *     `paddingTop` plumbing. Authors forgot. The trip operator dashboard
 *     (`app/trip/[id]/index.tsx`) shipped without SafeArea in ORCH-0859
 *     REWORK 4 — operator saw the Edit button bleed into the status bar.
 *     Forensics report (ORCH-0864) traced 4 confirmed violations + ~10
 *     unaudited routes. The fix is structural: one wrapper, one CI gate
 *     (`I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES`).
 *
 * Routes that DO NOT need this wrapper:
 *   - Children of `app/(tabs)/hub/` — `app/(tabs)/hub/_layout.tsx:82`
 *     applies `paddingTop: insets.top` to all hub children.
 *   - Components that render INSIDE another screen (modal contents, sheet
 *     bodies, list items). The screen itself wraps; nested children don't.
 *
 * Routes that MUST use this wrapper:
 *   - Every top-level route under `app/` that isn't covered by a parent
 *     layout providing top-inset (auth/, account/, brand/, event/, trip/,
 *     o/, checkout/, ari/, marketing/, +not-found, etc.).
 *
 * API:
 *   <SafeScreen>{...}</SafeScreen>           — default: pads top only
 *                                                (bottom is handled by
 *                                                `(tabs)/_layout.tsx`
 *                                                tab bar)
 *   <SafeScreen edges={["top", "bottom"]}>{...}</SafeScreen>
 *                                              — pad both ends; use for
 *                                                non-tab routes where the
 *                                                bottom isn't already
 *                                                covered by the tab bar
 *   <SafeScreen style={customStyle}>...     — merge custom styles on top
 *                                                of the safe-area padding
 *
 * Enforcement:
 *   `.github/scripts/strict-grep/i-proposed-tr2-safearea-on-fullscreen-routes.mjs`
 *   scans every route under `mingla-business/app/` and requires either
 *   (a) imports `SafeScreen`, OR (b) imports `useSafeAreaInsets` AND
 *   applies `paddingTop: insets.top`, OR (c) an explicit allowlist
 *   comment. Wired into `.github/workflows/strict-grep-mingla-business.yml`.
 */

import React from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type SafeScreenEdge = "top" | "bottom";

export interface SafeScreenProps {
  children: React.ReactNode;
  /**
   * Which edges to pad with the device safe-area insets.
   * Default: `["top"]` only — fits the common case where the screen lives
   * inside the tabs layout which already pads the bottom for the tab bar.
   * Pass `["top", "bottom"]` for routes that don't live inside the tabs
   * (modals, full-screen flows that hide the tab bar).
   */
  edges?: readonly SafeScreenEdge[];
  /**
   * Optional style merged on top of the padding. Use for backgroundColor,
   * flex direction, etc.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Optional testID for QA + Maestro flows.
   */
  testID?: string;
}

export const SafeScreen: React.FC<SafeScreenProps> = ({
  children,
  edges = ["top"],
  style,
  testID,
}) => {
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: edges.includes("top") ? insets.top : 0,
    paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
  };
  return (
    <View style={[styles.host, padding, style]} testID={testID}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});

export default SafeScreen;
