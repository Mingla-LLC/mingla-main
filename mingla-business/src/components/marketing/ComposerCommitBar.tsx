/**
 * ComposerCommitBar — the composer's ONE action row. (#2262, renamed from
 * `ComposerFooter`.)
 *
 * # Why this is a rename and not a new file
 * The old `ComposerFooter` carried `desktopHost: { position: "absolute" }`,
 * which is the whole of RC-3: the same component was absolutely positioned on
 * wide desktop and in normal flow everywhere else, so it overlapped the message
 * box by 9px at 1440x900, by 129px at 1024x700, and floated 285px away from the
 * SMS card's last control at 1440x900. Leaving a retired file on disk beside a
 * new one leaves that style where a later import can resurrect it, and leaves
 * the gate guarding a file nobody renders.
 *
 * # The layout contract (I-PROPOSED-2262-ACTION-ROW-NEVER-LEAVES-THE-VIEWPORT)
 * In normal flow on EVERY surface — Business iOS, Business Android, desktop
 * web, mobile web. It is the LAST band of the composer's flex column and
 * carries `flexShrink: 0`, so it can never be displaced by anything above it.
 * It is never `position: absolute`, never inside a scroll container, and never
 * a term in any height ladder. Its height is deliberately NOT constant (84 +
 * inset at rest, +24 with the blocked-reason caption, taller again when the
 * controls reflow at `fontScale >= 1.3`) — under a flow-sibling architecture
 * that is free, and it is stated so nobody re-derives a footer constant.
 *
 * # The information architecture (#2262 DESIGN §2.4, approved by Seth)
 * `onSendNow` and `onSchedule` never sent anything: BOTH terminate in
 * `ComposerReviewSheet`. They were never two commands — they are one commit
 * with a mode. So: an eye for Preview, a mode chip reading `Now`, and ONE wide
 * solid-accent primary. Picking a time sets the chip to the chosen time and
 * flips the primary's label to `Schedule`. Same button, same place, same tap —
 * the operator has only told it WHEN.
 *
 * # Contrast
 * The label on `accent.warm` is `canvas.discover`, not white. White on #eb7825
 * is 2.90:1 and fails AA at this weight and size; the dark label is 6.67:1.
 * This is the single most consequential control in the product and is the wrong
 * place to carry a known contrast failure. The submitting label stays at
 * opacity 1 (the `Spinner`/`ActivityIndicator` carries the busy signal) —
 * dimming it to 0.7 would drop it to 4.17:1, under AA.
 */

