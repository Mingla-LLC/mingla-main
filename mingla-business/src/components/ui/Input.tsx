/**
 * Input — single-line text input primitive.
 *
 * Variants map to `keyboardType` + `secureTextEntry` + autoCapitalize/auto-
 * Complete defaults so callers don't have to remember the right combo per
 * field type. `search` variant injects a leading magnifying-glass icon.
 *
 * Border animates from idle 1px to focus 1.5px `accent.warm` over 120ms.
 *
 * # Phone variant (ORCH-BIZ-0a-E2)
 * Renders a country chip on the left (flag + dial code + chevron-down).
 * Tap opens a Sheet with a hardcoded 12-country list (UK default per
 * Strategic Plan). Caller's `value` carries only the local-number portion;
 * caller reconstructs E.164 from `country.dialCode + value`. The selected
 * country is reported via the optional `onCountryChange` callback. Default
 * country can be overridden via `defaultCountryIso` (ISO 3166-1 alpha-2).
 *
 * # Password variant (ORCH-BIZ-0a-E3)
 * Renders a trailing eye-toggle button. Tap toggles `secureTextEntry`. The
 * eye icon dims when text is visible (no `eye-off` glyph in the Icon set —
 * tracked as D-IMPL-22). The `clearable` prop is intentionally ignored on
 * the password variant to avoid visual conflict with the eye toggle.
 */

import React, { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type {
  StyleProp,
  TextInputProps,
  ViewStyle,
} from "react-native";

type TextInputFocusHandler = NonNullable<TextInputProps["onFocus"]>;
type TextInputFocusEvent = Parameters<TextInputFocusHandler>[0];

import {
  accent,
  durations,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Sheet } from "./Sheet";

// ---------------------------------------------------------------------------
// Phone country list (ORCH-BIZ-0a-E2)
// ---------------------------------------------------------------------------

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  /** English display name. */
  name: string;
  /** E.164 dial code with leading "+". */
  dialCode: string;
  /** Emoji flag — no image asset needed. */
  flag: string;
}

// [TRANSITIONAL] 12-country hardcoded list for Cycle 0a (UK launch + Western
// Europe + English-speaking markets). Cycle 3+ should swap to
// `libphonenumber-js` + a full international list when Mingla expands.
// Tracked as future ORCH (no ID assigned yet — orchestrator triages on demand).
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { iso: "US", name: "United States",  dialCode: "+1",  flag: "🇺🇸" },
  { iso: "IE", name: "Ireland",        dialCode: "+353", flag: "🇮🇪" },
  { iso: "CA", name: "Canada",         dialCode: "+1",  flag: "🇨🇦" },
  { iso: "AU", name: "Australia",      dialCode: "+61", flag: "🇦🇺" },
  { iso: "NZ", name: "New Zealand",    dialCode: "+64", flag: "🇳🇿" },
  { iso: "DE", name: "Germany",        dialCode: "+49", flag: "🇩🇪" },
  { iso: "FR", name: "France",         dialCode: "+33", flag: "🇫🇷" },
  { iso: "NL", name: "Netherlands",    dialCode: "+31", flag: "🇳🇱" },
  { iso: "ES", name: "Spain",          dialCode: "+34", flag: "🇪🇸" },
  { iso: "IT", name: "Italy",          dialCode: "+39", flag: "🇮🇹" },
  { iso: "PL", name: "Poland",         dialCode: "+48", flag: "🇵🇱" },
];

const DEFAULT_PHONE_COUNTRY: PhoneCountry = PHONE_COUNTRIES[0]; // GB

