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
 * 2. **Native actions live OUTSIDE the scrolling region**, as a `flexShrink: 0`
 *    sibling, exactly as #2180 rebuilt `+not-found.tsx`. On web the global
 *    first-visit consent panel is itself an absolute bottom overlay; placing a
 *    CTA in that same bottom band makes it visible but unclickable. Web actions
 *    therefore live in the centred scrolling region, where browser zoom can
 *    still reach them and the consent panel cannot intercept them. `scroll` is
 *    `flex: 1` + `overflow: hidden`, so native measurement surprises remain
 *    clipped there instead of pushing the pinned footer off screen.
 *
 * `SafeAreaView` is applied here rather than at each call site because at large
 * text the heading now reaches the top of the scroll region, where it would
 * otherwise sit under the status bar.
 */

import React from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
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
        {/*
          #2211 — the centring lives HERE, as an `auto` vertical margin, and not
          as `justifyContent: "center"` on the content container. Measured on an
          iPhone SE 3 at the largest Dynamic Type setting: with
          `justifyContent: "center"` the content container's height stays pinned
          to the viewport, so content taller than the viewport overflows
          symmetrically and the heading's first line sat 20 pt ABOVE y = 0 —
          unrecoverable, because the scroll offset was already 0. An `auto`
          margin centres while there is slack and collapses to 0 when there is
          none, so the top of the card can never leave the scrollable range.
        */}
        <View style={styles.centerer}>
          {children}
          {Platform.OS === "web" && actions !== undefined && actions !== null ? (
            <View style={styles.webActions} testID="invite-shell-web-actions">
              {actions}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {Platform.OS === "web" || actions === undefined || actions === null ? null : (
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
    // #2211 — EXPLICIT. RN defaults a ScrollView's content container to
    // `flexGrow: 0`; omitting this silently top-anchors the card and removes
    // the slack the `auto` margin below needs in order to centre at all.
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  centerer: {
    width: "100%",
    // #2211 — centres while there is slack, collapses to 0 when there is none.
    // See the comment at the call site for the measurement that ruled out
    // `justifyContent: "center"`.
    marginVertical: "auto",
    alignItems: "center",
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
  // #2211 web correction — the global first-visit consent panel is an
  // absolute bottom overlay. A native-style bottom footer sits underneath it
  // and becomes impossible to click. Web keeps the action in this scrolling,
  // centred region instead: it remains reachable under browser zoom while the
  // consent panel cannot intercept it. Native retains the pinned sibling above.
  webActions: {
    width: "100%",
    maxWidth: 480,
    gap: spacing.md,
  },
});
