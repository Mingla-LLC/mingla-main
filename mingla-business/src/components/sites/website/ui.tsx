import React, { forwardRef, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  accent,
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { WebsiteIcon, type WebsiteIconName } from "./WebsiteIcon";

/*
 * #2829 W9r — the Website section's building blocks, drawn to the approved
 * prototype (DESIGN_SPEC §2, §4, §5): pill buttons, cards, chips, banners,
 * list rows, 32 px mini buttons inside 44 px rows, switches and segmented
 * radios. Every interactive element has a role, a label and a 44 px target.
 * Android gets opaque fills (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 */

const android = Platform.OS === "android";

export const ui = {
  card: android ? androidOpaque.rowFill : glass.tint.profileBase,
  cardBorder: android ? androidOpaque.rowBorder : glass.border.profileBase,
  card2: "rgba(255, 255, 255, 0.06)",
  border2: glass.border.profileElevated,
  border3: "rgba(255, 255, 255, 0.22)",
  t1: textTokens.primary,
  t2: textTokens.secondary,
  t3: textTokens.tertiaryOnCard,
  t4: textTokens.quaternary,
  accent: accent.warm,
  onAccent: "#140a03",
  ok: semantic.success,
  warn: semantic.warning,
  err: semantic.errorText,
} as const;

type Tone = "neutral" | "ok" | "warn" | "err" | "info" | "accent";

const CHIP: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "rgba(255, 255, 255, 0.09)", fg: textTokens.secondary },
  ok: { bg: android ? androidOpaque.successFill : semantic.successTint, fg: "#7ee2a3" },
  warn: { bg: android ? androidOpaque.warningFill : semantic.warningTint, fg: "#fcd27a" },
  err: { bg: android ? androidOpaque.errorFill : semantic.errorTint, fg: "#fca5a5" },
  info: { bg: android ? androidOpaque.infoFill : semantic.infoTint, fg: "#a8cbff" },
  accent: { bg: android ? androidOpaque.accentFill : "rgba(235, 120, 37, 0.16)", fg: "#ffb37a" },
};

const BANNER_BORDER: Record<Exclude<Tone, "neutral" | "accent">, string> = {
  ok: "rgba(34, 197, 94, 0.35)",
  warn: "rgba(245, 158, 11, 0.35)",
  err: "rgba(248, 113, 113, 0.35)",
  info: "rgba(96, 165, 250, 0.35)",
};

export function Chip({ label, tone = "neutral", testID }: { label: string; tone?: Tone; testID?: string }): React.ReactElement {
  const colors = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: colors.bg }]} testID={testID}>
      {tone === "ok" || tone === "warn" || tone === "err" ? <View style={[styles.chipDot, { backgroundColor: colors.fg }]} /> : null}
      <Text style={[styles.chipText, { color: colors.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export type WButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const WButton = forwardRef<View, {
  label: string;
  onPress: () => void;
  variant?: WButtonVariant;
  size?: "md" | "sm";
  icon?: WebsiteIconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
}>(function WButton(props, ref) {
  const variant = props.variant ?? "secondary";
  const fg = variant === "primary" ? ui.onAccent : variant === "ghost" ? ui.accent : variant === "danger" ? ui.err : ui.t1;
  const disabled = props.disabled === true || props.loading === true;
  return (
    <Pressable
      ref={ref}
      onPress={disabled ? undefined : props.onPress}
      disabled={disabled}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled, busy: props.loading === true }}
      testID={props.testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.button,
        props.size === "sm" ? styles.buttonSm : null,
        variant === "primary" ? styles.buttonPrimary : variant === "ghost" ? styles.buttonGhost : styles.buttonSecondary,
        props.grow ? styles.grow : null,
        disabled ? styles.disabled : null,
        (pressed || hovered) && !disabled ? (variant === "primary" ? styles.primaryPressed : styles.secondaryPressed) : null,
        props.style,
      ]}
    >
      {props.loading ? <ActivityIndicator size="small" color={fg} /> : props.icon ? <WebsiteIcon name={props.icon} size={16} color={fg} /> : null}
      <Text style={[styles.buttonText, props.size === "sm" ? styles.buttonTextSm : null, { color: fg }]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
});

/** A 32 px square button inside a 44 px hit area (reorder, show/hide, copy). */
export const MiniButton = forwardRef<View, {
  icon: WebsiteIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}>(function MiniButton(props, ref) {
  return (
    <Pressable
      ref={ref}
      onPress={props.disabled ? undefined : props.onPress}
      disabled={props.disabled}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      hitSlop={6}
      testID={props.testID}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.mini, hovered && !props.disabled ? styles.miniHover : null, props.disabled ? styles.miniDisabled : null]}
    >
      <WebsiteIcon name={props.icon} size={16} color={ui.t2} />
    </Pressable>
  );
});

