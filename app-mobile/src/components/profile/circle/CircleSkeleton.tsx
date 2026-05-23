import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../../constants/designSystem';
import { CIRCLE_AVATAR_DIAMETER } from './CircleAvatarTile';

const PLACEHOLDER_COLUMNS = 7;
const ROWS_PER_COLUMN = 3;

export const CircleSkeleton: React.FC = () => (
  <View style={styles.container} testID="circle-skeleton">
    {Array.from({ length: PLACEHOLDER_COLUMNS }).map((_, columnIndex) => (
      <View key={columnIndex} style={styles.column}>
        {Array.from({ length: ROWS_PER_COLUMN }).map((__, rowIndex) => (
          <View key={rowIndex} style={styles.circle} />
        ))}
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: {
    height: CIRCLE_AVATAR_DIAMETER * 3 + 16,
    flexDirection: 'row',
    gap: 12,
    overflow: 'hidden',
  },
  column: {
    gap: 8,
  },
  circle: {
    width: CIRCLE_AVATAR_DIAMETER,
    height: CIRCLE_AVATAR_DIAMETER,
    borderRadius: CIRCLE_AVATAR_DIAMETER / 2,
    backgroundColor: colors.gray[800],
    borderColor: colors.gray[700],
    borderWidth: 1,
    opacity: 0.72,
  },
});

export default CircleSkeleton;
