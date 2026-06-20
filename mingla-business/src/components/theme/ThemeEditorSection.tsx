import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  MINGLA_DEFAULT_THEME,
  resolveTheme,
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
  ThemeEntranceAnimation,
  type ThemeAnimationSlug,
  type ThemeFontSlug,
  type ThemeInput,
} from "@mingla/offering-rendering";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

import { normalizeHexColor } from "./normalizeHexColor";
import { useThemeFont } from "../../theme/useThemeFont";

interface ThemeEditorSectionProps {
  value: ThemeInput | null | undefined;
  onChange: (next: ThemeInput | null) => void;
  resetLabel?: string;
}

const THEME_COLORS = [
  "#eb7825",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#111827",
] as const;

const labelForSlug = (slug: string): string =>
  slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// ORCH-0964 hex-input contract: commit-on-valid pattern. The pure logic
// lives in ./normalizeHexColor so Jest can unit-test it without an RN
// runtime. The local re-export keeps existing in-file references valid.
const normalizeColor = normalizeHexColor;

export const ThemeEditorSection: React.FC<ThemeEditorSectionProps> = ({
  value,
  onChange,
  resetLabel = "Reset to Mingla default",
}) => {
  const theme = useMemo(() => resolveTheme(value ?? null, null), [value]);
  // ORCH-1083: the preview renders the SELECTED font, so load only that family on
  // demand as the user cycles slugs — NOT all 14 eagerly. See SPEC §C-2.
  useThemeFont(theme.fontFamilyValue);

  // ORCH-0964 hot-fix (post-operator-smoke-test): the hex input must allow
  // free typing. Prior shape `value={value?.color ?? ""}` + on-keystroke
  // normalize destroyed any partial input (#FF1493 typed char-by-char
  // returned to "" after each character because the partial regex didn't
  // match). New shape: separate raw input state + commit only when the
  // trimmed text becomes a valid 7-char #RRGGBB. Swatch taps sync the input
  // via useEffect. Invalid text on blur reverts to last committed value.
  const [hexInputDraft, setHexInputDraft] = useState<string>(value?.color ?? "");
  useEffect(() => {
    setHexInputDraft(value?.color ?? "");
  }, [value?.color]);

  const commit = (patch: ThemeInput): void => {
    const next: ThemeInput = {
      color: value?.color ?? null,
      font: value?.font ?? null,
      animation: value?.animation ?? null,
      ...patch,
    };
    onChange(
      next.color === null && next.font === null && next.animation === null
        ? null
        : next,
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.preview}>
        <View style={[styles.previewBand, { backgroundColor: theme.color }]}>
          <ThemeEntranceAnimation theme={theme} sessionKey="theme-editor-preview" />
        </View>
        <View style={styles.previewBody}>
          <Text
            style={[styles.previewTitle, { fontFamily: theme.fontFamilyValue }]}
          >
            Public page preview
          </Text>
          <Text style={styles.previewMeta}>
            {labelForSlug(theme.font)} · {labelForSlug(theme.animation)}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="button"
        accessibilityLabel={resetLabel}
        style={styles.resetButton}
      >
        <Text style={styles.resetLabel}>{resetLabel}</Text>
      </Pressable>

      <Text style={styles.controlLabel}>Color</Text>
      <View style={styles.swatchRow}>
        {THEME_COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => commit({ color })}
            accessibilityRole="button"
            accessibilityLabel={`Use theme color ${color}`}
            style={[
              styles.swatch,
              { backgroundColor: color },
              theme.color.toLowerCase() === color.toLowerCase() &&
                styles.swatchActive,
            ]}
          />
        ))}
      </View>
      <TextInput
        value={hexInputDraft}
        onChangeText={(text) => {
          setHexInputDraft(text);
          const normalized = normalizeColor(text);
          if (normalized !== null) {
            commit({ color: normalized });
          }
        }}
        onBlur={() => {
          if (normalizeColor(hexInputDraft) === null) {
            setHexInputDraft(value?.color ?? "");
          }
        }}
        placeholder={MINGLA_DEFAULT_THEME.color}
        placeholderTextColor={textTokens.quaternary}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Custom hex theme color"
        style={styles.hexInput}
      />

      <Text style={styles.controlLabel}>Font</Text>
      <View style={styles.optionGrid}>
        {THEME_FONT_SLUGS.map((font) => (
          <OptionPill
            key={font}
            label={labelForSlug(font)}
            active={theme.font === font}
            onPress={() => commit({ font })}
          />
        ))}
      </View>

      <Text style={styles.controlLabel}>Animation</Text>
      <View style={styles.optionGrid}>
        {THEME_ANIMATION_SLUGS.map((animation) => (
          <OptionPill
            key={animation}
            label={labelForSlug(animation)}
            active={theme.animation === animation}
            onPress={() => commit({ animation })}
          />
        ))}
      </View>
    </View>
  );
};

const OptionPill: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.optionPill, active && styles.optionPillActive]}
  >
    <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
      {label}
    </Text>
  </Pressable>
);

export type { ThemeAnimationSlug, ThemeFontSlug };

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  preview: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  previewBand: {
    height: 96,
    overflow: "hidden",
  },
  previewBody: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewTitle: {
    color: textTokens.primary,
    fontSize: 17,
    fontWeight: "700",
  },
  previewMeta: {
    color: textTokens.tertiary,
    fontSize: 12,
    fontWeight: "500",
  },
  resetButton: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    paddingHorizontal: spacing.md,
  },
  resetLabel: {
    color: textTokens.secondary,
    fontSize: 13,
    fontWeight: "700",
  },
  controlLabel: {
    color: textTokens.secondary,
    fontSize: 12,
    fontWeight: "700",
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  hexInput: {
    minHeight: 44,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    paddingHorizontal: spacing.md,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  optionPill: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
  },
  optionPillActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  optionLabel: {
    color: textTokens.secondary,
    fontSize: 12,
    fontWeight: "600",
  },
  optionLabelActive: {
    color: textTokens.primary,
  },
});
