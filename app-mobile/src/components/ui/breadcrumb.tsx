import * as React from "react";
import { Text, View, StyleSheet } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from './Icon';

function Breadcrumb({ ...props }: React.ComponentProps<typeof View>) {
  return <View aria-label="breadcrumb" data-slot="breadcrumb" {...props} />;
}

interface BreadcrumbListProps {
  children: React.ReactNode;
  style?: any;
}

function BreadcrumbList({ children, style, ...props }: BreadcrumbListProps) {
  return (
    <View
      style={[styles.breadcrumbList, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface BreadcrumbItemProps {
  children: React.ReactNode;
  style?: any;
}

function BreadcrumbItem({ children, style, ...props }: BreadcrumbItemProps) {
  return (
    <View
      style={[styles.breadcrumbItem, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface BreadcrumbLinkProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

function BreadcrumbLink({
  children,
  onPress,
  style,
  ...props
}: BreadcrumbLinkProps) {
  return (
    <TrackedTouchableOpacity logComponent="Breadcrumb"
      style={[styles.breadcrumbLink, style]}
      onPress={onPress}
      {...props}
    >
      {children}
    </TrackedTouchableOpacity>
  );
}

interface BreadcrumbPageProps {
  children: React.ReactNode;
  style?: any;
}

function BreadcrumbPage({ children, style, ...props }: BreadcrumbPageProps) {
  return (
    <Text
      style={[styles.breadcrumbPage, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

interface BreadcrumbSeparatorProps {
  children?: React.ReactNode;
  style?: any;
}

function BreadcrumbSeparator({
  children,
  style,
  ...props
}: BreadcrumbSeparatorProps) {
  return (
    <View
      style={[styles.breadcrumbSeparator, style]}
      {...props}
    >
      {children ?? <Icon name="chevron-forward" size={14} color="#6b7280" />}
    </View>
  );
}

interface BreadcrumbEllipsisProps {
  style?: any;
}

function BreadcrumbEllipsis({
  style,
  ...props
}: BreadcrumbEllipsisProps) {
  return (
    <View
      style={[styles.breadcrumbEllipsis, style]}
      {...props}
    >
      <Icon name="ellipsis-horizontal" size={16} color="#6b7280" />
    </View>
  );
}

const styles = StyleSheet.create({
  breadcrumbList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbLink: {
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  breadcrumbPage: {
    color: '#111827',
    fontSize: 14,
    fontWeight: 'normal',
  },
  breadcrumbSeparator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  breadcrumbEllipsis: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
