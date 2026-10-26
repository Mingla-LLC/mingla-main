/**
 * #3872 — shared Host building blocks for the Creator and Referral programs,
 * on the app's glass design system (no flat "ProgramUi" look).
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScrollView } from "../../wrappers/SmartScrollView";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { ProgramBackBar } from "./ProgramBackBar";
import type { HostStatusTone } from "../../utils/creatorProgramFormat";

// ---------------------------------------------------------------------------
// Screen shell: plain title bar, scrolling content, optional sticky footer.
// ---------------------------------------------------------------------------

export function ProgramScreen({
  title,
  fallback,
  leading,
  right,
  footer,
  overlay,
  refreshing,
  onRefresh,
  children,
  testID,
}: {
  title: string;
  fallback: string;
  leading?: "back" | "close";
  right?: React.ReactNode;
  footer?: React.ReactNode;
  /** Sheets and viewers: rendered outside the scroll view so they cover the screen. */
  overlay?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID={testID}>
      <Stack.Screen options={{ headerShown: false }} />
      <ProgramBackBar
        title={title}
        fallback={fallback}
        leading={leading}
        right={right}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing === true}
              onRefresh={onRefresh}
              tintColor={accent.warm}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
      {overlay ?? null}
    </SafeAreaView>
  );
}

