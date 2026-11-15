// issue #4420 — the small controls every public "decide" area shares (design
// file: public-pages-design.html → .stepper, .chip, .strip/.pick, .card.on
// .radio, .duo/.big, .done). Experience (date strip, time chips, people),
// RSVP (Going / Maybe, guests, chip-in), trip (room and payment cards) and
// the venue and stay booking tabs all build from these, so a selected chip
// or a stepper looks and behaves the same on every page.
//
// Selection reads in INK (the page's primary text colour on the page tone),
// never in the accent: the accent fill is kept for the one primary action
// (the bar button, the chosen RSVP answer, the tick), so the host's gradient
// stays a single unit (#1023) and light pages stay legible.
//
// Pure: react-native + this package only.

import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { Check, Minus, Plus } from "./LucideIcons";
import { ThemeAccentGradientLayer } from "./ThemeAccentFill";
import { accentFill, accentOutline, themeFontFace } from "./themeAccentStyle";
import {
  boldFontFamily,
  opaqueAccentWashColor,
  type ThemePalette,
} from "./themePalette";

// ─────────────────────────────── panel card ────────────────────────────────

/** The rounded surface card a decide block sits in (`.card`). */
export const OfferingPanel: React.FC<{
  palette: ThemePalette;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}> = ({ palette, children, style, testID }) => (
  <View
    style={[
      styles.panel,
      { backgroundColor: palette.card, borderColor: palette.panelBorder },
      style,
    ]}
    testID={testID}
  >
    {children}
  </View>
);

/** A card row with a label column and a control on the right (`.row`). */
export const OfferingPanelRow: React.FC<{
  palette: ThemePalette;
  title: string;
  detail?: string | null;
  fontFamily?: string;
  right?: React.ReactNode;
  testID?: string;
}> = ({ palette, title, detail, fontFamily, right, testID }) => (
  <View style={styles.panelRow} testID={testID}>
    <View style={styles.panelRowText}>
      <Text
        style={[
          styles.rowTitle,
          { color: palette.primaryText },
          fontFamily !== undefined ? themeFontFace(fontFamily) : null,
        ]}
      >
        {title}
      </Text>
      {detail !== undefined && detail !== null && detail.length > 0 ? (
        <Text style={[styles.rowDetail, { color: palette.secondaryText }]}>
          {detail}
        </Text>
      ) : null}
    </View>
    {right}
  </View>
);

// ──────────────────────────────── stepper ──────────────────────────────────

export interface OfferingStepperProps {
  palette: ThemePalette;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  decrementLabel: string;
  incrementLabel: string;
  /** Spoken value, e.g. "2 people". Defaults to the number. */
  valueLabel?: string;
  fontFamily?: string;
  testID?: string;
}

