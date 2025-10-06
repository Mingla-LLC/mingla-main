import * as React from "react";
import { Text, View, TouchableOpacity, TextInput, StyleSheet, ScrollView, Modal } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface CommandProps {
  children: React.ReactNode;
  style?: any;
}

function Command({ children, style, ...props }: CommandProps) {
  return (
    <View
      style={[styles.command, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface CommandDialogProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  style?: any;
}

function CommandDialog({
  visible,
  onClose,
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  style,
  ...props
}: CommandDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      {...props}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, style]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Text style={styles.modalDescription}>{description}</Text>
          </View>
          <Command style={styles.commandDialog}>
            {children}
          </Command>
        </View>
      </View>
    </Modal>
  );
}

interface CommandInputProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  style?: any;
}

function CommandInput({
  placeholder = "Search...",
  value,
  onChangeText,
  style,
  ...props
}: CommandInputProps) {
  return (
    <View style={[styles.inputWrapper, style]}>
      <Ionicons name="search" size={16} color="#6b7280" style={styles.searchIcon} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#6b7280"
        {...props}
      />
    </View>
  );
}

interface CommandListProps {
  children: React.ReactNode;
  style?: any;
}

function CommandList({ children, style, ...props }: CommandListProps) {
  return (
    <ScrollView
      style={[styles.list, style]}
      showsVerticalScrollIndicator={false}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

interface CommandEmptyProps {
  children?: React.ReactNode;
  style?: any;
}

function CommandEmpty({ children = "No results found.", style, ...props }: CommandEmptyProps) {
  return (
    <View style={[styles.empty, style]} {...props}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

interface CommandGroupProps {
  children: React.ReactNode;
  heading?: string;
  style?: any;
}

function CommandGroup({ children, heading, style, ...props }: CommandGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {heading && (
        <Text style={styles.groupHeading}>{heading}</Text>
      )}
      {children}
    </View>
  );
}

interface CommandSeparatorProps {
  style?: any;
}

function CommandSeparator({ style, ...props }: CommandSeparatorProps) {
  return (
    <View style={[styles.separator, style]} {...props} />
  );
}

interface CommandItemProps {
  children: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  style?: any;
}

function CommandItem({
  children,
  onPress,
  selected = false,
  disabled = false,
  style,
  ...props
}: CommandItemProps) {
  return (
    <TouchableOpacity
      style={[
        styles.item,
        selected && styles.selectedItem,
        disabled && styles.disabledItem,
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

interface CommandShortcutProps {
  children: React.ReactNode;
  style?: any;
}

function CommandShortcut({ children, style, ...props }: CommandShortcutProps) {
  return (
    <Text style={[styles.shortcut, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  command: {
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '100%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  modalDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  commandDialog: {
    maxHeight: 400,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 8,
  },
  list: {
    maxHeight: 300,
  },
  empty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
  },
  group: {
    padding: 4,
  },
  groupHeading: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    paddingHorizontal: 8,
    paddingVertical: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  separator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 4,
  },
  selectedItem: {
    backgroundColor: '#f3f4f6',
  },
  disabledItem: {
    opacity: 0.5,
  },
  shortcut: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 'auto',
    letterSpacing: 1,
  },
});

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
