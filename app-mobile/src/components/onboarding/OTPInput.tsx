import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  StyleSheet,
  type TextInputProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem';

interface OTPInputProps {
  length: 6;
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  error: boolean;
  disabled: boolean;
  /**
   * #4473 — optional, additive. 'dark' draws the boxes for a dark sheet
   * (dark fill, white digits, orange next box, red error). Omitted = the
   * onboarding look, unchanged.
   */
  tone?: 'light' | 'dark';
  /**
   * #4473 — optional input host, e.g. BottomSheetTextInput, so a sheet can keep
   * the focused code field above the keyboard. Must forward its ref.
   */
  inputComponent?: React.ElementType;
  /** #4473 — iOS: attach the host's own keyboard accessory (Done bar). */
  inputAccessoryViewID?: string;
}

export const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  value,
  onChange,
  onComplete,
  error,
  disabled,
  tone = 'light',
  inputComponent,
  inputAccessoryViewID,
}) => {
  const InputHost = (inputComponent ?? TextInput) as React.ComponentType<
    TextInputProps & React.RefAttributes<TextInput>
  >;
  const dark = tone === 'dark';
  const { t } = useTranslation('onboarding')
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const [showError, setShowError] = useState(false);
  const prevError = useRef(false);

  // Deferred focus: autoFocus inside ScrollView can crash on iOS Fabric.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // Track error state changes to trigger shake
  useEffect(() => {
    if (error && !prevError.current) {
      setShowError(true);

      // Shake animation (skipped when the person asked for reduced motion;
      // the red boxes and the haptic still say what happened).
      void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
        if (reduceMotion) return;
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
      }).catch(() => undefined);

      // #4473 — keep the field focused so the person can type the code again
      // straight away (a host may have dismissed the keyboard to verify).
      inputRef.current?.focus();

      // Haptic error feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Clear error border after 1.5s
      const timer = setTimeout(() => {
        setShowError(false);
      }, 1500);

      return () => clearTimeout(timer);
    }
    prevError.current = error;
  }, [error, shakeAnim]);

  const handleChangeText = useCallback(
    (text: string) => {
      // Only allow digits
      const digits = text.replace(/[^0-9]/g, '').slice(0, length);
      onChange(digits);

      // Auto-submit on 6th digit
      if (digits.length === length) {
        onComplete(digits);
      }
    },
    [length, onChange, onComplete],
  );

  const handlePress = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const digits = value.split('');
  const focusedIndex = value.length < length ? value.length : length - 1;

  return (
    <TouchableWithoutFeedback onPress={handlePress} accessible={false}>
      <Animated.View
        style={[
          styles.container,
          { transform: [{ translateX: shakeAnim }] },
        ]}
      >
        {/* Hidden TextInput receives all keyboard events */}
        <InputHost
          ref={inputRef}
          style={styles.hiddenInput}
          value={value}
          onChangeText={handleChangeText}
          keyboardType="number-pad"
          maxLength={length}
          caretHidden
          editable={!disabled}
          accessibilityLabel={t('otp.otp_accessibility')}
          textContentType="oneTimeCode"
          inputAccessoryViewID={inputAccessoryViewID}
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        />

        {/* Visual boxes */}
        <View style={styles.boxRow}>
          {Array.from({ length }, (_, i) => {
            const isFilled = i < digits.length;
            const isFocused = i === focusedIndex && !disabled;
            const isErrorState = showError;

            const boxStyle = dark
              ? [
                styles.box,
                styles.darkBox,
                isErrorState
                  ? styles.darkBoxError
                  : isFocused && !isFilled
                    ? styles.darkBoxNext
                    : styles.darkBoxIdle,
              ]
              : [
                styles.box,
                isErrorState
                  ? styles.boxError
                  : isFilled
                    ? styles.boxFilled
                    : isFocused
                      ? styles.boxFocused
                      : styles.boxEmpty,
                isFocused && !isErrorState && shadows.sm,
              ];

            return (
              <View key={i} style={boxStyle}>
                <Text style={dark ? styles.darkDigit : styles.digit}>
                  {digits[i] || ''}
                </Text>
              </View>
            );
          })}
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  boxRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  box: {
    width: 48,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  boxEmpty: {
    borderWidth: 1.5,
    borderColor: colors.gray[300],
  },
  boxFilled: {
    borderWidth: 2,
    borderColor: colors.primary[500],
  },
  boxFocused: {
    borderWidth: 2,
    borderColor: colors.primary[500],
  },
  boxError: {
    borderWidth: 2,
    borderColor: colors.error[500],
  },
  darkBox: {
    backgroundColor: '#0b0d11',
    borderRadius: 14,
    borderWidth: 1.5,
  },
  darkBoxIdle: { borderColor: 'rgba(255,255,255,0.16)' },
  darkBoxNext: { borderColor: '#eb7825' },
  darkBoxError: { borderColor: '#f87171' },
  darkDigit: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  digit: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: 'center',
  },
});
