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
  // Tile height in px. Parent measures the grid's available viewport with
  // onLayout and passes a per-row height so all categories fit at a glance
  // without scrolling — even on small Android devices.
  tileHeight?: number;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// OnboardingShell content: spacing.lg (24) × 2 horizontal padding → 48. Gap between 2 columns (10px).
const ONBOARDING_CONTENT_PADDING_X = 48;
const CATEGORY_COLUMN_GAP = 10;
const TILE_WIDTH =
  (SCREEN_WIDTH - ONBOARDING_CONTENT_PADDING_X - CATEGORY_COLUMN_GAP) / 2;
// Floor used by parent before grid is measured (first paint), and minimum
// readable height that still fits a 22px icon + two-line label.
const TILE_HEIGHT_MIN = 56;

export const CategoryTile: React.FC<CategoryTileProps> = ({
  slug,
  name,
  icon,
  activeColor,
  selected,
  onPress,
  tileHeight,
}) => {
  const resolvedHeight = Math.max(TILE_HEIGHT_MIN, tileHeight ?? TILE_HEIGHT_MIN);
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
          { height: resolvedHeight },
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
          size={22}
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
