/**
 * #4490 P2 — small themed pieces the entry flow shares (venue tab, checkout,
 * booking page): a note line with an icon, the summary card rows, a themed
 * primary / secondary button, a section label and a plain error block with
 * a way forward.
 *
 * Colours come only from the page palette (and its status tones); sizes and
 * radii from the design tokens.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { neutralHair, statusOn } from "@mingla/offering-rendering/themePalette";
import { accentFill, themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import type { SummaryLine } from "@mingla/brand-rendering/venueOffers/entryModel";

import { radius, space, size, type } from "../../../constants/designSystem";
import { Icon, type IconName } from "../../ui/Icon";

export interface EntryThemeProps {
  palette: ThemePalette;
  theme: ResolvedTheme;
}

export function EntrySectionLabel({
  palette,
  children,
}: {
  palette: ThemePalette;
  children: string;
}): React.ReactElement {
  return (
    <Text accessibilityRole="header" style={[styles.label, { color: palette.tertiaryText }]}>
      {children.toUpperCase()}
    </Text>
  );
}

export function EntryNote({
  palette,
  icon,
  tone = "neutral",
  children,
  testID,
}: {
  palette: ThemePalette;
  icon: IconName;
  tone?: "neutral" | "warning" | "error" | "success";
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const tones = statusOn(palette);
  const tint =
    tone === "neutral" ? palette.accentWash : tones[tone].tint;
  const ink = tone === "neutral" ? palette.primaryText : tones[tone].text;
  return (
    <View
      style={[styles.note, { backgroundColor: tint }]}
      testID={testID}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" ? "polite" : undefined}
    >
      <Icon name={icon} size={18} color={ink} />
      <View style={styles.noteBody}>
        {typeof children === "string" ? (
          <Text style={[styles.noteText, { color: ink }]}>{children}</Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

export function EntrySummaryRows({
  palette,
  theme,
  lines,
  testID,
}: EntryThemeProps & { lines: readonly SummaryLine[]; testID?: string }): React.ReactElement {
  const hair = neutralHair(palette);
  return (
    <View testID={testID} style={styles.summary}>
      {lines.map((line, index) => (
        <View
          key={`${line.label}-${index}`}
          style={[
            styles.summaryRow,
            line.total ? [styles.totalRow, { borderTopColor: hair }] : null,
          ]}
        >
          <Text
            style={[
              line.total ? styles.totalLabel : line.muted ? styles.mutedLabel : styles.lineLabel,
              line.total ? themeBoldFace(theme) : null,
              { color: line.muted ? palette.tertiaryText : palette.primaryText },
            ]}
          >
            {line.label}
          </Text>
          <Text
            style={[
              line.total ? styles.totalValue : line.muted ? styles.mutedLabel : styles.lineValue,
              line.total ? themeBoldFace(theme) : null,
              { color: line.muted ? palette.tertiaryText : palette.primaryText },
            ]}
          >
            {line.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function EntryButton({
  palette,
  theme,
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = "primary",
  accessibilityLabel,
  testID,
}: EntryThemeProps & {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary";
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  const off = disabled || busy;
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        primary
          ? accentFill(palette)
          : { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 },
        off ? styles.buttonOff : null,
        pressed && !off ? styles.pressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? palette.accentText : palette.primaryText} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            themeBoldFace(theme),
            { color: primary ? palette.accentText : palette.primaryText },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A plain-words problem with one way forward (Try again, or another action). */
export function EntryProblem({
  palette,
  theme,
  title,
  body,
  actionLabel,
  onAction,
  testID,
}: EntryThemeProps & {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.problem} testID={testID} accessibilityLiveRegion="polite">
      <Text style={[styles.problemTitle, themeBoldFace(theme), { color: palette.primaryText }]}>
        {title}
      </Text>
      <Text style={[styles.problemBody, { color: palette.secondaryText }]}>{body}</Text>
      <EntryButton
        palette={palette}
        theme={theme}
        label={actionLabel}
        onPress={onAction}
        variant="secondary"
      />
    </View>
  );
}

export const entryStyles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[5],
    gap: space[3],
  },
});

const styles = StyleSheet.create({
  label: { ...type.label },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  noteBody: { flex: 1, minWidth: 0 },
  noteText: { ...type.small },
  summary: { gap: space[2] },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: space[3],
  },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[3], marginTop: space[1] },
  lineLabel: { ...type.small, flex: 1, minWidth: 0 },
  lineValue: { ...type.small, fontVariant: ["tabular-nums"] },
  mutedLabel: { ...type.caption, fontVariant: ["tabular-nums"] },
  totalLabel: { ...type.h2 },
  totalValue: { ...type.h1, fontVariant: ["tabular-nums"] },
  button: {
    minHeight: size.btn.lg,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[5],
  },
  buttonOff: { opacity: 0.45 },
  buttonText: { ...type.btn },
  pressed: { opacity: 0.85 },
  problem: { gap: space[2], paddingVertical: space[4] },
  problemTitle: { ...type.h2 },
  problemBody: { ...type.small },
});
