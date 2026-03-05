import * as React from "react";
import { Text, View, TouchableOpacity, Modal, StyleSheet, Animated, Dimensions } from "react-native";
import { Ionicons } from '@expo/vector-icons';

import { cn } from "./utils";

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Sheet({ open, onOpenChange, children, ...props }: SheetProps) {
  return (
    <Modal
      visible={open || false}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => onOpenChange?.(false)}
      {...props}
    >
      {children}
    </Modal>
  );
}

interface SheetTriggerProps {
  onPress?: () => void;
  children: React.ReactNode;
}

function SheetTrigger({ onPress, children, ...props }: SheetTriggerProps) {
  return (
    <TouchableOpacity onPress={onPress} {...props}>
      {children}
    </TouchableOpacity>
  );
}

interface SheetCloseProps {
  onPress?: () => void;
  children: React.ReactNode;
}

function SheetClose({ onPress, children, ...props }: SheetCloseProps) {
  return (
    <TouchableOpacity onPress={onPress} {...props}>
      {children}
    </TouchableOpacity>
  );
}

function SheetPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

interface SheetOverlayProps {
  style?: any;
  onPress?: () => void;
}

function SheetOverlay({ style, onPress, ...props }: SheetOverlayProps) {
  return (
    <TouchableOpacity
      style={[styles.sheetOverlay, style]}
      onPress={onPress}
      activeOpacity={1}
      {...props}
    />
  );
}

interface SheetContentProps {
  style?: any;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  onClose?: () => void;
}

function SheetContent({
  style,
  children,
  side = "right",
  onClose,
  ...props
}: SheetContentProps) {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  const getContentStyle = () => {
    const baseStyle = [styles.sheetContent];
    
    switch (side) {
      case "right":
        return [...baseStyle, { 
          right: 0, 
          top: 0, 
          bottom: 0, 
          width: screenWidth * 0.75,
          maxWidth: 400,
          borderLeftWidth: 1,
          borderLeftColor: '#e2e8f0'
        }];
      case "left":
        return [...baseStyle, { 
          left: 0, 
          top: 0, 
          bottom: 0, 
          width: screenWidth * 0.75,
          maxWidth: 400,
          borderRightWidth: 1,
          borderRightColor: '#e2e8f0'
        }];
      case "top":
        return [...baseStyle, { 
          top: 0, 
          left: 0, 
          right: 0, 
          height: 'auto',
          borderBottomWidth: 1,
          borderBottomColor: '#e2e8f0'
        }];
      case "bottom":
        return [...baseStyle, { 
          bottom: 0, 
          left: 0, 
          right: 0, 
          height: 'auto',
          borderTopWidth: 1,
          borderTopColor: '#e2e8f0'
        }];
      default:
        return baseStyle;
    }
  };

  return (
    <SheetPortal>
      <SheetOverlay onPress={onClose} />
      <View style={[getContentStyle(), style]} {...props}>
        {children}
        <TouchableOpacity 
          style={styles.sheetClose}
          onPress={onClose}
        >
          <Ionicons name="close" size={16} color="#6b7280" />
          <Text style={styles.srOnly}>Close</Text>
        </TouchableOpacity>
      </View>
    </SheetPortal>
  );
}

interface SheetHeaderProps {
  style?: any;
  children: React.ReactNode;
}

function SheetHeader({ style, children, ...props }: SheetHeaderProps) {
  return (
    <View
      style={[styles.sheetHeader, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface SheetFooterProps {
  style?: any;
  children: React.ReactNode;
}

function SheetFooter({ style, children, ...props }: SheetFooterProps) {
  return (
    <View
      style={[styles.sheetFooter, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface SheetTitleProps {
  style?: any;
  children: React.ReactNode;
}

function SheetTitle({ style, children, ...props }: SheetTitleProps) {
  return (
    <Text
      style={[styles.sheetTitle, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

interface SheetDescriptionProps {
  style?: any;
  children: React.ReactNode;
}

function SheetDescription({ style, children, ...props }: SheetDescriptionProps) {
  return (
    <Text
      style={[styles.sheetDescription, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 50,
  },
  sheetContent: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    zIndex: 50,
    flexDirection: 'column',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  sheetHeader: {
    flexDirection: 'column',
    gap: 6,
    padding: 16,
  },
  sheetFooter: {
    marginTop: 'auto',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
  },
  sheetTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '600',
  },
  sheetDescription: {
    color: '#64748b',
    fontSize: 14,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    opacity: 0,
  },
});

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
