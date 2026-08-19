/**
 * InviteScreenShell — the layout host every invitation-landing surface renders
 * into. Introduced by #2211 [a business user cannot accept a team invitation at
 * the largest text size].
 *
 * ─── WHAT WAS BROKEN ───────────────────────────────────────────────────────
 * `accept-brand-invitation`, `accept-scanner-invitation` and
 * `WrongAccountRecovery` each opened with `<View style={styles.host}>` where
 * `host` was `flex: 1` + `justifyContent: "center"` and there was NO scroll
 * container anywhere in the render path. When centred content outgrows its
 * container it overflows in BOTH directions, so at the largest Dynamic Type
 * setting the "You're invited" heading was measured at [65,-77] — clipped off
 * the TOP of the screen — the body copy ended past the bottom, and the only
 * Button was absent from the accessibility tree entirely. Swiping changed
 * nothing, because nothing scrolled. An invited teammate running accessibility
 * text sizes could not accept a team invitation by any means.
 *
 * ─── THE TWO STRUCTURAL GUARANTEES ─────────────────────────────────────────
 * 1. **The content region SCROLLS.** `contentContainerStyle.flexGrow = 1`
 *    keeps the card optically centred while there is room and lets it scroll
 *    once there is not — so nothing moves at ordinary text sizes, and nothing
 *    is ever unreachable at large ones. `flexGrow` is set EXPLICITLY: a
 *    ScrollView's content container defaults to `flexGrow: 0`, and omitting it
 *    is the silent footgun recorded in
 *    `feedback_rn_scrollview_flex_grow_default_one_silent_footgun`.
 * 2. **The action lives OUTSIDE the scrolling region**, as a `flexShrink: 0`
 *    sibling, exactly as #2180 rebuilt `+not-found.tsx`. On these screens the
 *    CTA is the entire point — an invitee whose only job is to press "Sign in"
 *    must never have to discover that the screen scrolls first. `scroll` is
 *    `flex: 1` + `overflow: hidden`, so anything that mis-measures inside it is
 *    clipped THERE rather than growing the column and pushing the footer off
 *    the bottom of the screen. That is the failure mode that made #2180
 *    terminal, and it cannot happen to a sibling.
 *
 * `SafeAreaView` is applied here rather than at each call site because at large
 * text the heading now reaches the top of the scroll region, where it would
 * otherwise sit under the status bar.
 */

import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { canvas, spacing } from "../../constants/designSystem";

export interface InviteScreenShellProps {
  /** The scrolling, optically-centred region. Cards, spinners, copy. */
  children: React.ReactNode;
  /**
   * The pinned region. Rendered as a `flexShrink: 0` SIBLING of the scroll
   * host — never a child — so no measurement surprise inside `children` can
   * move it. Omit it on screens that have no action (e.g. a live spinner).
   */
  actions?: React.ReactNode;
  testID?: string;
}

export function InviteScreenShell({
  children,
  actions,
  testID,
}: InviteScreenShellProps): React.ReactElement {
  return (
    <SafeAreaView
      style={styles.host}
      edges={["top", "left", "right", "bottom"]}
      testID={testID}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="invite-shell-scroll"
      >
        {children}
      </ScrollView>
      {actions === undefined || actions === null ? null : (
        <View style={styles.footer} testID="invite-shell-footer">
          {/* Same 480 pt ceiling the card uses, so the action stays visually
              bound to the card it belongs to on wide screens. */}
          <View style={styles.footerInner}>{actions}</View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  scroll: {
    flex: 1,
    // #2211 — clip anything that mis-measures in here rather than letting it
    // grow the column and push the footer (the action) off-screen.
    overflow: "hidden",
  },
  scrollContent: {
    // #2211 — EXPLICIT. Centres while there is room; scrolls once there is not.
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    // #2211 — never allowed to shrink, and never inside the scrolling region.
    flexShrink: 0,
    alignItems: "center",
    width: "100%",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  footerInner: {
    width: "100%",
    maxWidth: 480,
    gap: spacing.md,
  },
});
