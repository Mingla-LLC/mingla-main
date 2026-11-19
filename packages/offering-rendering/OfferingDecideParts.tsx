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

import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";

import { accentFill, accentOutline, themeFontFace } from "./themeAccentStyle";
import {
  opaqueAccentWashColor,
  type ThemePalette,
} from "./themePalette";

// ─────────────────────────────── panel card ────────────────────────────────

/** The rounded surface card a decide block sits in (`.card`). */
export interface OfferingPanelProps {
  palette: ThemePalette;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}
export const OfferingPanel = ({ palette, children, style, testID }: OfferingPanelProps) => (
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
export interface OfferingPanelRowProps {
  palette: ThemePalette;
  title: string;
  detail?: string | null;
  fontFamily?: string;
  right?: React.ReactNode;
  testID?: string;
}
export const OfferingPanelRow = ({ palette, title, detail, fontFamily, right, testID }: OfferingPanelRowProps) => (
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

/**
 * − / + drawn with two bars (no SVG), so every host that mounts a stepper,
 * including node render suites with no svg module, draws the same glyph.
 */
const StepGlyph = ({ color, plus }: { color: string; plus: boolean }) => (
  <View style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={[styles.glyphBar, { backgroundColor: color }]} />
    {plus ? (
      <View style={[styles.glyphBar, styles.glyphBarVertical, { backgroundColor: color }]} />
    ) : null}
  </View>
);

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
  /**
   * #4490 N32: the count is a typed number box too (number pad), for ranges
   * where − / + alone means dozens of taps (private hire up to 500, groups
   * of 60+). A typed number outside [min, max] is clamped on blur or Enter,
   * and `onClamp` is told so the page can say why in plain words.
   */
  typeable?: boolean;
  onClamp?: (typed: number, clamped: number) => void;
}

/** Digits only, a number in [min, max] or null when empty (pure). */
export const clampTypedStepperValue = (
  raw: string,
  min: number,
  max: number,
): { typed: number | null; value: number | null } => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return { typed: null, value: null };
  const typed = parseInt(digits, 10);
  return { typed, value: Math.min(max, Math.max(min, typed)) };
};

/** − n + (`.stepper`): outlined minus, ink-filled plus, tabular count. */
export const OfferingStepper = ({
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
  typeable = false,
  onClamp,
}: OfferingStepperProps) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const { typed, value: next } = clampTypedStepperValue(draft, min, max);
    setDraft(null);
    if (typed === null || next === null) return;
    if (next !== value) onChange(next);
    // After onChange, so a page that clears its note on change keeps this one.
    if (typed !== next) onClamp?.(typed, next);
  };
  const canDec = value > min;
  const canInc = value < max;
  // #4490: hitSlop does nothing in a phone browser, so the 36 buttons are drawn 44 there.
  const { width } = useWindowDimensions();
  const touch =
    Platform.OS === "web" && width > 0 && width < 1024
      ? { width: 44, height: 44, borderRadius: 22 }
      : null;
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
          touch,
          { borderColor: palette.panelBorder },
          !canDec ? styles.stepDisabled : null,
        ]}
        testID={testID !== undefined ? `${testID}-dec` : undefined}
      >
        <StepGlyph color={palette.primaryText} plus={false} />
      </Pressable>
      {typeable ? (
        <TextInput
          value={draft ?? String(value)}
          onChangeText={(text) => setDraft(text.replace(/\D/g, "").slice(0, String(max).length))}
          onFocus={() => setDraft(String(value))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          accessibilityLabel={valueLabel ?? String(value)}
          style={[
            styles.stepValue,
            styles.stepInput,
            { color: palette.primaryText, borderColor: palette.panelBorder },
            fontFamily !== undefined ? themeFontFace(fontFamily) : null,
          ]}
          testID={testID !== undefined ? `${testID}-value` : undefined}
        />
      ) : (
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
      )}
      <Pressable
        onPress={canInc ? () => onChange(value + 1) : undefined}
        disabled={!canInc}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
        accessibilityState={{ disabled: !canInc }}
        hitSlop={6}
        style={[
          styles.stepBtn,
          touch,
          styles.stepPlus,
          { backgroundColor: palette.primaryText },
          !canInc ? styles.stepDisabled : null,
        ]}
        testID={testID !== undefined ? `${testID}-inc` : undefined}
      >
        <StepGlyph color={palette.page} plus />
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
  /**
   * issue #2734 — a disabled chip that must stay READABLE (a sold-out
   * reservation time): no dimming and no strike, the label and note in
   * secondary text as "7:30 PM · Full". Default false (dimmed and struck).
   */
  readableWhenDisabled?: boolean;
  testID?: string;
}

/** A pill choice (`.chip`): ink when chosen, struck through when not offered. */
export const OfferingChoiceChip = ({
  palette,
  label,
  note = null,
  selected,
  disabled = false,
  onPress,
  accessibilityLabel,
  role = "radio",
  readableWhenDisabled = false,
  testID,
}: OfferingChoiceChipProps) => {
  const readable = disabled && readableWhenDisabled;
  return (
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
      disabled && !readable ? styles.chipDisabled : null,
      pressed && !disabled ? styles.pressed : null,
    ]}
    testID={testID}
  >
    {readable ? (
      <Text style={[styles.chipText, { color: palette.secondaryText }]} numberOfLines={1}>
        {label}
        {note !== null ? " · " : null}
        {note}
      </Text>
    ) : (
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
    )}
  </Pressable>
  );
};

/** A wrapping row of chips (`.chips`). */
export interface OfferingChipRowProps {
  children?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}
export const OfferingChipRow = ({ children, accessibilityLabel, testID }: OfferingChipRowProps) => (
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
export interface OfferingDateStripProps {
  palette: ThemePalette;
  tiles: readonly OfferingDateTile[];
  onPress: (key: string) => void;
  fontFamily?: string;
  accessibilityLabel?: string;
  testID?: string;
}
export const OfferingDateStrip = ({ palette, tiles, onPress, fontFamily, accessibilityLabel, testID }: OfferingDateStripProps) => (
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
export const OfferingRadioCard = ({
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
}: OfferingRadioCardProps) => (
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

// ─────────────────────────────── dot list ──────────────────────────────────

/**
 * A quiet bullet list (`.list`): accent dots for what is in, hollow rings for
 * what is not ("Included" / "Not included", house rules).
 */
export interface OfferingDotListProps {
  palette: ThemePalette;
  items: readonly string[];
  kind: "yes" | "no";
  testID?: string;
}
interface OfferingDotRowProps {
  /** List key (typed so hosts without React's JSX types accept it). */
  key?: string;
  palette: ThemePalette;
  item: string;
  kind: "yes" | "no";
}
const OfferingDotRow = ({ palette, item, kind }: OfferingDotRowProps) => (
  <View style={styles.dotRow}>
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
);

export const OfferingDotList = ({ palette, items, kind, testID }: OfferingDotListProps) => (
  <View style={styles.dotList} testID={testID}>
    {items.map((item, i) => (
      <OfferingDotRow key={`${i}-${item}`} palette={palette} item={item} kind={kind} />
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
  glyph: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  glyphBar: { position: "absolute", width: 14, height: 2, borderRadius: 1 },
  glyphBarVertical: { transform: [{ rotate: "90deg" }] },
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
  stepInput: {
    width: 64,
    height: 36,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    // #4490 P3: the 44 px touch floor (start times and choices are chips).
    minHeight: 44,
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
  dotList: { gap: 8 },
  dotRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  dotText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20 },
});
