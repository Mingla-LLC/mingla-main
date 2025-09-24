import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights } from '../constants/designSystem';

interface BreadcrumbItem {
  id: string;
  label: string;
  onPress?: () => void;
  isActive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface BreadcrumbNavigationProps {
  items: BreadcrumbItem[];
  separator?: 'chevron' | 'slash' | 'dot';
  maxItems?: number;
  onBack?: () => void;
  showBackButton?: boolean;
}

export const BreadcrumbNavigation: React.FC<BreadcrumbNavigationProps> = ({
  items,
  separator = 'chevron',
  maxItems = 3,
  onBack,
  showBackButton = true,
}) => {
  const getSeparator = () => {
    switch (separator) {
      case 'slash':
        return <Text style={styles.separator}>/</Text>;
      case 'dot':
        return <Text style={styles.separator}>•</Text>;
      default: // chevron
        return (
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.text.secondary}
            style={styles.separator}
          />
        );
    }
  };

  const getDisplayItems = () => {
    if (items.length <= maxItems) {
      return items;
    }

    // Show first item, ellipsis, and last items
    const firstItem = items[0];
    const lastItems = items.slice(-(maxItems - 1));
    
    return [
      firstItem,
      { id: 'ellipsis', label: '...', isActive: false },
      ...lastItems,
    ];
  };

  const displayItems = getDisplayItems();

  return (
    <View style={styles.container}>
      {showBackButton && onBack && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={colors.text.primary}
          />
        </TouchableOpacity>
      )}
      
      <View style={styles.breadcrumbContainer}>
        {displayItems.map((item, index) => {
          const isLast = index === displayItems.length - 1;
          const isClickable = item.onPress && !item.isActive && item.id !== 'ellipsis';
          
          return (
            <React.Fragment key={item.id}>
              <TouchableOpacity
                style={[
                  styles.breadcrumbItem,
                  item.isActive && styles.activeItem,
                ]}
                onPress={isClickable ? item.onPress : undefined}
                disabled={!isClickable}
                activeOpacity={isClickable ? 0.7 : 1}
              >
                {item.icon && (
                  <Ionicons
                    name={item.icon}
                    size={16}
                    color={item.isActive ? colors.primary[500] : colors.text.secondary}
                    style={styles.itemIcon}
                  />
                )}
                <Text
                  style={[
                    styles.itemText,
                    item.isActive && styles.activeText,
                    !isClickable && styles.disabledText,
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
              
              {!isLast && getSeparator()}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
};

// Specialized breadcrumb for navigation flows
interface NavigationBreadcrumbProps {
  currentScreen: string;
  previousScreens?: string[];
  onNavigateBack?: (screen: string) => void;
  onGoHome?: () => void;
}

export const NavigationBreadcrumb: React.FC<NavigationBreadcrumbProps> = ({
  currentScreen,
  previousScreens = [],
  onNavigateBack,
  onGoHome,
}) => {
  const items: BreadcrumbItem[] = [];

  // Add home button
  if (onGoHome) {
    items.push({
      id: 'home',
      label: 'Home',
      icon: 'home-outline',
      onPress: onGoHome,
    });
  }

  // Add previous screens
  previousScreens.forEach((screen, index) => {
    items.push({
      id: `screen-${index}`,
      label: screen,
      onPress: onNavigateBack ? () => onNavigateBack(screen) : undefined,
    });
  });

  // Add current screen
  items.push({
    id: 'current',
    label: currentScreen,
    isActive: true,
  });

  return (
    <BreadcrumbNavigation
      items={items}
      separator="chevron"
      maxItems={4}
      showBackButton={false}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  backButton: {
    marginRight: spacing.sm,
    padding: spacing.xs,
  },
  breadcrumbContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  activeItem: {
    backgroundColor: colors.primary[50],
  },
  itemIcon: {
    marginRight: spacing.xs,
  },
  itemText: {
    ...typography.sm,
    color: colors.text.secondary,
    fontWeight: fontWeights.medium,
  },
  activeText: {
    color: colors.primary[500],
    fontWeight: fontWeights.semibold,
  },
  disabledText: {
    color: colors.text.disabled,
  },
  separator: {
    marginHorizontal: spacing.xs,
    color: colors.text.secondary,
  },
});