/** − n + (`.stepper`): outlined minus, ink-filled plus, tabular count. */
export const OfferingStepper: React.FC<OfferingStepperProps> = ({
  palette,
  value,
  min,
  max,
  onChange,
  decrementLabel,
  incrementLabel,
  valueLabel,
  fontFamily,
  testID,
}) => {
  const canDec = value > min;
  const canInc = value < max;
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        onPress={canDec ? () => onChange(value - 1) : undefined}
        disabled={!canDec}
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
        accessibilityState={{ disabled: !canDec }}
        hitSlop={6}
        style={[
          styles.stepBtn,
          { borderColor: palette.panelBorder },
          !canDec ? styles.stepDisabled : null,
        ]}
        testID={testID !== undefined ? `${testID}-dec` : undefined}
      >
        <Minus size={17} color={palette.primaryText} />
      </Pressable>
      <Text
        style={[
          styles.stepValue,
          { color: palette.primaryText },
          fontFamily !== undefined ? themeFontFace(fontFamily) : null,
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={valueLabel ?? String(value)}
        testID={testID !== undefined ? `${testID}-value` : undefined}
      >
        {value}
      </Text>
      <Pressable
        onPress={canInc ? () => onChange(value + 1) : undefined}
        disabled={!canInc}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        accessibilityState={{ disabled: !canInc }}
        hitSlop={6}
        style={[
          styles.stepBtn,
          styles.stepPlus,
          { backgroundColor: palette.primaryText },
          !canInc ? styles.stepDisabled : null,
        ]}
        testID={testID !== undefined ? `${testID}-inc` : undefined}
      >
        <Plus size={17} color={palette.page} />
      </Pressable>
    </View>
  );
};

// ───────────────────────────────── chips ───────────────────────────────────

export interface OfferingChoiceChipProps {
  palette: ThemePalette;
  label: string;
  /** A small accent note after the label ("3 left"). */
  note?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  /** "radio" for one-of chips (default), "button" for toggles. */
  role?: "radio" | "button";
  testID?: string;
}

/** A pill choice (`.chip`): ink when chosen, struck through when not offered. */
export const OfferingChoiceChip: React.FC<OfferingChoiceChipProps> = ({
  palette,
  label,
  note = null,
  selected,
  disabled = false,
  onPress,
  accessibilityLabel,
  role = "radio",
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    disabled={disabled}
    accessibilityRole={role}
    accessibilityState={
      role === "radio"
        ? { checked: selected, disabled }
        : { selected, disabled }
    }
    accessibilityLabel={
      accessibilityLabel ?? (note !== null ? `${label}, ${note}` : label)
    }
    style={({ pressed }) => [
      styles.chip,
      selected
        ? { backgroundColor: palette.primaryText, borderColor: palette.primaryText }
        : { backgroundColor: palette.card, borderColor: palette.panelBorder },
      disabled ? styles.chipDisabled : null,
      pressed && !disabled ? styles.pressed : null,
    ]}
    testID={testID}
  >
    <Text
      style={[
        styles.chipText,
        { color: selected ? palette.page : palette.primaryText },
        disabled ? styles.struck : null,
      ]}
      numberOfLines={1}
    >
      {label}
      {note !== null ? (
        <Text style={[styles.chipNote, { color: selected ? palette.page : palette.accent }]}>
          {`  ${note}`}
        </Text>
      ) : null}
    </Text>
  </Pressable>
);

/** A wrapping row of chips (`.chips`). */
export const OfferingChipRow: React.FC<{
  children?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}> = ({ children, accessibilityLabel, testID }) => (
  <View
    style={styles.chipRow}
    accessibilityRole="radiogroup"
    accessibilityLabel={accessibilityLabel}
    testID={testID}
  >
    {children}
  </View>
);

// ─────────────────────────────── date strip ────────────────────────────────

export interface OfferingDateTile {
  key: string;
  /** Small top line ("SAT", "Today"). */
  top: string;
  /** The big number ("19"). */
  big: string;
  /** Small bottom line ("Dec", "Full", a nightly price). */
  bottom: string;
  disabled?: boolean;
  selected?: boolean;
  /** Between a chosen check-in and check-out (stays). */
  inRange?: boolean;
  accessibilityLabel?: string;
}

/** The horizontal day strip (`.strip` of `.pick` tiles). */
export const OfferingDateStrip: React.FC<{
  palette: ThemePalette;
  tiles: readonly OfferingDateTile[];
  onPress: (key: string) => void;
  fontFamily?: string;
  accessibilityLabel?: string;
  testID?: string;
}> = ({ palette, tiles, onPress, fontFamily, accessibilityLabel, testID }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.strip}
    accessibilityRole="radiogroup"
    accessibilityLabel={accessibilityLabel}
    testID={testID}
  >
    {tiles.map((tile) => {
      const selected = tile.selected === true;
      const disabled = tile.disabled === true;
      const inRange = tile.inRange === true && !selected;
      const ink = selected ? palette.page : palette.primaryText;
      const quiet = selected ? palette.page : palette.secondaryText;
      return (
        <Pressable
          key={tile.key}
          onPress={disabled ? undefined : () => onPress(tile.key)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected, disabled }}
          accessibilityLabel={
            tile.accessibilityLabel ?? `${tile.top} ${tile.big} ${tile.bottom}`
          }
          style={({ pressed }) => [
            styles.tile,
            selected
              ? { backgroundColor: palette.primaryText, borderColor: palette.primaryText }
              : inRange
                ? {
                    backgroundColor: opaqueAccentWashColor(palette),
                    borderColor: "transparent",
                  }
                : { backgroundColor: palette.card, borderColor: palette.panelBorder },
            disabled ? styles.chipDisabled : null,
            pressed && !disabled ? styles.pressed : null,
          ]}
          testID={testID !== undefined ? `${testID}-${tile.key}` : undefined}
        >
          <Text style={[styles.tileTop, { color: quiet }]} numberOfLines={1}>
            {tile.top}
          </Text>
          <Text
            style={[
              styles.tileBig,
              { color: ink },
              fontFamily !== undefined ? themeFontFace(fontFamily) : null,
            ]}
          >
            {tile.big}
          </Text>
          <Text
            style={[styles.tileBottom, { color: quiet }, disabled ? styles.struck : null]}
            numberOfLines={1}
          >
            {tile.bottom}
          </Text>
        </Pressable>
      );
    })}
  </ScrollView>
);