export function Toggle({ value, onChange, label, disabled, testID }: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(position, { toValue: value ? 1 : 0, duration: 200, useNativeDriver: Platform.OS !== "web" }).start();
  }, [position, value]);
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!value)}
      disabled={disabled}
      role="switch"
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityState={{ checked: value, disabled: disabled === true }}
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
      style={[styles.toggle, value ? styles.toggleOn : null, disabled ? styles.disabled : null]}
    >
      <Animated.View style={[styles.toggleThumb, { transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange, disabled, compact, testIDPrefix }: {
  label: string;
  options: readonly { value: T; label: string; icon?: WebsiteIconName }[];
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
  compact?: boolean;
  testIDPrefix?: string;
}): React.ReactElement {
  return (
    <View role="radiogroup" accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={disabled ? undefined : () => onChange(option.value)}
            disabled={disabled}
            role="radio"
            accessibilityRole="radio"
            aria-checked={checked}
            accessibilityState={{ checked, disabled: disabled === true }}
            accessibilityLabel={option.label}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            style={[styles.segment, compact ? styles.segmentCompact : null, checked ? styles.segmentOn : null, disabled ? styles.disabled : null]}
          >
            {option.icon ? <WebsiteIcon name={option.icon} size={16} color={checked ? ui.t1 : ui.t2} /> : null}
            <Text style={[styles.segmentText, checked ? styles.segmentTextOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card({ children, style, tone, testID }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "warn";
  testID?: string;
}): React.ReactElement {
  return <View style={[styles.card, tone === "warn" ? styles.cardWarn : null, style]} testID={testID}>{children}</View>;
}

export function CardTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.ReactElement {
  return <Text role="heading" aria-level={3} accessibilityRole="header" style={[styles.cardTitle, style]}>{children}</Text>;
}

export function Hint({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.ReactElement {
  return <Text style={[styles.hint, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.ReactElement {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Banner({ tone, icon, title, body, children, testID, alert }: {
  tone: "ok" | "warn" | "err" | "info";
  icon: WebsiteIconName;
  title: string;
  body?: string | null;
  children?: React.ReactNode;
  testID?: string;
  alert?: boolean;
}): React.ReactElement {
  return (
    <View
      role={alert ? "alert" : "status"}
      accessibilityLiveRegion={alert ? "assertive" : "polite"}
      style={[styles.banner, { backgroundColor: CHIP[tone].bg, borderColor: BANNER_BORDER[tone] }]}
      testID={testID}
    >
      <WebsiteIcon name={icon} size={18} color={CHIP[tone].fg} />
      <View style={styles.grow}>
        <Text style={styles.bannerTitle}>{title}</Text>
        {body ? <Text style={styles.bannerBody}>{body}</Text> : null}
      </View>
      {children ? <View style={styles.bannerActions}>{children}</View> : null}
    </View>
  );
}

/**
 * The section header: H1 (hidden on phone, where the top bar carries the
 * name), subtitle, right-hand actions. The H1 takes focus on a rail switch.
 */
export const SectionHead = forwardRef<Text, {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  phone: boolean;
}>(function SectionHead({ title, subtitle, right, phone }, ref) {
  return (
    <View style={[styles.head, phone ? styles.headPhone : null]}>
      <View style={styles.grow}>
        <Text
          ref={ref}
          role="heading"
          aria-level={1}
          accessibilityRole="header"
          // Focus target after a rail switch (tabIndex -1 on web).
          {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
          style={[styles.h1, phone ? styles.visuallyHidden : null]}
        >
          {title}
        </Text>
        {subtitle ? (typeof subtitle === "string" ? <Text style={styles.subtitle}>{subtitle}</Text> : subtitle) : null}
      </View>
      {right ? <View style={[styles.headRight, phone ? styles.headRightPhone : null]}>{right}</View> : null}
    </View>
  );
});

export function ListBox({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.list, style]}>
      {items.map((child, index) => (
        <View key={index} style={index > 0 ? styles.listDivider : null}>{child}</View>
      ))}
    </View>
  );
}

export function Row({ children, onPress, accessibilityLabel, testID, style }: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  if (!onPress) return <View style={[styles.row, style]} testID={testID}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, hovered ? styles.rowHover : null, style]}
    >
      {children}
    </Pressable>
  );
}

export function RowText({ title, lines, strongTitle = true }: { title: string; lines?: (React.ReactNode | null)[]; strongTitle?: boolean }): React.ReactElement {
  return (
    <View style={styles.grow}>
      <Text style={[styles.rowTitle, strongTitle ? null : styles.rowTitleRegular]} numberOfLines={3}>{title}</Text>
      {(lines ?? []).filter(Boolean).map((line, index) => (
        typeof line === "string" ? <Text key={index} style={styles.rowSub} numberOfLines={2}>{line}</Text> : <View key={index}>{line}</View>
      ))}
    </View>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & {
  label: string;
  max?: number;
  help?: string | null;
  error?: string | null;
  mono?: boolean;
  multiline?: boolean;
  countLabel?: string;
  testID?: string;
}>(function Field({ label, max, help, error, mono, multiline, countLabel, testID, style, ...input }, ref) {
  const value = typeof input.value === "string" ? input.value : "";
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel} nativeID={testID ? `${testID}-label` : undefined}>{label}</Text>
        {countLabel ? <Text style={styles.count}>{countLabel}</Text> : max ? <Text style={styles.count}>{value.length}/{max}</Text> : null}
      </View>
      <TextInput
        ref={ref}
        {...input}
        maxLength={max}
        multiline={multiline}
        accessibilityLabel={input.accessibilityLabel ?? label}
        aria-invalid={error ? true : undefined}
        placeholderTextColor={ui.t4}
        testID={testID}
        style={[styles.input, multiline ? styles.inputMultiline : null, mono ? styles.mono : null, error ? styles.inputError : null, style]}
      />
      {error ? <Text style={styles.fieldError} role="alert">{error}</Text> : help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
});

export function Skeleton({ height, width = "100%", style }: { height: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View style={[styles.skeleton, { height, width }, style]} />;
}

export function LoadingPane(): React.ReactElement {
  return (
    <View role="status" accessibilityLabel="Loading your website" testID="website-loading">
      <Skeleton height={32} width="40%" style={{ marginBottom: 12 }} />
      <Skeleton height={16} width="70%" style={{ marginBottom: 24 }} />
      <Skeleton height={96} style={{ marginBottom: 12 }} />
      <Skeleton height={96} style={{ marginBottom: 12 }} />
      <Skeleton height={96} />
    </View>
  );
}

export function Spinner({ label }: { label?: string }): React.ReactElement {
  return <ActivityIndicator size="small" color={ui.accent} accessibilityLabel={label} />;
}

export function CheckCircle({ state }: { state: "on" | "off" | "warn" | "fail" }): React.ReactElement {
  const bg = state === "on" ? ui.ok : state === "warn" ? ui.warn : state === "fail" ? "#f87171" : "transparent";
  return (
    <View style={[styles.ck, state === "off" ? styles.ckOff : { backgroundColor: bg, borderColor: bg }]}>
      {state === "on" ? <WebsiteIcon name="check" size={12} color="#06210f" /> : null}
      {state === "warn" ? <Text style={styles.ckMark}>!</Text> : null}
      {state === "fail" ? <WebsiteIcon name="x" size={12} color="#2a0606" /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.45 },
  visuallyHidden: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 24, paddingHorizontal: 9, borderRadius: radius.full, alignSelf: "flex-start" },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: "600", lineHeight: 16 },
  button: {
    minHeight: 44, paddingHorizontal: 18, borderRadius: radius.full, borderWidth: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  buttonSm: { minHeight: 36, paddingHorizontal: 14 },
  buttonPrimary: { backgroundColor: ui.accent, borderColor: ui.accent },
  buttonSecondary: { backgroundColor: ui.card2, borderColor: ui.border2 },
  buttonGhost: { backgroundColor: "transparent", borderColor: "transparent" },
  primaryPressed: { opacity: 0.9 },
  secondaryPressed: { backgroundColor: "rgba(255, 255, 255, 0.09)" },
  buttonText: { ...typography.buttonMd },
  buttonTextSm: { fontSize: 13 },
  mini: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: ui.cardBorder, alignItems: "center", justifyContent: "center" },
  miniHover: { backgroundColor: ui.card2 },
  miniDisabled: { opacity: 0.3 },
  toggle: { width: 48, height: 28, borderRadius: radius.full, backgroundColor: "rgba(255, 255, 255, 0.09)", padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: ui.accent },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#ffffff" },
  segmented: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  segment: {
    minHeight: 40, paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: ui.border2,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  segmentCompact: { minHeight: 36, paddingHorizontal: 12 },
  segmentOn: { borderColor: ui.accent, backgroundColor: android ? androidOpaque.accentFill : "rgba(235, 120, 37, 0.16)" },
  segmentText: { fontSize: 13, fontWeight: "600", color: ui.t2 },
  segmentTextOn: { color: ui.t1 },
  card: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.cardBorder, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, overflow: "hidden" },
  cardWarn: { borderColor: "rgba(245, 158, 11, 0.45)" },
  cardTitle: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: ui.t1, marginBottom: 4 },
  hint: { fontSize: 12, lineHeight: 16, color: ui.t3 },
  body: { ...typography.bodySm, color: ui.t2 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.md, flexWrap: "wrap" },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: ui.t1 },
  bannerBody: { fontSize: 13, lineHeight: 18, color: ui.t2, marginTop: 2 },
  bannerActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, marginBottom: 20, flexWrap: "wrap" },
  headPhone: { flexDirection: "column", gap: 12, marginBottom: spacing.md },
  headRight: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  headRightPhone: { alignSelf: "stretch" },
  h1: { ...typography.h2, lineHeight: 32, color: ui.t1, ...(Platform.OS === "web" ? ({ outlineWidth: 0 } as TextStyle) : {}) },
  subtitle: { ...typography.bodySm, color: ui.t2, marginTop: 4 },
  list: { borderWidth: 1, borderColor: ui.cardBorder, borderRadius: radius.lg, overflow: "hidden", backgroundColor: ui.card },
  listDivider: { borderTopWidth: 1, borderTopColor: ui.cardBorder },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64, flexWrap: "wrap" },
  rowHover: { backgroundColor: ui.card2 },
  rowTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: ui.t1 },
  rowTitleRegular: { fontWeight: "500" },
  rowSub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  field: { marginTop: 14 },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6, gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: ui.t2 },
  count: { fontSize: 13, color: ui.t3 },
  input: {
    minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: ui.border2,
    backgroundColor: "rgba(255, 255, 255, 0.03)", paddingHorizontal: 12, paddingVertical: 10,
    color: ui.t1, fontSize: 14,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  inputError: { borderColor: "#f87171" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }), fontSize: 13 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 6 },
  fieldError: { fontSize: 12, lineHeight: 16, color: ui.err, marginTop: 6 },
  skeleton: { borderRadius: 10, backgroundColor: "rgba(255, 255, 255, 0.06)" },
  ck: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  ckOff: { borderColor: "rgba(255, 255, 255, 0.22)" },
  ckMark: { fontSize: 12, fontWeight: "800", color: "#2a1700", lineHeight: 14 },
  rowWrap: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  thumb: { width: 56, height: 42, borderRadius: 8, backgroundColor: "rgba(255, 255, 255, 0.06)" },
});