import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { Icon } from "../ui/Icon";
import {
  accent,
  androidOpaque,
  bpCompact,
  bpRegular,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { shouldUseRealBlur } from "../../utils/glassBlur";

/**
 * The 24pt fade that sits immediately ABOVE the bar, in normal flow.
 *
 * This is the fix for "doesn't sit flush". A hairline separator on
 * `canvas.discover` measures 1.53:1 — invisible in daylight, and it reads as a
 * cut. A scrim makes content approaching the bar DISSOLVE into it, so the bar
 * reads as a physical layer rather than three loose buttons on the canvas.
 *
 * It is a BAND, not decoration: in flow, `flexShrink: 0`, `pointerEvents:
 * "none"`. It must never be absolutely positioned over the sheet — that would
 * restore an overlap of exactly the kind RC-3 measured, just prettier. Exported
 * so `compose.tsx` mounts it as the sibling immediately before the bar.
 */
export const COMPOSER_SCRIM_HEIGHT = 24;

export const ComposerCommitScrim: React.FC = () => (
  <LinearGradient
    colors={["rgba(12, 14, 18, 0)", "rgba(12, 14, 18, 1)"]}
    locations={[0, 1]}
    pointerEvents="none"
    importantForAccessibility="no-hide-descendants"
    accessibilityElementsHidden
    style={styles.scrim}
    testID="composer-commit-scrim"
  />
);

export type ComposerSendMode = "now" | "scheduled";

export interface ComposerCommitBarProps {
  /** Preview button — opens the inbox/message preview modal. */
  onPreview: () => void;
  /** SMS surfaces say "Preview message"; email says "Preview email". */
  previewLabel?: string;
  /** Opens the date+time picker. Sets the chip, not the send. */
  onPickTime: () => void;
  /** `now` until the operator picks a time; `scheduled` after. */
  sendMode: ComposerSendMode;
  /** Short chip label for a chosen time, e.g. `Thu 10:00`. Null when `now`. */
  scheduledShortLabel: string | null;
  /** Long form for the screen reader, e.g. `Thursday, October 9 at 10:00 AM`. */
  scheduledLongLabel: string | null;
  /** The one commit. Opens the review sheet in whichever mode the chip says. */
  onCommit: () => void;
  /** True when validation blocks the commit. */
  commitDisabled: boolean;
  /**
   * The single reason the commit is blocked, already prioritised by the caller.
   * Rendered as a caption ABOVE the control row. `missingFieldsLabel()` has
   * always computed this; it was only ever surfaced on a path the operator
   * cannot reach while the button is disabled.
   */
  blockedReason?: string | null;
  /** True while the mutation is in flight (post-confirmation). */
  submitting?: boolean;
}

export const ComposerCommitBar: React.FC<ComposerCommitBarProps> = ({
  onPreview,
  previewLabel = "Preview email",
  onPickTime,
  sendMode,
  scheduledShortLabel,
  scheduledLongLabel,
  onCommit,
  commitDisabled,
  blockedReason,
  submitting,
}) => {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const busy = submitting === true;
  const scheduled = sendMode === "scheduled";
  // Below `bpCompact` the chip drops its label to the clock + chevron. The
  // a11y label still states the time, so colour is never the only indicator.
  const compact = width > 0 && width < bpCompact;
  // At/above `bpRegular` (and below the desktop split) there is width for the
  // Preview button's label again.
  const previewLabelled = width >= bpRegular && !isWideDesktop;
  // ORCH-0891 M3 D-2 (retained): the permanent right-hand preview pane on wide
  // desktop makes a Preview button redundant. A WIDTH decision, so it stays.
  const showPreview = !isWideDesktop;
  const opaqueFill = !shouldUseRealBlur(width);

  const primaryLabel = busy
    ? scheduled
      ? "Scheduling…"
      : "Sending…"
    : scheduled
      ? "Schedule"
      : "Send now";

  const chipLabel = scheduled ? (scheduledShortLabel ?? "Scheduled") : "Now";
  const chipA11y = scheduled
    ? `Scheduled for ${scheduledLongLabel ?? scheduledShortLabel ?? "a chosen time"}. Tap to change.`
    : "Send timing: now. Tap to schedule.";

  // The caption is present ONLY when blocked by validation. Absent when
  // enabled, absent while submitting — this is the one thing the design ever
  // hides, and it is hidden in the one state where the operator is not typing.
  const caption =
    !busy && commitDisabled && typeof blockedReason === "string" && blockedReason.length > 0
      ? blockedReason
      : null;

  return (
    <View
      style={[
        styles.host,
        opaqueFill ? styles.hostOpaque : styles.hostGlass,
        // iOS gets the chrome shadow; Android's elevation draws a hard
        // rectangle under a translucent fill, so it gets none.
        Platform.OS === "ios" ? styles.hostShadow : null,
        compact ? styles.hostCompact : null,
        {
          // #2262 10.3 — NEVER a bare `insets.bottom`. The business web viewport
          // meta carries no `viewport-fit=cover`, so `env(safe-area-inset-*)`
          // resolves to 0 and `insets.bottom` reads 0 on mobile web; a bare
          // inset puts the bar flush against the browser chrome.
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
      testID="composer-commit-bar"
    >
      {/* The 1px glass sparkle along the top edge — the only "edge" the bar
          gets. While submitting it is replaced by the progress hairline. */}
      {busy ? (
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityLabel={scheduled ? "Scheduling" : "Sending"}
          accessibilityState={{ busy: true }}
          testID="composer-commit-bar-progress"
        >
          <View style={styles.progressFill} />
        </View>
      ) : (
        <View style={styles.topHighlight} pointerEvents="none" />
      )}

      {caption !== null ? (
        <Text style={styles.caption} testID="composer-commit-bar-caption">
          {caption}
        </Text>
      ) : null}

      <View style={styles.row}>
        {showPreview ? (
          <Pressable
            onPress={onPreview}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={previewLabel}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [
              styles.iconBtn,
              previewLabelled ? styles.iconBtnLabelled : null,
              pressed ? styles.iconBtnPressed : null,
            ]}
            testID="composer-commit-bar-preview"
          >
            <Icon name="eye" size={20} color={textTokens.secondary} />
            {previewLabelled ? (
              <Text style={styles.iconBtnLabel}>Preview</Text>
            ) : null}
          </Pressable>
        ) : null}

        <Pressable
          onPress={onPickTime}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={chipA11y}
          accessibilityState={{ disabled: busy, expanded: false }}
          style={({ pressed }) => [
            styles.chip,
            compact ? styles.chipCompact : null,
            scheduled && !busy
              ? opaqueFill
                ? styles.chipSetOpaque
                : styles.chipSet
              : null,
            busy ? styles.chipDisabled : null,
            pressed ? styles.chipPressed : null,
          ]}
          testID="composer-commit-bar-mode-chip"
        >
          <Icon
            name="clock"
            size={18}
            color={
              busy
                ? textTokens.tertiary
                : scheduled
                  ? accent.warm
                  : textTokens.primary
            }
          />
          {compact ? null : (
            <Text
              style={[styles.chipLabel, busy ? styles.chipLabelDisabled : null]}
              numberOfLines={1}
            >
              {chipLabel}
            </Text>
          )}
          <Icon
            name="chevD"
            size={16}
            color={busy ? textTokens.tertiary : textTokens.secondary}
          />
        </Pressable>

        <Pressable
          onPress={onCommit}
          disabled={commitDisabled || busy}
          accessibilityRole="button"
          accessibilityLabel={busy ? (scheduled ? "Scheduling" : "Sending") : primaryLabel}
          accessibilityHint={
            caption ??
            (scheduled
              ? "Opens a review before scheduling."
              : "Opens a review before sending.")
          }
          accessibilityState={{ disabled: commitDisabled || busy, busy }}
          style={({ pressed }) => [
            styles.primary,
            commitDisabled && !busy ? styles.primaryDisabled : styles.primaryEnabled,
            pressed && !commitDisabled && !busy ? styles.primaryPressed : null,
          ]}
          testID="composer-commit-bar-primary"
        >
          {busy ? (
            <ActivityIndicator size="small" color={canvas.discover} />
          ) : null}
          <Text
            style={[
              styles.primaryLabel,
              commitDisabled && !busy ? styles.primaryLabelDisabled : null,
            ]}
            numberOfLines={1}
          >
            {primaryLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const CONTROL_HEIGHT = 52;

const styles = StyleSheet.create({
  scrim: {
    height: COMPOSER_SCRIM_HEIGHT,
    flexShrink: 0,
  },
  /**
   * NO `position` key appears anywhere in this StyleSheet, and the i-2262 gate
   * rule R5 fails the build if one returns. That is the machine-checkable form
   * of "the action row cannot be pushed out".
   */
  host: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  hostCompact: {
    paddingHorizontal: spacing.sm,
  },
  hostGlass: {
    backgroundColor: glass.tint.profileBase,
  },
  hostOpaque: {
    backgroundColor: androidOpaque.rowFill,
  },
  hostShadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  topHighlight: {
    height: 1,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: spacing.md - 1,
    backgroundColor: glass.highlight.profileBase,
  },
  progressTrack: {
    height: 2,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: spacing.md - 2,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
  },
  progressFill: {
    height: 2,
    width: "40%",
    backgroundColor: accent.warm,
  },
  caption: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBtn: {
    height: CONTROL_HEIGHT,
    width: CONTROL_HEIGHT,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.control,
    backgroundColor: "transparent",
  },
  iconBtnLabelled: {
    width: undefined,
    paddingHorizontal: spacing.md,
  },
  iconBtnLabel: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  iconBtnPressed: {
    opacity: 0.78,
  },
  chip: {
    height: CONTROL_HEIGHT,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.control,
    backgroundColor: glass.tint.profileBase,
  },
  chipCompact: {
    paddingHorizontal: spacing.sm,
  },
  chipSet: {
    backgroundColor: accent.tint,
    borderColor: accent.warm,
  },
  chipSetOpaque: {
    backgroundColor: androidOpaque.accentFill,
    borderColor: accent.warm,
  },
  chipDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileElevated,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  chipLabelDisabled: {
    color: textTokens.tertiary,
  },
  /**
   * The one saturated colour in the frame, and the widest thing on the screen.
   * `flex: 1` with a `minWidth` floor: at 320pt the row is
   * 320 - 2*8 = 304 content, minus 52 (eye) + 52 (compact chip) + 2*8 (gaps),
   * leaving 184 for the primary against a `Send now` label measuring ~118 with
   * its padding. 66pt of headroom, no truncation, and `adjustsFontSizeToFit` is
   * forbidden here — it silently drops below the AA minimum.
   */
  primary: {
    flex: 1,
    minWidth: 136,
    height: CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: 20,
    borderRadius: radius.full,
  },
  primaryEnabled: {
    backgroundColor: accent.warm,
  },
  primaryDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.control,
  },
  primaryPressed: {
    opacity: 0.9,
  },
  primaryLabel: {
    ...typography.buttonLg,
    // 6.67:1 on #eb7825. White would be 2.90:1 and fails AA at this size.
    color: canvas.discover,
    fontWeight: "600",
  },
  primaryLabelDisabled: {
    color: textTokens.tertiary,
  },
});

export default ComposerCommitBar;
