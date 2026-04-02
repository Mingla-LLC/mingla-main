import React, { useRef, useCallback } from 'react';
import {
  Text,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Icon } from './Icon';
import * as Haptics from 'expo-haptics';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem';

interface CategoryTileProps {
  slug: string;
  name: string;
  icon: string; // Ionicon name
  activeColor: string; // hex from category
  selected: boolean;
  onPress: () => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
// OnboardingShell content: spacing.lg (24) × 2 horizontal padding → 48. One gap between 2 columns (spacing.sm).
const ONBOARDING_CONTENT_PADDING_X = 48;
const CATEGORY_COLUMN_GAP = spacing.sm;
const TILE_WIDTH =
  (SCREEN_WIDTH - ONBOARDING_CONTENT_PADDING_X - CATEGORY_COLUMN_GAP) / 2;
const TILE_HEIGHT = 96;

export const CategoryTile: React.FC<CategoryTileProps> = ({
  slug,
  name,
  icon,
  activeColor,
  selected,
  onPress,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.93,
      tension: 200,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 200,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${name} category`}
    >
      <Animated.View
        style={[
          styles.tile,
          selected
            ? [
                styles.tileSelected,
                { backgroundColor: activeColor, borderColor: activeColor },
                shadows.sm,
              ]
            : styles.tileDefault,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Icon
          name={icon}
          size={28}
          color={selected ? colors.text.inverse : colors.gray[600]}
        />
        <Text
          style={[
            styles.label,
            selected ? styles.labelSelected : styles.labelDefault,
          ]}
          numberOfLines={2}
        >
          {name}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tileDefault: {
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
  },
  tileSelected: {
    borderWidth: 2,
  },
  label: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
    marginTop: 4,
  },
  labelDefault: {
    color: colors.text.primary,
  },
  labelSelected: {
    color: colors.text.inverse,
  },
});
