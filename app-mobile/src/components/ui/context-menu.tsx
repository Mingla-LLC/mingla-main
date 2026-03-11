import * as React from "react";
import { Text, View, StyleSheet, Modal } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';

interface ContextMenuProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenu({ children, style, ...props }: ContextMenuProps) {
  return (
    <View style={[styles.contextMenu, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

function ContextMenuTrigger({ children, onPress, style, ...props }: ContextMenuTriggerProps) {
  return (
    <TrackedTouchableOpacity logComponent="ContextMenu"
      style={[styles.trigger, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      {children}
    </TrackedTouchableOpacity>
  );
}

interface ContextMenuGroupProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuGroup({ children, style, ...props }: ContextMenuGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuPortalProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuPortal({ children, style, ...props }: ContextMenuPortalProps) {
  return (
    <View style={[styles.portal, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuSubProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuSub({ children, style, ...props }: ContextMenuSubProps) {
  return (
    <View style={[styles.sub, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuRadioGroupProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuRadioGroup({ children, style, ...props }: ContextMenuRadioGroupProps) {
  return (
    <View style={[styles.radioGroup, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuSubTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  style?: any;
}

function ContextMenuSubTrigger({
  children,
  onPress,
  inset = false,
  style,
  ...props
}: ContextMenuSubTriggerProps) {
  return (
    <TrackedTouchableOpacity logComponent="ContextMenu"
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
    </TrackedTouchableOpacity>
  );
}

interface ContextMenuSubContentProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuSubContent({ children, style, ...props }: ContextMenuSubContentProps) {
  return (
    <View style={[styles.subContent, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuContentProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuContent({ children, style, ...props }: ContextMenuContentProps) {
  return (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );
}

interface ContextMenuItemProps {
  children: React.ReactNode;
  onPress?: () => void;
  inset?: boolean;
  variant?: "default" | "destructive";
  disabled?: boolean;
  style?: any;
}

function ContextMenuItem({
  children,
  onPress,
  inset = false,
  variant = "default",
  disabled = false,
  style,
  ...props
}: ContextMenuItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="ContextMenu"
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

interface ContextMenuCheckboxItemProps {
  children: React.ReactNode;
  checked?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function ContextMenuCheckboxItem({
  children,
  checked = false,
  onPress,
  disabled = false,
  style,
  ...props
}: ContextMenuCheckboxItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="ContextMenu"
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
    </TrackedTouchableOpacity>
  );
}

interface ContextMenuRadioItemProps {
  children: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
}

function ContextMenuRadioItem({
  children,
  selected = false,
  onPress,
  disabled = false,
  style,
  ...props
}: ContextMenuRadioItemProps) {
  return (
    <TrackedTouchableOpacity logComponent="ContextMenu"
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

interface ContextMenuLabelProps {
  children: React.ReactNode;
  inset?: boolean;
  style?: any;
}

function ContextMenuLabel({
  children,
  inset = false,
  style,
  ...props
}: ContextMenuLabelProps) {
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

interface ContextMenuSeparatorProps {
  style?: any;
}

function ContextMenuSeparator({ style, ...props }: ContextMenuSeparatorProps) {
  return (
    <View style={[styles.separator, style]} {...props} />
  );
}

interface ContextMenuShortcutProps {
  children: React.ReactNode;
  style?: any;
}

function ContextMenuShortcut({ children, style, ...props }: ContextMenuShortcutProps) {
  return (
    <Text style={[styles.shortcut, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  contextMenu: {
    flex: 1,
  },
  trigger: {
    flex: 1,
  },
  group: {
    flex: 1,
  },
  portal: {
    flex: 1,
  },
  sub: {
    flex: 1,
  },
  radioGroup: {
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
});

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