/** Scrollable, padded body for a Sheet (inputs stay above the keyboard). */
export function SheetBody({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.sheetBody}
      keyboardShouldPersistTaps="handled"
    >
      {title ? (
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </ScrollView>
  );
}

export function ProgramLoading({
  label = "Loading…",
}: {
  label?: string;
}): React.ReactElement {
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <ActivityIndicator color={accent.warm} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text pieces
// ---------------------------------------------------------------------------

export function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return <Text style={[styles.muted, style as never]}>{children}</Text>;
}

export function FieldError({
  message,
}: {
  message: string | null | undefined;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <Text style={styles.fieldError} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Cards, rows, tiles, pills
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  const card = (
    <GlassCard variant="base" style={[styles.card, style]}>
      {children}
    </GlassCard>
  );
  if (!onPress) return card;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {card}
    </Pressable>
  );
}

export function ListGroup({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <GlassCard variant="base" style={styles.group}>
      {items.map((child, index) => (
        <View key={index} style={index > 0 ? styles.groupDivider : null}>
          {child}
        </View>
      ))}
    </GlassCard>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  chevron = Boolean(onPress),
  accessibilityLabel,
  leading,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  accessibilityLabel?: string;
  leading?: React.ReactNode;
}): React.ReactElement {
  const body = (
    <View style={styles.row}>
      {leading ??
        (icon ? (
          <View style={styles.rowIcon}>
            <Icon name={icon} size={18} color={accent.warm} />
          </View>
        ) : null)}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof right === "string" ? (
        <Text style={styles.rowRight}>{right}</Text>
      ) : (
        (right ?? null)
      )}
      {chevron ? (
        <Icon name="chevR" size={16} color={textTokens.tertiary} />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}

export function StatTile({
  value,
  label,
  hint,
  icon,
}: {
  value: string;
  label: string;
  hint?: string | null;
  icon?: IconName;
}): React.ReactElement {
  return (
    <GlassCard variant="base" style={styles.tile}>
      {icon ? (
        <View style={styles.tileIcon}>
          <Icon name={icon} size={14} color={accent.warm} />
        </View>
      ) : null}
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.tileHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </GlassCard>
  );
}

/** 2-up grid of tiles that wraps on phones (2×2) and stays 2-up on desktop. */
export function TileGrid({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.tileGrid}>
      {React.Children.toArray(children)
        .filter(Boolean)
        .map((child, index) => (
          <View key={index} style={styles.tileCell}>
            {child}
          </View>
        ))}
    </View>
  );
}

const TONE: Record<
  HostStatusTone | "live" | "paused",
  { bg: string; fg: string }
> = {
  action: { bg: accent.tint, fg: accent.warm },
  waiting: { bg: glass.tint.profileElevated, fg: textTokens.secondary },
  done: { bg: semantic.successTint, fg: semantic.success },
  problem: { bg: semantic.errorTint, fg: semantic.errorText },
  ended: { bg: glass.tint.profileElevated, fg: textTokens.tertiary },
  live: { bg: semantic.successTint, fg: semantic.success },
  paused: { bg: semantic.warningTint, fg: semantic.warning },
};

export function StatusTag({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof TONE;
}): React.ReactElement {
  const colors = TONE[tone];
  return (
    <View style={[styles.tag, { backgroundColor: colors.bg }]}>
      <Text style={[styles.tagText, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Two-to-four segment control (Sell tickets / Get seen; Offers / Promoters …). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (next: T) => void;
}): React.ReactElement {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text
              style={[styles.segmentText, on && styles.segmentTextOn]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Initials({
  name,
  size = 40,
}: {
  name: string;
  size?: number;
}): React.ReactElement {
  const letters =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <View
      style={[
        styles.initials,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={styles.initialsText}>{letters}</Text>
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.checkRow}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? (
          <Icon name="check" size={14} color={textTokens.inverse} />
        ) : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.summaryLine}>
      <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, strong && styles.summaryStrong]}>
        {value}
      </Text>
    </View>
  );
}

export const programStyles = StyleSheet.create({
  title: { color: textTokens.primary, fontSize: 18, fontWeight: "700" },
  body: { color: textTokens.primary, fontSize: 15, lineHeight: 22 },
  muted: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  small: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  grow: { flex: 1 },
  stack: { gap: spacing.sm },
  footerRow: { flexDirection: "row", gap: spacing.sm },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas.profile },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  footer: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    backgroundColor: canvas.profile,
  },
  sheetBody: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
  loading: { paddingVertical: spacing.xl, alignItems: "center" },
  section: {
    color: textTokens.tertiary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: spacing.sm,
  },
  muted: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  fieldError: {
    color: semantic.errorText,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  card: { padding: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.85 },
  group: { paddingHorizontal: spacing.md },
  groupDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileElevated,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: textTokens.primary, fontSize: 16, fontWeight: "600" },
  rowSubtitle: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  rowRight: { color: textTokens.primary, fontSize: 15, fontWeight: "700" },
  tile: { padding: spacing.md, gap: 4, minHeight: 104 },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    marginBottom: 2,
  },
  tileLabel: { color: textTokens.secondary, fontSize: 13 },
  tileValue: { color: textTokens.primary, fontSize: 24, fontWeight: "800" },
  tileHint: { color: semantic.success, fontSize: 12, fontWeight: "600" },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -spacing.xs,
  },
  tileCell: { width: "50%", padding: spacing.xs },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    maxWidth: 200,
  },
  tagText: { fontSize: 12, fontWeight: "700" },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
  },
  chipOn: { borderColor: accent.border, backgroundColor: accent.tint },
  chipText: { color: textTokens.secondary, fontWeight: "600", fontSize: 14 },
  chipTextOn: { color: textTokens.primary },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radius.full,
  },
  segmentOn: { backgroundColor: "rgba(255,255,255,0.12)" },
  segmentText: { color: textTokens.secondary, fontWeight: "600", fontSize: 14 },
  segmentTextOn: { color: textTokens.primary },
  initials: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.warm,
  },
  initialsText: { color: textTokens.inverse, fontWeight: "800" },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: glass.border.pending,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkBoxOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  checkLabel: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  summaryLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 4,
  },
  summaryLabel: { color: textTokens.secondary, fontSize: 15, flexShrink: 1 },
  summaryValue: { color: textTokens.primary, fontSize: 15, fontWeight: "600" },
  summaryStrong: { color: textTokens.primary, fontWeight: "800", fontSize: 17 },
});

/** Six-segment progress bar with a caption ("Step 3 of 6 · Script"). */
export function StepBar({
  steps,
  current,
  caption,
}: {
  steps: readonly string[];
  current: number;
  caption?: string;
}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? `Step ${current} of ${steps.length}`}
      accessibilityValue={{ min: 1, max: steps.length, now: current }}
      style={stepStyles.wrap}
    >
      <View style={stepStyles.bar}>
        {steps.map((step, index) => (
          <View
            key={step}
            style={[
              stepStyles.segment,
              index + 1 < current && stepStyles.done,
              index + 1 === current && stepStyles.current,
            ]}
          />
        ))}
      </View>
      {caption ? <Text style={stepStyles.caption}>{caption}</Text> : null}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  bar: { flexDirection: "row", gap: 4 },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: glass.border.profileElevated,
  },
  done: { backgroundColor: accent.border },
  current: { backgroundColor: accent.warm },
  caption: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
});