const findCountryByIso = (iso: string | undefined): PhoneCountry => {
  if (iso === undefined) return DEFAULT_PHONE_COUNTRY;
  const match = PHONE_COUNTRIES.find((c) => c.iso === iso.toUpperCase());
  if (match === undefined) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[Input] Unknown defaultCountryIso "${iso}". Falling back to ${DEFAULT_PHONE_COUNTRY.iso}.`);
    }
    return DEFAULT_PHONE_COUNTRY;
  }
  return match;
};

// ---------------------------------------------------------------------------
// Variant behaviour map
// ---------------------------------------------------------------------------

export type InputVariant =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "password"
  | "search";

type VariantBehaviour = Pick<
  TextInputProps,
  "keyboardType" | "autoCapitalize" | "autoComplete" | "autoCorrect"
>;

const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {},
  email: {
    keyboardType: "email-address",
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
  },
  password: {
    autoComplete: "password",
    autoCapitalize: "none",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InputProps
  extends Omit<
    TextInputProps,
    | "value"
    | "onChangeText"
    | "keyboardType"
    | "secureTextEntry"
    | "autoCapitalize"
    | "autoComplete"
    | "autoCorrect"
    | "style"
  > {
  value: string;
  onChangeText: (next: string) => void;
  variant?: InputVariant;
  placeholder?: string;
  leadingIcon?: IconName;
  /**
   * Show the trailing clear (×) button when value is non-empty.
   * Ignored on the `password` variant (visual conflict with the eye toggle).
   */
  clearable?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;

  // Phone-only ----------------------------------------------------------
  /** Default country ISO (alpha-2). Defaults to "GB". Phone variant only. */
  defaultCountryIso?: string;
  /** Fires when the user picks a different country. Phone variant only. */
  onCountryChange?: (country: PhoneCountry) => void;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const HEIGHT = 48;
const PADDING_X = 14;
const ICON_SIZE = 18;
const IDLE_BORDER = "rgba(255, 255, 255, 0.12)";
const BACKGROUND = "rgba(255, 255, 255, 0.04)";
const COUNTRY_CHIP_GAP = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Input: React.FC<InputProps> = ({
  value,
  onChangeText,
  variant = "text",
  placeholder,
  leadingIcon,
  clearable = false,
  disabled = false,
  testID,
  style,
  accessibilityLabel,
  defaultCountryIso,
  onCountryChange,
  onFocus,
  onBlur,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const [secureRevealed, setSecureRevealed] = useState(false);
  const [country, setCountry] = useState<PhoneCountry>(() =>
    findCountryByIso(defaultCountryIso),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const behaviour = VARIANT_BEHAVIOUR[variant];
  const isPhone = variant === "phone";
  const isPassword = variant === "password";
  const secureTextEntry = isPassword && !secureRevealed;

  // Phone variant suppresses the generic leadingIcon prop — the chip occupies
  // that slot. For other variants, fall back to the search auto-icon.
  const resolvedLeadingIcon: IconName | undefined = isPhone
    ? undefined
    : leadingIcon ?? (variant === "search" ? "search" : undefined);

  const handleFocus = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const handleClear = useCallback((): void => {
    onChangeText("");
  }, [onChangeText]);

  const handleToggleSecure = useCallback((): void => {
    setSecureRevealed((prev) => !prev);
  }, []);

  const handleOpenPicker = useCallback((): void => {
    if (!disabled) setPickerOpen(true);
  }, [disabled]);

  const handlePickCountry = useCallback(
    (next: PhoneCountry): void => {
      setCountry(next);
      setPickerOpen(false);
      onCountryChange?.(next);
    },
    [onCountryChange],
  );

  const handleClosePicker = useCallback((): void => {
    setPickerOpen(false);
  }, []);

  // Trailing slot priority: password eye > clear button.
  const showPasswordToggle = isPassword && !disabled;
  const showClear = !isPassword && clearable && value.length > 0 && !disabled;

  return (
    <>
      <View
        testID={testID}
        style={[
          styles.container,
          {
            borderColor: focused ? accent.warm : IDLE_BORDER,
            borderWidth: focused ? 1.5 : 1,
            opacity: disabled ? 0.5 : 1,
          },
          style,
        ]}
      >
        {isPhone ? (
          <Pressable
            onPress={handleOpenPicker}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Country: ${country.name}, ${country.dialCode}. Tap to change.`}
            style={styles.countryChip}
          >
            <Text style={styles.countryFlag}>{country.flag}</Text>
            <Icon name="chevD" size={14} color={textTokens.tertiary} />
          </Pressable>
        ) : null}

        {resolvedLeadingIcon !== undefined ? (
          <View style={styles.leadingIcon}>
            <Icon name={resolvedLeadingIcon} size={ICON_SIZE} color={textTokens.tertiary} />
          </View>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={textTokens.quaternary}
          editable={!disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secureTextEntry}
          underlineColorAndroid="transparent"
          accessibilityLabel={accessibilityLabel ?? placeholder}
          style={[
            styles.input,
            {
              color: textTokens.primary,
              fontSize: typography.body.fontSize,
              lineHeight: typography.body.lineHeight,
              fontWeight: typography.body.fontWeight,
              paddingLeft:
                resolvedLeadingIcon !== undefined ? 0 : PADDING_X,
              paddingRight: showClear || showPasswordToggle ? 0 : PADDING_X,
            },
            Platform.OS === "android"
              ? styles.inputAndroid
              : null,
          ]}
          {...behaviour}
          {...rest}
        />

        {showPasswordToggle ? (
          <Pressable
            onPress={handleToggleSecure}
            accessibilityRole="button"
            accessibilityLabel={secureRevealed ? "Hide password" : "Show password"}
            style={styles.trailingButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name="eye"
              size={ICON_SIZE}
              color={secureRevealed ? textTokens.tertiary : textTokens.primary}
            />
          </Pressable>
        ) : null}

        {showClear ? (
          <Pressable
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear text"
            style={styles.trailingButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={ICON_SIZE} color={textTokens.tertiary} />
          </Pressable>
        ) : null}
      </View>

      {isPhone ? (
        <Sheet visible={pickerOpen} onClose={handleClosePicker} snapPoint="half">
          <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerScrollContent}>
            {PHONE_COUNTRIES.map((c) => {
              const isSelected = c.iso === country.iso;
              return (
                <Pressable
                  key={c.iso}
                  onPress={() => handlePickCountry(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${c.name}, ${c.dialCode}`}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    pressed ? styles.pickerRowPressed : null,
                  ]}
                >
                  <Text style={styles.pickerFlag}>{c.flag}</Text>
                  <View style={styles.pickerLabelCol}>
                    <Text style={styles.pickerName}>{c.name}</Text>
                    <Text style={styles.pickerDialCode}>{c.dialCode}</Text>
                  </View>
                  {isSelected ? (
                    <Icon name="check" size={ICON_SIZE} color={accent.warm} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Sheet>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: HEIGHT,
    borderRadius: radiusTokens.sm,
    backgroundColor: BACKGROUND,
    transitionProperty: "border-color",
    transitionDuration: `${durations.fast}ms`,
  } as ViewStyle,
  leadingIcon: {
    paddingLeft: PADDING_X,
    paddingRight: 8,
    height: "100%",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
  },
  inputAndroid: {
    includeFontPadding: false,
    textAlignVertical: "center",
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  trailingButton: {
    paddingLeft: 8,
    paddingRight: PADDING_X - 2,
    height: "100%",
    justifyContent: "center",
  },
  countryChip: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    paddingLeft: PADDING_X,
    paddingRight: COUNTRY_CHIP_GAP,
    gap: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: glass.border.profileBase,
  },
  countryFlag: {
    fontSize: 18,
  },
  pickerScroll: {
    flex: 1,
  },
  pickerScrollContent: {
    paddingBottom: spacing.lg,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
    gap: spacing.md,
  },
  pickerRowPressed: {
    backgroundColor: glass.tint.profileBase,
  },
  pickerFlag: {
    fontSize: 22,
  },
  pickerLabelCol: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerName: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    flex: 1,
  },
  pickerDialCode: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    marginLeft: spacing.sm,
  },
});

export default Input;