// ─────────────────────────────── radio card ────────────────────────────────

export interface OfferingRadioCardProps {
  palette: ThemePalette;
  title: string;
  detail?: string | null;
  /** The amount on the right, when the choice has one. */
  price?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  fontFamily?: string;
  /** Extra content under the detail (a schedule, a note). */
  children?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

/** A whole-card radio (`.card.on .radio`): dot, title + detail, price. */
export const OfferingRadioCard: React.FC<OfferingRadioCardProps> = ({
  palette,
  title,
  detail = null,
  price = null,
  selected,
  disabled = false,
  onPress,
  fontFamily,
  children,
  accessibilityLabel,
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    disabled={disabled}
    accessibilityRole="radio"
    accessibilityState={{ checked: selected, disabled }}
    // #3859 — the chosen state also reaches the emitted web markup.
    aria-checked={selected}
    accessibilityLabel={
      accessibilityLabel ??
      [title, detail, price].filter((p) => p !== null && p !== "").join(", ")
    }
    style={({ pressed }) => [
      styles.panel,
      { backgroundColor: palette.card, borderColor: palette.panelBorder },
      selected
        ? accentOutline(palette, {
            background: opaqueAccentWashColor(palette),
            opaqueBackground: opaqueAccentWashColor(palette),
          })
        : null,
      disabled ? styles.chipDisabled : null,
      pressed && !disabled ? styles.pressed : null,
    ]}
    testID={testID}
  >
    <View style={styles.radioRow}>
      {/* Chosen: a filled accent disc (gradient-aware) with a page-tone
          centre; not chosen: a quiet ring. */}
      <View
        style={[
          styles.radioDot,
          selected
            ? { ...accentFill(palette), borderColor: "transparent" }
            : { borderColor: palette.secondaryText },
        ]}
      >
        {selected ? (
          <View style={[styles.radioDotFill, { backgroundColor: palette.page }]} />
        ) : null}
      </View>
      <View style={styles.radioText}>
        <Text
          style={[
            styles.rowTitle,
            { color: palette.primaryText },
            fontFamily !== undefined ? themeFontFace(fontFamily) : null,
          ]}
        >
          {title}
        </Text>
        {detail !== null && detail.length > 0 ? (
          <Text style={[styles.rowDetail, { color: palette.secondaryText }]}>
            {detail}
          </Text>
        ) : null}
        {children}
      </View>
      {price !== null && price.length > 0 ? (
        <Text style={[styles.radioPrice, { color: palette.primaryText }]}>
          {price}
        </Text>
      ) : null}
    </View>
  </Pressable>
);

// ─────────────────────────────── big choice ────────────────────────────────

/** One of the two big RSVP answers (`.duo .big`): accent-filled when chosen. */
export const OfferingBigChoice: React.FC<{
  palette: ThemePalette;
  theme?: ResolvedTheme;
  label: string;
  sub?: string | null;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}> = ({
  palette,
  theme,
  label,
  sub = null,
  selected,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    disabled={disabled}
    accessibilityRole="radio"
    accessibilityState={{ checked: selected, disabled }}
    accessibilityLabel={accessibilityLabel ?? (sub !== null ? `${label}, ${sub}` : label)}
    style={({ pressed }) => [
      styles.big,
      selected
        ? { ...accentFill(palette), borderColor: "transparent" }
        : { backgroundColor: palette.card, borderColor: palette.panelBorder },
      disabled ? styles.chipDisabled : null,
      pressed && !disabled ? styles.pressed : null,
    ]}
    testID={testID}
  >
    {selected && theme !== undefined ? (
      <ThemeAccentGradientLayer theme={theme} palette={palette} borderRadius={16} />
    ) : null}
    <Text
      style={[
        styles.bigLabel,
        { color: selected ? palette.accentText : palette.primaryText },
        theme !== undefined ? themeFontFace(boldFontFamily(theme)) : null,
      ]}
    >
      {label}
    </Text>
    {sub !== null ? (
      <Text
        style={[
          styles.bigSub,
          { color: selected ? palette.accentText : palette.secondaryText },
          selected ? styles.bigSubOnFill : null,
        ]}
      >
        {sub}
      </Text>
    ) : null}
  </Pressable>
);

// ───────────────────────────── confirmed tick ──────────────────────────────

/**
 * The accent circle with a tick that springs in (`.done .ok`). Reduced
 * motion: drawn at rest, no animation.
 */
export const OfferingConfirmTick: React.FC<{
  palette: ThemePalette;
  theme?: ResolvedTheme;
  reduceMotion: boolean;
  size?: number;
  testID?: string;
}> = ({ palette, theme, reduceMotion, size = 54, testID }) => {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 480,
      delay: 120,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduceMotion]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  return (
    <View
      style={[
        styles.tickCircle,
        { width: size, height: size, borderRadius: size / 2 },
        accentFill(palette),
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {theme !== undefined ? (
        <ThemeAccentGradientLayer theme={theme} palette={palette} borderRadius={size / 2} />
      ) : null}
      <Animated.View style={{ opacity: progress, transform: [{ scale }] }}>
        <Check size={Math.round(size * 0.48)} color={palette.accentText} strokeWidth={2.6} />
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────── dot list ──────────────────────────────────

/**
 * A quiet bullet list (`.list`): accent dots for what is in, hollow rings for
 * what is not ("Included" / "Not included", house rules).
 */
export const OfferingDotList: React.FC<{
  palette: ThemePalette;
  items: readonly string[];
  kind: "yes" | "no";
  testID?: string;
}> = ({ palette, items, kind, testID }) => (
  <View style={styles.dotList} testID={testID}>
    {items.map((item, i) => (
      <View key={`${i}-${item}`} style={styles.dotRow}>
        <View
          style={[
            styles.dot,
            kind === "yes"
              ? accentFill(palette)
              : { borderWidth: 1.5, borderColor: palette.secondaryText },
          ]}
        />
        <Text style={[styles.dotText, { color: palette.primaryText }]}>{item}</Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  panel: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
  },
  panelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  panelRowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: "700" },
  rowDetail: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPlus: { borderWidth: 0 },
  stepDisabled: { opacity: 0.35 },
  stepValue: {
    minWidth: 30,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 42,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  chipText: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chipNote: { fontSize: 12, fontWeight: "700" },
  chipDisabled: { opacity: 0.38 },
  struck: { textDecorationLine: "line-through" },
  pressed: { opacity: 0.82 },
  strip: { gap: 8, paddingRight: 4 },
  tile: {
    width: 60,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 2,
  },
  tileTop: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tileBig: { fontSize: 19, fontWeight: "700", fontVariant: ["tabular-nums"] },
  tileBottom: { fontSize: 10.5, fontWeight: "500" },
  radioRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioDotFill: { width: 8, height: 8, borderRadius: 4 },
  radioText: { flex: 1, minWidth: 0 },
  radioPrice: {
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  big: {
    flex: 1,
    minHeight: 64,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bigLabel: { fontSize: 16, fontWeight: "700" },
  bigSub: { fontSize: 12, fontWeight: "500", marginTop: 3 },
  bigSubOnFill: { opacity: 0.85 },
  dotList: { gap: 8 },
  dotRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  dotText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20 },
  tickCircle: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
