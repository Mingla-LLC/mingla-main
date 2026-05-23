/**
 * PhoneInput — country-picker + local-digits phone field.
 *
 * Per ORCH-0847 Phase A — extracted from
 * `app-mobile/src/components/onboarding/PhoneInput.tsx`. Refactored to accept
 * `iconRenderer` and `labels` props (host app supplies icon set + i18n).
 *
 * Per ORCH-0847 Phase B — added optional `theme` prop so the mingla-business
 * public buyer form (dark canvas) can pass dark-mode colors while app-mobile
 * onboarding (light canvas) keeps the default LIGHT-mode tokens.
 *
 * Behavior preserved verbatim from the original:
 *   - error shake animation (5-step Animated sequence)
 *   - keyboard dismiss + InteractionManager defer before opening picker (Android)
 *   - iOS InputAccessoryView "Done" toolbar (phone-pad has no return key)
 *   - conditional picker mount (no phantom render overhead when hidden)
 *   - phone-pad keyboard with max 15 chars (E.164 max)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Keyboard,
  Platform,
  InputAccessoryView,
  InteractionManager,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { CountryPickerModal } from "./CountryPickerModal";
import { getCountryByCode } from "./countries";
import type {
  IconRenderer,
  PhoneInputLabels,
  PhoneInputTheme,
} from "./types";
import {
  DEFAULT_PHONE_INPUT_THEME,
  fontWeights,
  radius,
  shadowSm,
  spacing,
  typography,
} from "./tokens";

const PHONE_ACCESSORY_ID = "phoneInputDone";

export interface PhoneInputProps {
  value: string;
  /** ISO 3166-1 alpha-2 country code (e.g., 'US'). */
  countryCode: string;
  onChangePhone: (phone: string) => void;
  onChangeCountry: (code: string) => void;
  error: string | null;
  disabled: boolean;
  /** Host app supplies the icon set. Renders chevron-down on country button. */
  iconRenderer: IconRenderer;
  /** Localized strings. Host app supplies translated values. */
  labels: PhoneInputLabels;
  /** Optional theme overrides. Defaults match app-mobile onboarding (LIGHT). */
  theme?: PhoneInputTheme;
  /** iOS phone-pad has no native return key; hosts can opt out of the accessory toolbar. */
  showDoneAccessory?: boolean;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  countryCode,
  onChangePhone,
  onChangeCountry,
  error,
  disabled,
  iconRenderer,
  labels,
  theme,
  showDoneAccessory = true,
}) => {
  const [focused, setFocused] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const prevError = useRef<string | null>(null);

  const t: Required<PhoneInputTheme> = useMemo(
    () => ({ ...DEFAULT_PHONE_INPUT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  const country = getCountryByCode(countryCode);

  // Trigger shake animation when error appears
  useEffect(() => {
    if (error && error !== prevError.current) {
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: -10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -5,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 5,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 0,
          duration: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevError.current = error;
  }, [error, shakeAnim]);

  const handleCountrySelect = useCallback(
    (code: string): void => {
      onChangeCountry(code);
    },
    [onChangeCountry],
  );

  const handleOpenPicker = useCallback((): void => {
    if (disabled) return;
    Keyboard.dismiss();
    InteractionManager.runAfterInteractions(() => {
      setPickerVisible(true);
    });
  }, [disabled]);

  // Render-time inline styles that respect the resolved theme.
  const containerStyle: ViewStyle = {
    ...styles.container,
    backgroundColor: t.backgroundPrimary,
    borderColor: error
      ? t.borderError
      : focused
        ? t.borderFocused
        : t.borderDefault,
  };
  const dialCodeStyle: TextStyle = {
    ...styles.dialCode,
    color: t.textPrimary,
  };
  const dividerStyle: ViewStyle = {
    ...styles.divider,
    backgroundColor: t.divider,
  };
  const textInputStyle: TextStyle = {
    ...styles.textInput,
    color: t.textPrimary,
  };
  const errorTextStyle: TextStyle = {
    ...styles.errorText,
    color: t.errorText,
  };
  const accessoryBarStyle: ViewStyle = {
    ...styles.accessoryBar,
    backgroundColor: t.accessoryBackground,
    borderTopColor: t.accessoryBorder,
  };
  const doneButtonTextStyle: TextStyle = {
    ...styles.doneButtonText,
    color: t.accent,
  };

  return (
    <View>
      <Animated.View
        style={[
          containerStyle,
          focused && !error ? shadowSm : null,
          { transform: [{ translateX: shakeAnim }] },
        ]}
      >
        <TouchableOpacity
          style={styles.countrySection}
          onPress={handleOpenPicker}
          activeOpacity={0.6}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={labels.countryButtonAccessibilityLabel(
            country?.name ?? countryCode,
          )}
        >
          <Text style={styles.flag}>{country?.flag ?? ""}</Text>
          <Text style={dialCodeStyle}>{country?.dialCode ?? "+1"}</Text>
          {iconRenderer("chevronDown", { size: 16, color: t.textTertiary })}
        </TouchableOpacity>

        <View style={dividerStyle} />

        <TextInput
          style={textInputStyle}
          value={value}
          onChangeText={onChangePhone}
          keyboardType="phone-pad"
          returnKeyType="done"
          maxLength={15}
          placeholder={labels.phonePlaceholder}
          placeholderTextColor={t.textTertiary}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={Keyboard.dismiss}
          blurOnSubmit
          inputAccessoryViewID={
            Platform.OS === "ios" && showDoneAccessory ? PHONE_ACCESSORY_ID : undefined
          }
          accessibilityLabel={labels.phoneInputAccessibilityLabel}
        />
      </Animated.View>

      {error ? <Text style={errorTextStyle}>{error}</Text> : null}

      {pickerVisible ? (
        <CountryPickerModal
          visible={pickerVisible}
          selectedCode={countryCode}
          onSelect={handleCountrySelect}
          onClose={() => setPickerVisible(false)}
          iconRenderer={iconRenderer}
          labels={labels}
          theme={theme}
        />
      ) : null}

      {Platform.OS === "ios" && showDoneAccessory ? (
        <InputAccessoryView nativeID={PHONE_ACCESSORY_ID}>
          <View style={accessoryBarStyle}>
            <TouchableOpacity
              onPress={Keyboard.dismiss}
              style={styles.doneButton}
              accessibilityRole="button"
              accessibilityLabel={labels.doneButton}
            >
              <Text style={doneButtonTextStyle}>{labels.doneButton}</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  countrySection: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    height: "100%",
  },
  flag: {
    fontSize: 18,
    marginRight: spacing.xs,
  },
  dialCode: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    marginRight: spacing.xs,
  },
  divider: {
    width: 1,
    alignSelf: "center",
    height: 28,
  },
  textInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: spacing.md,
    ...typography.md,
  },
  errorText: {
    ...typography.sm,
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
  accessoryBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  doneButtonText: {
    fontSize: 17,
    fontWeight: fontWeights.semibold,
  },
});
