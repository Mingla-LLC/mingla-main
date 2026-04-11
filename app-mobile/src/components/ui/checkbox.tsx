import React from 'react';
import { TouchableOpacity, View, StyleSheet, ViewStyle } from 'react-native';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: string;
  style?: ViewStyle;
}

export const Checkbox: React.FC<CheckboxProps> = ({ checked, onCheckedChange, disabled }) => {
  return (
    <TouchableOpacity
      onPress={() => onCheckedChange(!checked)}
      disabled={disabled}
      style={[styles.container, checked && styles.checked, disabled && styles.disabled]}
      activeOpacity={0.7}
    >
      {checked && <View style={styles.checkmark} />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  disabled: {
    opacity: 0.5,
  },
  checkmark: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
});
