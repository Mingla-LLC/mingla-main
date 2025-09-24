import React, { useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';

interface ActionItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}

interface FloatingActionButtonProps {
  actions: ActionItem[];
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size?: 'small' | 'medium' | 'large';
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  actions,
  position = 'bottom-right',
  size = 'medium',
  color = colors.primary[500],
  icon = 'add',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const haptic = useHapticFeedback();
  
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const actionScales = useRef(
    actions.map(() => useSharedValue(0))
  ).current;
  const actionOpacities = useRef(
    actions.map(() => useSharedValue(0))
  ).current;

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          buttonSize: 48,
          iconSize: 20,
          actionSize: 40,
          actionIconSize: 16,
        };
      case 'large':
        return {
          buttonSize: 72,
          iconSize: 32,
          actionSize: 56,
          actionIconSize: 24,
        };
      default: // medium
        return {
          buttonSize: 56,
          iconSize: 24,
          actionSize: 48,
          actionIconSize: 20,
        };
    }
  };

  const getPositionStyle = () => {
    const { width, height } = Dimensions.get('window');
    const sizeConfig = getSizeConfig();
    const margin = spacing.lg;

    switch (position) {
      case 'bottom-left':
        return {
          bottom: margin,
          left: margin,
        };
      case 'top-right':
        return {
          top: margin + 50, // Account for status bar
          right: margin,
        };
      case 'top-left':
        return {
          top: margin + 50, // Account for status bar
          left: margin,
        };
      default: // bottom-right
        return {
          bottom: margin,
          right: margin,
        };
    }
  };

  const sizeConfig = getSizeConfig();
  const positionStyle = getPositionStyle();

  const toggleExpanded = () => {
    haptic.selection();
    
    if (isExpanded) {
      // Collapse
      rotation.value = withSpring(0);
      scale.value = withSpring(1);
      
      actions.forEach((_, index) => {
        actionScales[index].value = withSpring(0, {
          damping: 15,
          stiffness: 150,
        });
        actionOpacities[index].value = withTiming(0, { duration: 200 });
      });
    } else {
      // Expand
      rotation.value = withSpring(45);
      scale.value = withSpring(1.1);
      
      actions.forEach((_, index) => {
        const delay = index * 50;
        actionScales[index].value = withSpring(1, {
          damping: 15,
          stiffness: 150,
          delay,
        });
        actionOpacities[index].value = withTiming(1, {
          duration: 200,
          delay,
        });
      });
    }
    
    setIsExpanded(!isExpanded);
  };

  const handleActionPress = (action: ActionItem, index: number) => {
    haptic.light();
    
    // Animate action button press
    actionScales[index].value = withSpring(1.2, {
      damping: 10,
      stiffness: 200,
    }, () => {
      actionScales[index].value = withSpring(1);
    });
    
    // Execute action
    action.onPress();
    
    // Collapse menu
    toggleExpanded();
  };

  const mainButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { rotate: `${rotation.value}deg` },
        { scale: scale.value },
      ],
    };
  });

  const ActionButton = ({ action, index }: { action: ActionItem; index: number }) => {
    const actionStyle = useAnimatedStyle(() => {
      const translateY = interpolate(
        actionScales[index].value,
        [0, 1],
        [0, -(index + 1) * (sizeConfig.actionSize + spacing.sm)],
        Extrapolate.CLAMP
      );

      return {
        transform: [
          { translateY },
          { scale: actionScales[index].value },
        ],
        opacity: actionOpacities[index].value,
      };
    });

    return (
      <Animated.View
        style={[
          styles.actionButton,
          {
            width: sizeConfig.actionSize,
            height: sizeConfig.actionSize,
            borderRadius: sizeConfig.actionSize / 2,
            backgroundColor: action.color,
          },
          actionStyle,
        ]}
      >
        <TouchableOpacity
          style={styles.actionButtonTouchable}
          onPress={() => handleActionPress(action, index)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={action.icon}
            size={sizeConfig.actionIconSize}
            color={colors.text.inverse}
          />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, positionStyle]}>
      {/* Action Buttons */}
      {actions.map((action, index) => (
        <ActionButton key={action.id} action={action} index={index} />
      ))}

      {/* Main FAB */}
      <Animated.View
        style={[
          styles.mainButton,
          {
            width: sizeConfig.buttonSize,
            height: sizeConfig.buttonSize,
            borderRadius: sizeConfig.buttonSize / 2,
            backgroundColor: color,
          },
          mainButtonStyle,
        ]}
      >
        <TouchableOpacity
          style={styles.mainButtonTouchable}
          onPress={toggleExpanded}
          activeOpacity={0.8}
        >
          <Ionicons
            name={icon}
            size={sizeConfig.iconSize}
            color={colors.text.inverse}
          />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 1000,
    alignItems: 'center',
  },
  mainButton: {
    ...shadows.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainButtonTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 50,
  },
  actionButton: {
    position: 'absolute',
    ...shadows.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 50,
  },
});

// Pre-configured FAB presets
export const FABPresets = {
  // Common actions for recommendation cards
  cardActions: (onLike: () => void, onSave: () => void, onShare: () => void) => [
    {
      id: 'like',
      icon: 'heart' as const,
      label: 'Like',
      color: colors.error[500],
      onPress: onLike,
    },
    {
      id: 'save',
      icon: 'bookmark' as const,
      label: 'Save',
      color: colors.primary[500],
      onPress: onSave,
    },
    {
      id: 'share',
      icon: 'share' as const,
      label: 'Share',
      color: colors.success[500],
      onPress: onShare,
    },
  ],

  // Quick navigation actions
  navigationActions: (onHome: () => void, onSearch: () => void, onProfile: () => void) => [
    {
      id: 'home',
      icon: 'home' as const,
      label: 'Home',
      color: colors.primary[500],
      onPress: onHome,
    },
    {
      id: 'search',
      icon: 'search' as const,
      label: 'Search',
      color: colors.warning[500],
      onPress: onSearch,
    },
    {
      id: 'profile',
      icon: 'person' as const,
      label: 'Profile',
      color: colors.success[500],
      onPress: onProfile,
    },
  ],

  // Session management actions
  sessionActions: (onCreate: () => void, onJoin: () => void, onInvite: () => void) => [
    {
      id: 'create',
      icon: 'add-circle' as const,
      label: 'Create Session',
      color: colors.primary[500],
      onPress: onCreate,
    },
    {
      id: 'join',
      icon: 'people' as const,
      label: 'Join Session',
      color: colors.success[500],
      onPress: onJoin,
    },
    {
      id: 'invite',
      icon: 'person-add' as const,
      label: 'Invite Friends',
      color: colors.warning[500],
      onPress: onInvite,
    },
  ],
};
