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
  AccessibilityInfo,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { CountryPickerModal, CountryPickerOverlay } from "./CountryPickerModal";
import { getCountryByCode } from "./countries";
import {
  pickerCloseFocusTarget,
  resolvePickerPresentation,
  type PhoneInputPickerPresentation,
} from "./pickerPresentation";
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
  countryCode: string | null;
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
  /**
   * Which country-picker surface to render. Default `'modal'` — a nested RN
   * <Modal> (CountryPickerModal), used by the standalone buyer-checkout form.
   *
   * Pass `'overlay'` when this PhoneInput itself lives INSIDE another <Modal>
   * (e.g. the RSVP details modal): on react-native-web a <Modal> nested in a
   * <Modal> never opens, freezing the picker (ORCH-1299 dead-tap). `'overlay'`
   * renders CountryPickerOverlay (an in-place fixed-fill picker) on web instead.
   * Native keeps the modal either way (a nested <Modal> works on native RN).
   */
  pickerPresentation?: PhoneInputPickerPresentation;
  testID?: string;
  countryButtonAccessibilityLabel?: string;
  phoneInputAccessibilityLabel?: string;
  required?: boolean;
  maxLength?: number;
  onBlur?: () => void;
}

export const PhoneInput = ({
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
  pickerPresentation = "modal",
  testID,
  countryButtonAccessibilityLabel,
  phoneInputAccessibilityLabel,
  required = false,
  maxLength = 15,
  onBlur,
}: PhoneInputProps): React.ReactElement => {
  const [focused, setFocused] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // ORCH-1299 — resolve the effective picker surface once. `'overlay'` only
  // takes effect on web (nested-<Modal> freeze); native always keeps the modal.
  const usePickerOverlay =
    resolvePickerPresentation(pickerPresentation, Platform.OS) === "overlay";
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const prevError = useRef<string | null>(null);
  const countryTriggerRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const phoneInputRef = useRef<TextInput>(null);
  const countryWasSelected = useRef(false);

  const t: Required<PhoneInputTheme> = useMemo(
    () => ({ ...DEFAULT_PHONE_INPUT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  const country = getCountryByCode(countryCode ?? "");

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  // Trigger shake animation when error appears, unless the platform's reduced
  // motion setting asks us to present the border and alert copy immediately.
  useEffect(() => {
    if (error && error !== prevError.current && !reduceMotion) {
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
    } else if (reduceMotion) {
      shakeAnim.stopAnimation();
      shakeAnim.setValue(0);
    }
    prevError.current = error;
  }, [error, reduceMotion, shakeAnim]);

  const handleCountrySelect = useCallback(
    (code: string): void => {
      countryWasSelected.current = true;
      onChangeCountry(code);
    },
    [onChangeCountry],
  );

  const handlePickerClose = useCallback((): void => {
    setPickerVisible(false);
    const focusTarget = pickerCloseFocusTarget(countryWasSelected.current);
    const target = focusTarget === "phone"
      ? phoneInputRef.current
      : countryTriggerRef.current;
    countryWasSelected.current = false;
    setTimeout(() => target?.focus?.(), 0);
  }, []);

  const handleOpenPicker = useCallback((): void => {
    if (disabled) return;
    Keyboard.dismiss();
    // ORCH-1299 — the ACTUAL dead-tap fix (runtime-proven). On web, DO NOT defer
    // opening the picker behind InteractionManager.runAfterInteractions: the RSVP
    // public page holds a long-running Animated interaction handle (a looping
    // animation), so runAfterInteractions NEVER fires — its callback is queued
    // forever and setPickerVisible(true) never runs, so the picker (CountryPicker
    // Modal OR CountryPickerOverlay) never mounts. `Keyboard.dismiss()` is a no-op
    // on web, so there is nothing to wait for. Native keeps the defer (it exists
    // for Android keyboard-dismiss timing before the full-screen picker slides in).
    if (Platform.OS === "web") {
      setPickerVisible(true);
      return;
    }
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
          ref={countryTriggerRef}
          style={styles.countrySection}
          onPress={handleOpenPicker}
          activeOpacity={0.6}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={countryButtonAccessibilityLabel ?? (
            country === undefined
              ? "Select country"
              : labels.countryButtonAccessibilityLabel(country.name)
          )}
          accessibilityState={{ disabled }}
          testID={testID ? `${testID}-country` : undefined}
        >
          {country === undefined ? (
            <Text style={dialCodeStyle}>Select country</Text>
          ) : (
            <>
              <Text style={styles.flag}>{country.flag}</Text>
              <Text style={dialCodeStyle}>{country.dialCode}</Text>
            </>
          )}
          {iconRenderer("chevronDown", { size: 16, color: t.textTertiary })}
        </TouchableOpacity>

        <View style={dividerStyle} />

        <TextInput
          ref={phoneInputRef}
          style={textInputStyle}
          value={value}
          onChangeText={onChangePhone}
          keyboardType="phone-pad"
          returnKeyType="done"
          maxLength={maxLength}
          placeholder={labels.phonePlaceholder}
          placeholderTextColor={t.textTertiary}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onSubmitEditing={Keyboard.dismiss}
          blurOnSubmit
          inputAccessoryViewID={
            Platform.OS === "ios" && showDoneAccessory ? PHONE_ACCESSORY_ID : undefined
          }
          accessibilityLabel={`${phoneInputAccessibilityLabel ?? labels.phoneInputAccessibilityLabel}${required ? ", required" : ""}`}
          accessibilityState={{ disabled }}
          testID={testID ? `${testID}-input` : undefined}
        />
      </Animated.View>

      {error ? (
        <Text
          style={errorTextStyle}
          accessibilityRole="alert"
          aria-live="polite"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : null}

      {pickerVisible ? (
        usePickerOverlay ? (
          // ORCH-1299 — in-place overlay (NOT a nested <Modal>) for the RSVP
          // details-modal context, where a nested <Modal> freezes on web.
          <CountryPickerOverlay
            selectedCode={countryCode}
            onSelect={handleCountrySelect}
            onClose={handlePickerClose}
            iconRenderer={iconRenderer}
            labels={labels}
            theme={theme}
          />
        ) : (
          <CountryPickerModal
            visible={pickerVisible}
            selectedCode={countryCode}
            onSelect={handleCountrySelect}
            onClose={handlePickerClose}
            iconRenderer={iconRenderer}
            labels={labels}
            theme={theme}
          />
        )
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
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  countrySection: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    minHeight: 56,
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
    minHeight: 56,
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
