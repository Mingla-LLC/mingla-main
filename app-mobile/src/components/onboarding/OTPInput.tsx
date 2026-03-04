import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  Animated,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from 'react-native';
import * as Haptics from 'expo-haptics';
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
}

export const OTPInput: React.FC<OTPInputProps> = ({
  length = 6,
  value,
  onChange,
  onComplete,
  error,
  disabled,
}) => {
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const [showError, setShowError] = useState(false);
  const prevError = useRef(false);

  // Track error state changes to trigger shake
  useEffect(() => {
    if (error && !prevError.current) {
      setShowError(true);

      // Shake animation
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
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={value}
          onChangeText={handleChangeText}
          keyboardType="number-pad"
          maxLength={length}
          autoFocus
          caretHidden
          editable={!disabled}
          accessibilityLabel="One-time verification code"
          textContentType="oneTimeCode"
        />

        {/* Visual boxes */}
        <View style={styles.boxRow}>
          {Array.from({ length }, (_, i) => {
            const isFilled = i < digits.length;
            const isFocused = i === focusedIndex && !disabled;
            const isErrorState = showError;

            const boxStyle = [
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
                <Text style={styles.digit}>
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
  digit: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: 'center',
  },
});
