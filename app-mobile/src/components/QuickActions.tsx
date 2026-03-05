import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';

interface QuickAction {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

interface QuickActionsProps {
  actions: QuickAction[];
  layout?: 'horizontal' | 'vertical';
  size?: 'small' | 'medium' | 'large';
  showLabels?: boolean;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  actions,
  layout = 'horizontal',
  size = 'medium',
  showLabels = true,
}) => {
  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          buttonSize: 32,
          iconSize: 16,
          fontSize: typography.xs.fontSize,
          spacing: spacing.xs,
        };
      case 'large':
        return {
          buttonSize: 48,
          iconSize: 24,
          fontSize: typography.sm.fontSize,
          spacing: spacing.md,
        };
      default: // medium
        return {
          buttonSize: 40,
          iconSize: 20,
          fontSize: typography.xs.fontSize,
          spacing: spacing.sm,
        };
    }
  };

  const getVariantStyles = (variant: QuickAction['variant'] = 'secondary') => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: colors.primary[500],
          iconColor: colors.background.primary,
          textColor: colors.background.primary,
        };
      case 'danger':
        return {
          backgroundColor: colors.error[500],
          iconColor: colors.background.primary,
          textColor: colors.background.primary,
        };
      default: // secondary
        return {
          backgroundColor: colors.background.secondary,
          iconColor: colors.text.secondary,
          textColor: colors.text.secondary,
        };
    }
  };

  const sizeConfig = getSizeConfig();

  return (
    <View style={[
      styles.container,
      {
        flexDirection: layout === 'horizontal' ? 'row' : 'column',
        gap: sizeConfig.spacing,
      }
    ]}>
      {actions.map((action) => {
        const variantStyles = getVariantStyles(action.variant);
        
        return (
          <TouchableOpacity
            key={action.id}
            style={[
              styles.actionButton,
              {
                width: sizeConfig.buttonSize,
                height: sizeConfig.buttonSize,
                borderRadius: sizeConfig.buttonSize / 2,
                backgroundColor: action.disabled 
                  ? colors.gray[200] 
                  : variantStyles.backgroundColor,
                opacity: action.disabled ? 0.5 : 1,
              },
              shadows.sm,
            ]}
            onPress={action.onPress}
            disabled={action.disabled}
            activeOpacity={0.8}
          >
            <Ionicons
              name={action.icon}
              size={sizeConfig.iconSize}
              color={action.disabled ? colors.gray[400] : variantStyles.iconColor}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Header-specific quick actions component
interface HeaderQuickActionsProps {
  onRefresh?: () => void;
  onShare?: () => void;
  onSave?: () => void;
  onSettings?: () => void;
  showLabels?: boolean;
}

export const HeaderQuickActions: React.FC<HeaderQuickActionsProps> = ({
  onRefresh,
  onShare,
  onSave,
  onSettings,
  showLabels = false,
}) => {
  const actions: QuickAction[] = [];

  if (onRefresh) {
    actions.push({
      id: 'refresh',
      icon: 'refresh',
      label: 'Refresh',
      onPress: onRefresh,
      variant: 'secondary',
    });
  }

  if (onShare) {
    actions.push({
      id: 'share',
      icon: 'share-outline',
      label: 'Share',
      onPress: onShare,
      variant: 'secondary',
    });
  }

  if (onSave) {
    actions.push({
      id: 'save',
      icon: 'bookmark-outline',
      label: 'Save',
      onPress: onSave,
      variant: 'secondary',
    });
  }

  if (onSettings) {
    actions.push({
      id: 'settings',
      icon: 'settings-outline',
      label: 'Settings',
      onPress: onSettings,
      variant: 'secondary',
    });
  }

  return (
    <QuickActions
      actions={actions}
      layout="horizontal"
      size="medium"
      showLabels={showLabels}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  actionButton: {
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
});
