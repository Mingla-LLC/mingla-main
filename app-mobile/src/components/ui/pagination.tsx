import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from '@expo/vector-icons';

import { cn } from "./utils";
import { Button, buttonVariants } from "./button";

interface PaginationProps {
  style?: any;
  children: React.ReactNode;
}

function Pagination({ style, children, ...props }: PaginationProps) {
  return (
    <View
      style={[styles.pagination, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface PaginationContentProps {
  style?: any;
  children: React.ReactNode;
}

function PaginationContent({ style, children, ...props }: PaginationContentProps) {
  return (
    <View
      style={[styles.paginationContent, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface PaginationItemProps {
  style?: any;
  children: React.ReactNode;
}

function PaginationItem({ style, children, ...props }: PaginationItemProps) {
  return (
    <View
      style={[styles.paginationItem, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface PaginationLinkProps {
  style?: any;
  isActive?: boolean;
  size?: "sm" | "default" | "lg" | "icon";
  onPress?: () => void;
  children: React.ReactNode;
}

function PaginationLink({
  style,
  isActive = false,
  size = "icon",
  onPress,
  children,
  ...props
}: PaginationLinkProps) {
  return (
    <TouchableOpacity
      style={[
        styles.paginationLink,
        isActive ? styles.paginationLinkActive : styles.paginationLinkInactive,
        size === "sm" ? styles.paginationLinkSm : 
        size === "lg" ? styles.paginationLinkLg : 
        size === "icon" ? styles.paginationLinkIcon : styles.paginationLinkDefault,
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

interface PaginationPreviousProps {
  style?: any;
  onPress?: () => void;
}

function PaginationPrevious({ style, onPress, ...props }: PaginationPreviousProps) {
  return (
    <PaginationLink
      size="default"
      onPress={onPress}
      style={[styles.paginationPrevious, style]}
      {...props}
    >
      <Ionicons name="chevron-back" size={16} color="#374151" />
      <Text style={styles.paginationPreviousText}>Previous</Text>
    </PaginationLink>
  );
}

interface PaginationNextProps {
  style?: any;
  onPress?: () => void;
}

function PaginationNext({ style, onPress, ...props }: PaginationNextProps) {
  return (
    <PaginationLink
      size="default"
      onPress={onPress}
      style={[styles.paginationNext, style]}
      {...props}
    >
      <Text style={styles.paginationNextText}>Next</Text>
      <Ionicons name="chevron-forward" size={16} color="#374151" />
    </PaginationLink>
  );
}

interface PaginationEllipsisProps {
  style?: any;
}

function PaginationEllipsis({ style, ...props }: PaginationEllipsisProps) {
  return (
    <View
      style={[styles.paginationEllipsis, style]}
      {...props}
    >
      <Ionicons name="ellipsis-horizontal" size={16} color="#6b7280" />
      <Text style={styles.srOnly}>More pages</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  paginationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  paginationItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paginationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  paginationLinkActive: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  paginationLinkInactive: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  paginationLinkSm: {
    height: 32,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  paginationLinkDefault: {
    height: 36,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  paginationLinkLg: {
    height: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  paginationLinkIcon: {
    width: 36,
    height: 36,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  paginationPrevious: {
    gap: 4,
    paddingHorizontal: 10,
  },
  paginationPreviousText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  paginationNext: {
    gap: 4,
    paddingHorizontal: 10,
  },
  paginationNextText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  paginationEllipsis: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
