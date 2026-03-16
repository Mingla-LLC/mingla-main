import * as React from "react";
import { Text, View, StyleSheet, ScrollView, Modal } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from './Icon';

import { cn } from "./utils";

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

function Select({ value, onValueChange, children, ...props }: SelectProps) {
  return (
    <View {...props}>
      {children}
    </View>
  );
}

interface SelectGroupProps {
  children: React.ReactNode;
}

function SelectGroup({ children, ...props }: SelectGroupProps) {
  return (
    <View {...props}>
      {children}
    </View>
  );
}

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

function SelectValue({ placeholder, children, ...props }: SelectValueProps) {
  return (
    <Text {...props}>
      {children || placeholder}
    </Text>
  );
}

interface SelectTriggerProps {
  style?: any;
  size?: "sm" | "default";
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}

function SelectTrigger({
  style,
  size = "default",
  children,
  onPress,
  disabled = false,
  ...props
}: SelectTriggerProps) {
  return (
    <TrackedTouchableOpacity logComponent="Select"
      style={[
        styles.selectTrigger,
        size === "sm" ? styles.selectTriggerSm : styles.selectTriggerDefault,
        disabled && styles.selectTriggerDisabled,
        style
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      <View style={styles.selectTriggerContent}>
        {children}
        <Icon 
          name="chevron-down" 
          size={16} 
          color="#6b7280" 
          style={styles.selectTriggerIcon}
        />
      </View>
    </TrackedTouchableOpacity>
  );
}

interface SelectContentProps {
  style?: any;
  children: React.ReactNode;
  position?: "popper" | "item-aligned";
  visible?: boolean;
  onClose?: () => void;
}

function SelectContent({
  style,
  children,
  position = "popper",
  visible = false,
  onClose,
  ...props
}: SelectContentProps) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      {...props}
    >
      <View style={styles.selectOverlay}>
        <TrackedTouchableOpacity logComponent="Select"
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.selectContent, style]}>
          <ScrollView style={styles.selectViewport}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface SelectLabelProps {
  style?: any;
  children: React.ReactNode;
}

function SelectLabel({ style, children, ...props }: SelectLabelProps) {
  return (
    <Text
      style={[styles.selectLabel, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

interface SelectItemProps {
  style?: any;
  children: React.ReactNode;
  value: string;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

function SelectItem({
  style,
  children,
  value,
  onPress,
  selected = false,
  disabled = false,
  ...props
}: SelectItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="Select"
      style={[
        styles.selectItem,
        selected && styles.selectItemSelected,
        disabled && styles.selectItemDisabled,
        style
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      <View style={styles.selectItemContent}>
        <Text style={styles.selectItemText}>{children}</Text>
        {selected && (
          <Icon 
            name="checkmark" 
            size={16} 
            color="#059669" 
            style={styles.selectItemIcon}
          />
        )}
      </View>
    </TrackedTouchableOpacity>
  );
}

interface SelectSeparatorProps {
  style?: any;
}

function SelectSeparator({ style, ...props }: SelectSeparatorProps) {
  return (
    <View
      style={[styles.selectSeparator, style]}
      {...props}
    />
  );
}

interface SelectScrollUpButtonProps {
  style?: any;
  onPress?: () => void;
}

function SelectScrollUpButton({ style, onPress, ...props }: SelectScrollUpButtonProps) {
  return (
    <TrackedTouchableOpacity logComponent="Select"
      style={[styles.selectScrollButton, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      <Icon name="chevron-up" size={16} color="#6b7280" />
    </TrackedTouchableOpacity>
  );
}

interface SelectScrollDownButtonProps {
  style?: any;
  onPress?: () => void;
}

function SelectScrollDownButton({ style, onPress, ...props }: SelectScrollDownButtonProps) {
  return (
    <TrackedTouchableOpacity logComponent="Select"
      style={[styles.selectScrollButton, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      <Icon name="chevron-down" size={16} color="#6b7280" />
    </TrackedTouchableOpacity>
  );
}

const styles = StyleSheet.create({
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectTriggerDefault: {
    height: 36,
  },
  selectTriggerSm: {
    height: 32,
  },
  selectTriggerDisabled: {
    opacity: 0.5,
  },
  selectTriggerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  selectTriggerIcon: {
    marginLeft: 8,
  },
  selectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  selectContent: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    maxHeight: 300,
    minWidth: 200,
  },
  selectViewport: {
    padding: 4,
  },
  selectLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  selectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    marginVertical: 1,
  },
  selectItemSelected: {
    backgroundColor: '#f3f4f6',
  },
  selectItemDisabled: {
    opacity: 0.5,
  },
  selectItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  selectItemText: {
    fontSize: 14,
    color: '#111827',
    flex: 1,
  },
  selectItemIcon: {
    marginLeft: 8,
  },
  selectSeparator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 4,
    marginVertical: 4,
  },
  selectScrollButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
});

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
