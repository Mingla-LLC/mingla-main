import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface MenubarProps {
  children: React.ReactNode;
  style?: any;
}

function Menubar({ children, style, ...props }: MenubarProps) {
  return (
    <View style={[styles.menubar, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarMenuProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarMenu({ children, style, ...props }: MenubarMenuProps) {
  return (
    <View style={[styles.menu, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarGroupProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarGroup({ children, style, ...props }: MenubarGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarPortalProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarPortal({ children, style, ...props }: MenubarPortalProps) {
  return (
    <View style={[styles.portal, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarRadioGroupProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarRadioGroup({ children, style, ...props }: MenubarRadioGroupProps) {
  return (
    <View style={[styles.radioGroup, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

function MenubarTrigger({ children, onPress, style, ...props }: MenubarTriggerProps) {
  return (
    <TouchableOpacity
      style={[styles.trigger, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
}

interface MenubarContentProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarContent({ children, style, ...props }: MenubarContentProps) {
  return (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarItemProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  variant?: "default" | "destructive";
  disabled?: boolean;
  style?: any;
}

function MenubarItem({
  children,
  onPress,
  inset = false,
  variant = "default",
  disabled = false,
  style,
  ...props
}: MenubarItemProps) {
  return (
    <TouchableOpacity
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
    </TouchableOpacity>
  );
}

interface MenubarCheckboxItemProps {
  children: React.ReactNode;
  checked?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function MenubarCheckboxItem({
  children,
  checked = false,
  onPress,
  disabled = false,
  style,
  ...props
}: MenubarCheckboxItemProps) {
  return (
    <TouchableOpacity
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
          <Ionicons name="checkmark" size={16} color="#eb7825" />
        )}
      </View>
      {children}
    </TouchableOpacity>
  );
}

interface MenubarRadioItemProps {
  children: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function MenubarRadioItem({
  children,
  selected = false,
  onPress,
  disabled = false,
  style,
  ...props
}: MenubarRadioItemProps) {
  return (
    <TouchableOpacity
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
    </TouchableOpacity>
  );
}

interface MenubarLabelProps {
  children: React.ReactNode;
  inset?: boolean;
  style?: any;
}

function MenubarLabel({
  children,
  inset = false,
  style,
  ...props
}: MenubarLabelProps) {
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

interface MenubarSeparatorProps {
  style?: any;
}

function MenubarSeparator({ style, ...props }: MenubarSeparatorProps) {
  return (
    <View style={[styles.separator, style]} {...props} />
  );
}

interface MenubarShortcutProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarShortcut({ children, style, ...props }: MenubarShortcutProps) {
  return (
    <Text style={[styles.shortcut, style]} {...props}>
      {children}
    </Text>
  );
}

interface MenubarSubProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarSub({ children, style, ...props }: MenubarSubProps) {
  return (
    <View style={[styles.sub, style]} {...props}>
      {children}
    </View>
  );
}

interface MenubarSubTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  style?: any;
}

function MenubarSubTrigger({
  children,
  onPress,
  inset = false,
  style,
  ...props
}: MenubarSubTriggerProps) {
  return (
    <TouchableOpacity
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
      <Ionicons name="chevron-forward" size={16} color="#6b7280" style={styles.chevronIcon} />
    </TouchableOpacity>
  );
}

interface MenubarSubContentProps {
  children: React.ReactNode;
  style?: any;
}

function MenubarSubContent({ children, style, ...props }: MenubarSubContentProps) {
  return (
    <View style={[styles.subContent, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  menubar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 4,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  menu: {
    flex: 1,
  },
  group: {
    flex: 1,
  },
  portal: {
    flex: 1,
  },
  radioGroup: {
    flex: 1,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
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
    minWidth: 192,
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
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
};
