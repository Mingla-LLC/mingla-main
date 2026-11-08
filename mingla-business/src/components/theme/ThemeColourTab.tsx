import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture } from "react-native-gesture-handler";

import type { ThemeInput } from "@mingla/offering-rendering";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { readableTextFor } from "../../utils/buttonAccentContrast";
import { Icon } from "../ui/Icon";
import { WebSafeGestureDetector } from "../ui/WebSafeGestureDetector";
import { normalizeHexColor, normalizeHexColorOnBlur } from "./normalizeHexColor";
import {
  GRADIENT_SWATCHES,
  SOLID_SWATCHES,
  gradientSwatchFor,
  presetForHex,
} from "./themePresets";
import {
  accentOnPageContrast,
  customHueHex,
  hexToHsv,
  hueName,
  hueOfHex,
  seedSecondColour,
  themeContrastLine,
  type ThemeControlScope,
} from "./themeColorModel";

/**
 * issue #1023 wave 2 — the Colour tab: 12 solids, 6 gradients and Custom
 * (Solid or Gradient, hue sliders, hex). Replaces #1022's plane, numeric mode,
 * recents and presets.
 *
 * A gradient is ONE unit: every commit sends the first and second colour
 * together (`onCommit(color, color2)`), so the two can never come from
 * different levels. Venues have no gradient (D-4): their sheet shows solids
 * only.
 */

const SWATCH = 44;
const RAIL_HEIGHT = 28;
const RAIL_THUMB = 32;

export interface ThemeColourTabProps {
  /** The raw override at this level (brand scope: the brand's own theme). */
  value: ThemeInput | null | undefined;
  scope: ThemeControlScope;
  brandTheme?: ThemeInput | null;
  colourInherited: boolean;
  /** One patch per action: both stops together, or color2 null for solid. */
  onCommit: (color: string, color2: string | null) => void;
  /** Inherit the brand's colours (the same as the reset). */
  onInherit: () => void;
}

