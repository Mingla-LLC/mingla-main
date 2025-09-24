import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions, PanResponder } from 'react-native';
import { useHapticFeedback } from '../utils/hapticFeedback';
import { colors, spacing } from '../constants/designSystem';

interface GestureShortcut {
  direction: 'up' | 'down' | 'left' | 'right';
  threshold: number;
  onTrigger: () => void;
  haptic?: boolean;
  description?: string;
}

interface GestureShortcutsProps {
  shortcuts: GestureShortcut[];
  children: React.ReactNode;
  enabled?: boolean;
  sensitivity?: number;
}

export const GestureShortcuts: React.FC<GestureShortcutsProps> = ({
  shortcuts,
  children,
  enabled = true,
  sensitivity = 1.0,
}) => {
  const haptic = useHapticFeedback();

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: () => enabled,
    onPanResponderGrant: () => {
      // Gesture started
    },
    onPanResponderMove: (evt, gestureState) => {
      // Gesture is moving
    },
    onPanResponderRelease: (evt, gestureState) => {
      const { dx, dy, vx, vy } = gestureState;
      
      // Check each shortcut
      shortcuts.forEach((shortcut) => {
        const threshold = shortcut.threshold * sensitivity;
        let triggered = false;

        switch (shortcut.direction) {
          case 'up':
            triggered = dy < -threshold || vy < -0.5;
            break;
          case 'down':
            triggered = dy > threshold || vy > 0.5;
            break;
          case 'left':
            triggered = dx < -threshold || vx < -0.5;
            break;
          case 'right':
            triggered = dx > threshold || vx > 0.5;
            break;
        }

        if (triggered) {
          if (shortcut.haptic) {
            haptic.gestureTrigger();
          }
          shortcut.onTrigger();
        }
      });
    },
  });

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {children}
    </View>
  );
};

// Predefined gesture shortcuts for common actions
export const createCommonShortcuts = (actions: {
  onRefresh?: () => void;
  onOpenPreferences?: () => void;
  onGoBack?: () => void;
  onToggleFavorites?: () => void;
}): GestureShortcut[] => {
  const shortcuts: GestureShortcut[] = [];

  if (actions.onRefresh) {
    shortcuts.push({
      direction: 'down',
      threshold: 100,
      onTrigger: actions.onRefresh,
      haptic: true,
      description: 'Pull down to refresh',
    });
  }

  if (actions.onOpenPreferences) {
    shortcuts.push({
      direction: 'up',
      threshold: 100,
      onTrigger: actions.onOpenPreferences,
      haptic: true,
      description: 'Swipe up for preferences',
    });
  }

  if (actions.onGoBack) {
    shortcuts.push({
      direction: 'right',
      threshold: 80,
      onTrigger: actions.onGoBack,
      haptic: true,
      description: 'Swipe right to go back',
    });
  }

  if (actions.onToggleFavorites) {
    shortcuts.push({
      direction: 'left',
      threshold: 80,
      onTrigger: actions.onToggleFavorites,
      haptic: true,
      description: 'Swipe left to toggle favorites',
    });
  }

  return shortcuts;
};

// Gesture indicator component to show available gestures
interface GestureIndicatorProps {
  shortcuts: GestureShortcut[];
  visible?: boolean;
}

export const GestureIndicator: React.FC<GestureIndicatorProps> = ({
  shortcuts,
  visible = false,
}) => {
  if (!visible || shortcuts.length === 0) {
    return null;
  }

  return (
    <View style={styles.indicatorContainer}>
      {shortcuts.map((shortcut, index) => (
        <View key={index} style={styles.indicatorItem}>
          <View style={[
            styles.directionIndicator,
            { backgroundColor: colors.primary[500] }
          ]}>
            {/* Direction arrow would go here */}
          </View>
          <Text style={styles.indicatorText}>
            {shortcut.description || `${shortcut.direction} gesture`}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  indicatorContainer: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.background.primary,
    borderRadius: 12,
    padding: spacing.md,
    shadowColor: colors.gray[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  indicatorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  directionIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicatorText: {
    fontSize: 14,
    color: colors.text.secondary,
    flex: 1,
  },
});
