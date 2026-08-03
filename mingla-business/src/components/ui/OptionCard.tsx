/**
 * OptionCard — a CHOICE THAT EXPLAINS ITSELF.
 *
 * Issue #1501 §3. A bare pill labelled "Interchangeable" told an operator
 * nothing; Seth's exact complaint was "the terminology on the add form — don't
 * know what it means." An option is therefore a CARD, not a pill: icon, label,
 * the sentence that makes the label mean something, and a concrete example.
 * If a term needs a popover, the term is wrong — so there are no popovers here,
 * only text that is always visible.
 *
 * SELECTED STATE. The accent lives in the BORDER plus a check glyph, never in
 * the label: the label stays `text.primary` (9.9:1 on the discover canvas) so a
 * selected option is not *harder* to read than an unselected one. Accent-warm
 * text on this canvas is ~4.1:1 and fails at body weight.
 *
 * ANDROID. Translucent glass over the dark canvas composites to an opaque fill
 * from `androidOpaque` (ANDROID_GLASS_USES_OPAQUE_FALLBACK) — no raw hex here.
 *
 * AXIS. `card` carries flex-axis keys and is ROW-ONLY (I-AXIS-SCOPED-FLEX): it
 * is legal exclusively inside a `flexDirection: "row"` parent, which is why the
 * style is named `cardInRow`. A caller that stacks these in a column must not
 * reuse it.
 *
 * Extracted into `ui/` so the Experience wizard can adopt it later; #1501 does
 * NOT refactor that wizard.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  accent,
  androidOpaque,
  glass,
  optionCardMinHeight,
  optionCardMinWidth,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "./Icon";

export interface OptionCardProps {
  /** The approved term. Short, plain, no jargon. */
  label: string;
  /** The sentence that makes the label mean something. Always shown. */
  helper: string;
  /** A concrete instance of the abstraction. Omitted where it would be noise. */
  example?: string;
  /**
   * Optional leading glyph. Accepts any icon component with the lucide shape,
   * so the caller owns the icon vocabulary and this file stays dependency-free.
   */
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export const OptionCard: React.FC<OptionCardProps> = ({
  label,
  helper,
  example,
  icon: IconGlyph,
  selected,
  onPress,
  disabled = false,
  testID,
  style,
}) => {
  const hint = example ? `${helper} For example: ${example}` : helper;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[
        styles.cardInRow,
        selected ? styles.cardSelected : styles.cardIdle,
        disabled ? styles.cardDisabled : null,
        style,
      ]}
    >
      <View style={styles.headRow}>
        {IconGlyph ? (
          <IconGlyph
            size={18}
            color={selected ? accent.warm : textTokens.secondary}
          />
        ) : null}
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {selected ? (
          <View style={styles.checkWrap} testID={`${testID}-check`}>
            <Icon name="check" size={14} color={accent.warm} />
          </View>
        ) : null}
      </View>
      <Text style={styles.helper}>{helper}</Text>
      {example ? (
        <Text style={styles.example}>{`e.g. ${example}`}</Text>
      ) : null}
    </Pressable>
  );
};

/**
 * Android composites the translucent glass to an opaque fill; iOS/web keep the
 * real translucency. Complete objects on both branches — never an override that
 * sets a key to `undefined` (react-native-web keeps the base atom in the DOM).
 */
const IDLE_SURFACE = Platform.select({
  android: {
    backgroundColor: androidOpaque.rowFill,
    borderColor: androidOpaque.rowBorder,
  },
  default: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
}) as ViewStyle;

const SELECTED_SURFACE = Platform.select({
  android: {
    backgroundColor: androidOpaque.accentFill,
    borderColor: accent.warm,
  },
  default: {
    backgroundColor: accent.tint,
    borderColor: accent.warm,
  },
}) as ViewStyle;

const styles = StyleSheet.create({
  // ROW-ONLY (I-AXIS-SCOPED-FLEX). `flexBasis: 0` + `flexGrow: 1` means the
  // cards in a group share the row evenly; `minWidth` makes them wrap rather
  // than crush. Stacking this in a column would resolve the same keys against
  // the HEIGHT — the exact #1501 bug this issue exists to kill.
  cardInRow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: optionCardMinWidth,
    minHeight: optionCardMinHeight,
    gap: spacing.xxs,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardIdle: IDLE_SURFACE,
  cardSelected: {
    ...SELECTED_SURFACE,
    // A selected card is bordered, not merely tinted — the tint alone is too
    // subtle at 0.28 alpha on a dark canvas.
    borderWidth: 1.5,
  },
  cardDisabled: { opacity: 0.55 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // NOT accent-coloured when selected: contrast beats decoration.
  label: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
    flexShrink: 1,
  },
  checkWrap: { marginLeft: "auto" },
  helper: { ...typography.caption, color: textTokens.secondary },
  example: { ...typography.caption, color: textTokens.tertiary },
});

export default OptionCard;
