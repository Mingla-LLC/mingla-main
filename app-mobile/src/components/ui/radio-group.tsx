import * as React from "react";
import { Text, View, StyleSheet } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from './Icon';

import { cn } from "./utils";

interface RadioGroupProps {
  style?: any;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

function RadioGroup({
  style,
  value,
  onValueChange,
  children,
  ...props
}: RadioGroupProps) {
  return (
    <View
      style={[styles.radioGroup, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface RadioGroupItemProps {
  style?: any;
  value: string;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

function RadioGroupItem({
  style,
  value,
  onPress,
  selected = false,
  disabled = false,
  ...props
}: RadioGroupItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="RadioGroup"
      style={[
        styles.radioGroupItem,
        selected && styles.radioGroupItemSelected,
        disabled && styles.radioGroupItemDisabled,
        style
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      <View style={styles.radioGroupItemIndicator}>
        {selected && (
          <View style={styles.radioGroupItemDot}>
            <Icon 
              name="radio-button-on" 
              size={16} 
              color="#059669" 
            />
          </View>
        )}
        {!selected && (
          <View style={styles.radioGroupItemEmpty}>
            <Icon 
              name="radio-button-off" 
              size={16} 
              color="#6b7280" 
            />
          </View>
        )}
      </View>
    </TrackedTouchableOpacity>
  );
}

const styles = StyleSheet.create({
  radioGroup: {
    flexDirection: 'column',
    gap: 12,
  },
  radioGroupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  radioGroupItemSelected: {
    backgroundColor: '#f0f9ff',
  },
  radioGroupItemDisabled: {
    opacity: 0.5,
  },
  radioGroupItemIndicator: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  radioGroupItemDot: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioGroupItemEmpty: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export { RadioGroup, RadioGroupItem };
