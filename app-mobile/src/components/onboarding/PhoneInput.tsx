import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem';
import { getCountryByCode } from '../../constants/countries';
import { CountryPickerModal } from './CountryPickerModal';

interface PhoneInputProps {
  value: string;
  countryCode: string; // ISO alpha-2
  onChangePhone: (phone: string) => void;
  onChangeCountry: (code: string) => void;
  error: string | null;
  disabled: boolean;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  countryCode,
  onChangePhone,
  onChangeCountry,
  error,
  disabled,
}) => {
  const [focused, setFocused] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const prevError = useRef<string | null>(null);

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
    (code: string) => {
      onChangeCountry(code);
    },
    [onChangeCountry],
  );

  const containerBorderStyle = error
    ? styles.containerError
    : focused
      ? styles.containerFocused
      : styles.containerDefault;

  return (
    <View>
      <Animated.View
        style={[
          styles.container,
          containerBorderStyle,
          focused && !error && shadows.sm,
          { transform: [{ translateX: shakeAnim }] },
        ]}
      >
        {/* Country code section */}
        <TouchableOpacity
          style={styles.countrySection}
          onPress={() => {
            if (!disabled) setPickerVisible(true);
          }}
          activeOpacity={0.6}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Selected country: ${country?.name || countryCode}. Tap to change.`}
        >
          <Text style={styles.flag}>{country?.flag || ''}</Text>
          <Text style={styles.dialCode}>{country?.dialCode || '+1'}</Text>
          <Ionicons
            name="chevron-down"
            size={16}
            color={colors.gray[400]}
          />
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Phone input */}
        <TextInput
          style={styles.textInput}
          value={value}
          onChangeText={onChangePhone}
          keyboardType="phone-pad"
          maxLength={15}
          placeholder="(555) 123-4567"
          placeholderTextColor={colors.gray[400]}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Phone number"
        />
      </Animated.View>

      {/* Error text */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Country picker modal */}
      <CountryPickerModal
        visible={pickerVisible}
        selectedCode={countryCode}
        onSelect={handleCountrySelect}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.background.primary,
  },
  containerDefault: {
    borderWidth: 1.5,
    borderColor: colors.gray[300],
  },
  containerFocused: {
    borderWidth: 2,
    borderColor: colors.primary[500],
  },
  containerError: {
    borderWidth: 2,
    borderColor: colors.error[500],
  },
  countrySection: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 80,
    paddingLeft: spacing.md,
    height: '100%',
  },
  flag: {
    fontSize: 18,
    marginRight: spacing.xs,
  },
  dialCode: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    marginRight: spacing.xs,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.gray[200],
  },
  textInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    ...typography.md,
    color: colors.text.primary,
  },
  errorText: {
    ...typography.sm,
    color: colors.error[500],
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
});
