import * as React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  style?: any;
  size?: 'sm' | 'md' | 'lg';
}

function Checkbox({
  checked = false,
  onCheckedChange,
  disabled = false,
  style,
  size = 'md',
  ...props
}: CheckboxProps) {
  const handlePress = () => {
    if (!disabled && onCheckedChange) {
      onCheckedChange(!checked);
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return { width: 16, height: 16, iconSize: 10 };
      case 'lg':
        return { width: 24, height: 24, iconSize: 16 };
      default:
        return { width: 20, height: 20, iconSize: 12 };
    }
  };

  const sizeStyles = getSizeStyles();

  return (
    <TouchableOpacity
      style={[
        styles.checkbox,
        {
          width: sizeStyles.width,
          height: sizeStyles.height,
        },
        checked && styles.checked,
        disabled && styles.disabled,
        style,
      ]}
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      {checked && (
        <Ionicons
          name="checkmark"
          size={sizeStyles.iconSize}
          color={checked ? 'white' : '#6b7280'}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  checkbox: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  checked: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  disabled: {
    opacity: 0.5,
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
  },
});

export { Checkbox };
