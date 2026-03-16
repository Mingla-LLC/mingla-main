import * as React from "react";
import { Text, View, StyleSheet, Modal } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from './Icon';

interface DropdownMenuProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenu({ children, style, ...props }: DropdownMenuProps) {
  return (
    <View style={[styles.dropdownMenu, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuPortalProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuPortal({ children, style, ...props }: DropdownMenuPortalProps) {
  return (
    <View style={[styles.portal, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

function DropdownMenuTrigger({ children, onPress, style, ...props }: DropdownMenuTriggerProps) {
  return (
    <TrackedTouchableOpacity logComponent="DropdownMenu"
      style={[styles.trigger, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      {children}
    </TrackedTouchableOpacity>
  );
}

interface DropdownMenuContentProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuContent({ children, style, ...props }: DropdownMenuContentProps) {
  return (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuGroupProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuGroup({ children, style, ...props }: DropdownMenuGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  variant?: "default" | "destructive";
  disabled?: boolean;
  style?: any;
}

function DropdownMenuItem({
  children,
  onPress,
  inset = false,
  variant = "default",
  disabled = false,
  style,
  ...props
}: DropdownMenuItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="DropdownMenu"
      style={[
        styles.item,
        inset && styles.inset,
        variant === "destructive" && styles.destructive,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      {children}
    </TrackedTouchableOpacity>
  );
}

interface DropdownMenuCheckboxItemProps {
  children: React.ReactNode;
  checked?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function DropdownMenuCheckboxItem({
  children,
  checked = false,
  onPress,
  disabled = false,
  style,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="DropdownMenu"
      style={[
        styles.checkboxItem,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      <View style={styles.checkboxIndicator}>
        {checked && (
          <Icon name="checkmark" size={16} color="#eb7825" />
        )}
      </View>
      {children}
    </TrackedTouchableOpacity>
  );
}

interface DropdownMenuRadioGroupProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuRadioGroup({ children, style, ...props }: DropdownMenuRadioGroupProps) {
  return (
    <View style={[styles.radioGroup, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuRadioItemProps {
  children: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function DropdownMenuRadioItem({
  children,
  selected = false,
  onPress,
  disabled = false,
  style,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="DropdownMenu"
      style={[
        styles.radioItem,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      {...props}
    >
      <View style={styles.radioIndicator}>
        {selected && (
          <View style={styles.radioSelected} />
        )}
      </View>
      {children}
    </TrackedTouchableOpacity>
  );
}

interface DropdownMenuLabelProps {
  children: React.ReactNode;
  inset?: boolean;
  style?: any;
}

function DropdownMenuLabel({
  children,
  inset = false,
  style,
  ...props
}: DropdownMenuLabelProps) {
  return (
    <Text
      style={[
        styles.label,
        inset && styles.inset,
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

interface DropdownMenuSeparatorProps {
  style?: any;
}

function DropdownMenuSeparator({ style, ...props }: DropdownMenuSeparatorProps) {
  return (
    <View style={[styles.separator, style]} {...props} />
  );
}

interface DropdownMenuShortcutProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuShortcut({ children, style, ...props }: DropdownMenuShortcutProps) {
  return (
    <Text style={[styles.shortcut, style]} {...props}>
      {children}
    </Text>
  );
}

interface DropdownMenuSubProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuSub({ children, style, ...props }: DropdownMenuSubProps) {
  return (
    <View style={[styles.sub, style]} {...props}>
      {children}
    </View>
  );
}

interface DropdownMenuSubTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  style?: any;
}

function DropdownMenuSubTrigger({
  children,
  onPress,
  inset = false,
  style,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <TrackedTouchableOpacity logComponent="DropdownMenu"
      style={[
        styles.subTrigger,
        inset && styles.inset,
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      {children}
      <Icon name="chevron-forward" size={16} color="#6b7280" style={styles.chevronIcon} />
    </TrackedTouchableOpacity>
  );
}

interface DropdownMenuSubContentProps {
  children: React.ReactNode;
  style?: any;
}

function DropdownMenuSubContent({ children, style, ...props }: DropdownMenuSubContentProps) {
  return (
    <View style={[styles.subContent, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownMenu: {
    flex: 1,
  },
  portal: {
    flex: 1,
  },
  trigger: {
    flex: 1,
  },
  content: {
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 128,
    maxHeight: 300,
  },
  group: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    gap: 8,
  },
  inset: {
    paddingLeft: 32,
  },
  destructive: {
    color: '#dc2626',
  },
  disabled: {
    opacity: 0.5,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    gap: 8,
    paddingLeft: 32,
  },
  checkboxIndicator: {
    position: 'absolute',
    left: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioGroup: {
    flex: 1,
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    gap: 8,
    paddingLeft: 32,
  },
  radioIndicator: {
    position: 'absolute',
    left: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#eb7825',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  separator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 4,
    marginVertical: 4,
  },
  shortcut: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 'auto',
    letterSpacing: 1,
  },
  sub: {
    flex: 1,
  },
  subTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
  },
  chevronIcon: {
    marginLeft: 'auto',
  },
  subContent: {
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 128,
  },
});

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
