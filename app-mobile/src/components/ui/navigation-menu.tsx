import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { Ionicons } from '@expo/vector-icons';

import { cn } from "./utils";

interface NavigationMenuProps {
  style?: any;
  children: React.ReactNode;
  viewport?: boolean;
}

function NavigationMenu({
  style,
  children,
  viewport = true,
  ...props
}: NavigationMenuProps) {
  return (
    <View
      style={[styles.navigationMenu, style]}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport><View /></NavigationMenuViewport>}
    </View>
  );
}

interface NavigationMenuListProps {
  style?: any;
  children: React.ReactNode;
}

function NavigationMenuList({ style, children, ...props }: NavigationMenuListProps) {
  return (
    <View
      style={[styles.navigationMenuList, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface NavigationMenuItemProps {
  style?: any;
  children: React.ReactNode;
}

function NavigationMenuItem({ style, children, ...props }: NavigationMenuItemProps) {
  return (
    <View
      style={[styles.navigationMenuItem, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface NavigationMenuTriggerProps {
  style?: any;
  children: React.ReactNode;
  onPress?: () => void;
  isOpen?: boolean;
}

function NavigationMenuTrigger({
  style,
  children,
  onPress,
  isOpen = false,
  ...props
}: NavigationMenuTriggerProps) {
  return (
    <TouchableOpacity
      style={[
        styles.navigationMenuTrigger,
        isOpen && styles.navigationMenuTriggerOpen,
        style
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      <Text style={styles.navigationMenuTriggerText}>{children}</Text>
      <Ionicons 
        name="chevron-down" 
        size={12} 
        color="#374151"
        style={[
          styles.navigationMenuTriggerIcon,
          isOpen && styles.navigationMenuTriggerIconOpen
        ]}
      />
    </TouchableOpacity>
  );
}

interface NavigationMenuContentProps {
  style?: any;
  children: React.ReactNode;
  visible?: boolean;
  onClose?: () => void;
}

function NavigationMenuContent({
  style,
  children,
  visible = false,
  onClose,
  ...props
}: NavigationMenuContentProps) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
      {...props}
    >
      <View style={styles.navigationMenuContentOverlay}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.navigationMenuContent, style]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

interface NavigationMenuViewportProps {
  style?: any;
  children: React.ReactNode;
}

function NavigationMenuViewport({ style, children, ...props }: NavigationMenuViewportProps) {
  return (
    <View
      style={[styles.navigationMenuViewport, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface NavigationMenuLinkProps {
  style?: any;
  children: React.ReactNode;
  onPress?: () => void;
  isActive?: boolean;
}

function NavigationMenuLink({
  style,
  children,
  onPress,
  isActive = false,
  ...props
}: NavigationMenuLinkProps) {
  return (
    <TouchableOpacity
      style={[
        styles.navigationMenuLink,
        isActive && styles.navigationMenuLinkActive,
        style
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
}

interface NavigationMenuIndicatorProps {
  style?: any;
  visible?: boolean;
}

function NavigationMenuIndicator({
  style,
  visible = false,
  ...props
}: NavigationMenuIndicatorProps) {
  return (
    <View
      style={[
        styles.navigationMenuIndicator,
        visible && styles.navigationMenuIndicatorVisible,
        style
      ]}
      {...props}
    >
      <View style={styles.navigationMenuIndicatorArrow} />
    </View>
  );
}

const styles = StyleSheet.create({
  navigationMenu: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    maxWidth: '100%',
  },
  navigationMenuList: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 4,
  },
  navigationMenuItem: {
    position: 'relative',
  },
  navigationMenuTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  navigationMenuTriggerOpen: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  navigationMenuTriggerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  navigationMenuTriggerIcon: {
    marginLeft: 4,
    transform: [{ rotate: '0deg' }],
  },
  navigationMenuTriggerIconOpen: {
    transform: [{ rotate: '180deg' }],
  },
  navigationMenuContentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  navigationMenuContent: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    padding: 8,
    minWidth: 200,
    maxWidth: '90%',
  },
  navigationMenuViewport: {
    position: 'absolute',
    top: '100%',
    left: 0,
    zIndex: 50,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  navigationMenuLink: {
    flexDirection: 'column',
    gap: 4,
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  navigationMenuLinkActive: {
    backgroundColor: '#f3f4f6',
  },
  navigationMenuIndicator: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    zIndex: 1,
    height: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    opacity: 0,
  },
  navigationMenuIndicatorVisible: {
    opacity: 1,
  },
  navigationMenuIndicatorArrow: {
    width: 8,
    height: 8,
    backgroundColor: '#e5e7eb',
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
});

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
};
