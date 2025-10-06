import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface DialogProps {
  children: React.ReactNode;
  style?: any;
}

function Dialog({ children, style, ...props }: DialogProps) {
  return (
    <View style={[styles.dialog, style]} {...props}>
      {children}
    </View>
  );
}

interface DialogTriggerProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

function DialogTrigger({ children, onPress, style, ...props }: DialogTriggerProps) {
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

interface DialogPortalProps {
  children: React.ReactNode;
  style?: any;
}

function DialogPortal({ children, style, ...props }: DialogPortalProps) {
  return (
    <View style={[styles.portal, style]} {...props}>
      {children}
    </View>
  );
}

interface DialogCloseProps {
  onPress?: () => void;
  style?: any;
}

function DialogClose({ onPress, style, ...props }: DialogCloseProps) {
  return (
    <TouchableOpacity
      style={[styles.close, style]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      <Ionicons name="close" size={16} color="#6b7280" />
    </TouchableOpacity>
  );
}

interface DialogOverlayProps {
  style?: any;
}

function DialogOverlay({ style, ...props }: DialogOverlayProps) {
  return (
    <View style={[styles.overlay, style]} {...props} />
  );
}

interface DialogContentProps {
  children: React.ReactNode;
  onClose?: () => void;
  style?: any;
}

function DialogContent({ children, onClose, style, ...props }: DialogContentProps) {
  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      {...props}
    >
      <DialogOverlay />
      <View style={[styles.content, style]}>
        {children}
        <DialogClose onPress={onClose} />
      </View>
    </Modal>
  );
}

interface DialogHeaderProps {
  children: React.ReactNode;
  style?: any;
}

function DialogHeader({ children, style, ...props }: DialogHeaderProps) {
  return (
    <View style={[styles.header, style]} {...props}>
      {children}
    </View>
  );
}

interface DialogFooterProps {
  children: React.ReactNode;
  style?: any;
}

function DialogFooter({ children, style, ...props }: DialogFooterProps) {
  return (
    <View style={[styles.footer, style]} {...props}>
      {children}
    </View>
  );
}

interface DialogTitleProps {
  children: React.ReactNode;
  style?: any;
}

function DialogTitle({ children, style, ...props }: DialogTitleProps) {
  return (
    <Text style={[styles.title, style]} {...props}>
      {children}
    </Text>
  );
}

interface DialogDescriptionProps {
  children: React.ReactNode;
  style?: any;
}

function DialogDescription({ children, style, ...props }: DialogDescriptionProps) {
  return (
    <Text style={[styles.description, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  dialog: {
    flex: 1,
  },
  trigger: {
    flex: 1,
  },
  portal: {
    flex: 1,
  },
  close: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 50,
  },
  content: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -150 }, { translateY: -150 }],
    width: '90%',
    maxWidth: 400,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 51,
  },
  header: {
    flexDirection: 'column',
    gap: 8,
    marginBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