export const ThemeColourTab: React.FC<ThemeColourTabProps> = ({
  value,
  scope,
  brandTheme,
  colourInherited,
  onCommit,
  onInherit,
}) => {
  const gradientsAllowed = scope !== "venue";
  const color = colourInherited ? null : (value?.color ?? null);
  const color2 = color === null || !gradientsAllowed ? null : (value?.color2 ?? null);

  const solidMatch = color !== null && color2 === null ? presetForHex(color) : null;
  const gradientMatch = color !== null && color2 !== null ? gradientSwatchFor(color, color2) : null;
  const isCustom = color !== null && solidMatch === null && gradientMatch === null;

  const [customOpen, setCustomOpen] = useState<boolean>(isCustom);
  useEffect(() => {
    if (isCustom) setCustomOpen(true);
  }, [isCustom]);

  // ── hex drafts: the ORCH-0964 contract (raw draft, commit on valid, expand
  // short hex on blur only) for each stop.
  const [hexDraft, setHexDraft] = useState<string>(color ?? "");
  const [hex2Draft, setHex2Draft] = useState<string>(color2 ?? "");
  useEffect(() => setHexDraft(color ?? ""), [color]);
  useEffect(() => setHex2Draft(color2 ?? ""), [color2]);

  const base = color ?? brandTheme?.color ?? "#eb7825";
  const gradientMode = color2 !== null;

  const commitFirst = useCallback(
    (hex: string): void => onCommit(hex, gradientMode ? color2 : null),
    [onCommit, gradientMode, color2],
  );
  const commitSecond = useCallback(
    (hex: string): void => onCommit(color ?? base, hex),
    [onCommit, color, base],
  );

  const contrastRatio = useMemo(() => {
    const stops = [base, ...(color2 !== null ? [color2] : [])];
    return Math.min(...stops.map((hex) => accentOnPageContrast(hex, scope === "brand" ? null : brandTheme)));
  }, [base, color2, brandTheme, scope]);

  return (
    <View style={styles.body}>
      {scope !== "brand" && typeof brandTheme?.color === "string" ? (
        <Pressable
          onPress={onInherit}
          style={[styles.brandChip, colourInherited ? styles.brandChipSelected : null]}
          accessibilityRole="radio"
          accessibilityState={{ selected: colourInherited, checked: colourInherited }}
          accessibilityLabel="Brand colours"
          testID="theme-colour-brand"
        >
          <SwatchFill hex={brandTheme.color} hex2={gradientsAllowed ? brandTheme.color2 ?? null : null} size={28} />
          <Text style={styles.brandChipLabel}>Brand colours</Text>
          {colourInherited ? <Icon name="check" size={16} color={accent.warm} /> : null}
        </Pressable>
      ) : null}

      <Text style={styles.rowLabel}>Solid</Text>
      <View style={styles.swatchRow} accessibilityRole="radiogroup" accessibilityLabel="Solid theme colour">
        {SOLID_SWATCHES.map((swatch) => {
          const selected = solidMatch?.hex === swatch.hex;
          return (
            <Swatch
              key={swatch.hex}
              hex={swatch.hex}
              hex2={null}
              selected={selected}
              label={swatch.name}
              onPress={() => onCommit(swatch.hex, null)}
              testID={`theme-swatch-${swatch.name}`}
            />
          );
        })}
      </View>

      {gradientsAllowed ? (
        <>
          <Text style={styles.rowLabel}>Gradient</Text>
          <View
            style={styles.swatchRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Gradient theme colour"
          >
            {GRADIENT_SWATCHES.map((swatch) => (
              <Swatch
                key={swatch.name}
                hex={swatch.hex}
                hex2={swatch.hex2}
                selected={gradientMatch?.name === swatch.name}
                label={`${swatch.name} gradient`}
                onPress={() => onCommit(swatch.hex, swatch.hex2)}
                testID={`theme-gradient-${swatch.name}`}
              />
            ))}
          </View>
        </>
      ) : null}

      <Pressable
        onPress={() => setCustomOpen((open) => !open)}
        style={styles.customToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: customOpen }}
        accessibilityLabel="Custom colour"
        testID="theme-colour-custom-toggle"
      >
        <Text style={styles.customToggleLabel}>Custom colour</Text>
        {isCustom ? <Icon name="check" size={14} color={accent.warm} /> : null}
      </Pressable>

      {customOpen ? (
        <View style={styles.customBox} testID="theme-colour-custom">
          {gradientsAllowed ? (
            <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Custom colour type">
              {(["solid", "gradient"] as const).map((mode) => {
                const active = mode === "gradient" ? gradientMode : !gradientMode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => {
                      if (mode === "solid") onCommit(base, null);
                      else onCommit(base, color2 ?? seedSecondColour(base));
                    }}
                    style={[styles.segmentBtn, active ? styles.segmentBtnActive : null]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={mode === "solid" ? "Solid" : "Gradient"}
                    testID={`theme-colour-mode-${mode}`}
                  >
                    <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>
                      {mode === "solid" ? "Solid" : "Gradient"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <HueSlider
            label="First colour"
            hex={base}
            onCommitHue={(hue) => commitFirst(customHueHex(hue))}
            testID="theme-hue-first"
          />
          {gradientMode ? (
            <HueSlider
              label="Second colour"
              hex={color2 ?? base}
              onCommitHue={(hue) => commitSecond(customHueHex(hue))}
              testID="theme-hue-second"
            />
          ) : null}

          <View style={styles.hexRow}>
            <HexField
              label="Hex"
              draft={hexDraft}
              committed={color ?? ""}
              setDraft={setHexDraft}
              onCommit={commitFirst}
            />
            {gradientMode ? (
              <HexField
                label="Second hex"
                draft={hex2Draft}
                committed={color2 ?? ""}
                setDraft={setHex2Draft}
                onCommit={commitSecond}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <Text style={styles.contrast} testID="theme-colour-contrast">
        {themeContrastLine(contrastRatio, gradientMode)}
      </Text>
    </View>
  );
};

const SwatchFill: React.FC<{ hex: string; hex2: string | null; size: number }> = ({ hex, hex2, size }) =>
  hex2 !== null ? (
    <LinearGradient
      colors={[hex, hex2]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hex }} />
  );

const Swatch: React.FC<{
  hex: string;
  hex2: string | null;
  selected: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
}> = ({ hex, hex2, selected, label, onPress, testID }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ selected, checked: selected }}
    accessibilityLabel={label}
    style={[styles.swatch, selected ? styles.swatchSelected : null]}
    testID={testID}
  >
    {hex2 !== null ? (
      <LinearGradient
        colors={[hex, hex2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    ) : (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hex }]} />
    )}
    {/* Selection is never colour-only: a check in a readable colour. */}
    {selected ? <Icon name="check" size={16} color={readableTextFor(hex)} /> : null}
  </Pressable>
);

const HueSlider: React.FC<{
  label: string;
  hex: string;
  onCommitHue: (hue: number) => void;
  testID?: string;
}> = ({ label, hex, onCommitHue, testID }) => {
  const committedHue = hueOfHex(hex) ?? 25;
  const [dragHue, setDragHue] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const hue = dragHue ?? committedHue;
  const hueFromX = useCallback(
    (x: number): number => Math.round(Math.min(359, Math.max(0, (x / Math.max(1, width)) * 359))),
    [width],
  );
  // One patch per gesture: the thumb follows the finger, the colour commits
  // on release.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => setDragHue(hueFromX(e.x)))
        .onUpdate((e) => setDragHue(hueFromX(e.x)))
        .onEnd((e) => onCommitHue(hueFromX(e.x)))
        .onFinalize(() => setDragHue(null))
        .runOnJS(true),
    [hueFromX, onCommitHue],
  );
  const hsv = hexToHsv(customHueHex(hue));
  const valueText = `${hue} degrees, ${hsv === null ? "colour" : hueName(hsv)}`;
  return (
    <View style={styles.sliderBlock}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <WebSafeGestureDetector gesture={gesture}>
        <View
          style={styles.rail}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: valueText }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            const step = e.nativeEvent.actionName === "increment" ? 5 : -5;
            onCommitHue((committedHue + step + 360) % 360);
          }}
          testID={testID}
        >
          <LinearGradient
            colors={["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[StyleSheet.absoluteFill, { borderRadius: radius.full }]}
          />
          {width > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.railThumb,
                { left: (hue / 359) * width - RAIL_THUMB / 2, backgroundColor: customHueHex(hue) },
              ]}
            />
          ) : null}
        </View>
      </WebSafeGestureDetector>
    </View>
  );
};

const HexField: React.FC<{
  label: string;
  draft: string;
  committed: string;
  setDraft: (next: string) => void;
  onCommit: (hex: string) => void;
}> = ({ label, draft, committed, setDraft, onCommit }) => (
  <View style={styles.hexField}>
    <Text style={styles.sliderLabel}>{label}</Text>
    <TextInput
      value={draft}
      onChangeText={(raw) => {
        setDraft(raw);
        const normalized = normalizeHexColor(raw);
        if (normalized !== null) onCommit(normalized.toLowerCase());
      }}
      onBlur={() => {
        // Short hex (#f80) expands HERE only, never on a keystroke.
        const expanded = normalizeHexColorOnBlur(draft);
        if (expanded === null) {
          setDraft(committed);
          return;
        }
        onCommit(expanded.toLowerCase());
      }}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      autoComplete="off"
      maxLength={7}
      placeholder="#eb7825"
      placeholderTextColor={textTokens.quaternary}
      accessibilityLabel={label === "Hex" ? "Hex colour code" : "Second hex colour code"}
      style={styles.hexInput}
    />
  </View>
);

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  rowLabel: { fontSize: 12, fontWeight: "700", color: textTokens.tertiary },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: { borderWidth: 3, borderColor: "#ffffff" },
  brandChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    alignSelf: "flex-start",
  },
  brandChipSelected: { backgroundColor: accent.tint },
  brandChipLabel: { fontSize: 14, fontWeight: "600", color: textTokens.primary },
  customToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignSelf: "flex-start",
  },
  customToggleLabel: { fontSize: 14, fontWeight: "600", color: textTokens.primary },
  customBox: { gap: spacing.sm },
  segment: {
    height: 40,
    flexDirection: "row",
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.full,
    padding: 3,
    alignSelf: "flex-start",
  },
  segmentBtn: { minWidth: 96, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  segmentBtnActive: { backgroundColor: glass.tint.profileElevated },
  segmentLabel: { fontSize: 13, fontWeight: "600", color: textTokens.tertiary },
  segmentLabelActive: { color: textTokens.primary },
  sliderBlock: { gap: 6 },
  sliderLabel: { fontSize: 12, color: textTokens.tertiary },
  rail: { width: "100%", height: RAIL_HEIGHT, borderRadius: radius.full, justifyContent: "center" },
  railThumb: {
    position: "absolute",
    width: RAIL_THUMB,
    height: RAIL_THUMB,
    borderRadius: RAIL_THUMB / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
    top: (RAIL_HEIGHT - RAIL_THUMB) / 2,
  },
  hexRow: { flexDirection: "row", gap: spacing.sm },
  hexField: { gap: 6 },
  hexInput: {
    width: 132,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
  },
  contrast: { fontSize: 12, lineHeight: 17, color: textTokens.tertiary },
});
