import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../../constants/designSystem';
import { CIRCLE_AVATAR_DIAMETER, CIRCLE_TILE_WIDTH } from './CircleAvatarTile';

const PLACEHOLDER_COLUMNS = 7;
const ROWS_PER_COLUMN = 3;
const ROW_GAP = 12;
const VERTICAL_PADDING = 8;

export const CircleSkeleton: React.FC = () => (
  <View style={styles.container} testID="circle-skeleton">
    {Array.from({ length: PLACEHOLDER_COLUMNS }).map((_, columnIndex) => (
      <View key={columnIndex} style={styles.column}>
        {Array.from({ length: ROWS_PER_COLUMN }).map((__, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            <View style={styles.circle} />
            <View style={styles.labelStack}>
              <View style={styles.nameLine} />
              <View style={styles.relationshipLine} />
            </View>
          </View>
        ))}
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: {
    height: CIRCLE_AVATAR_DIAMETER * ROWS_PER_COLUMN + ROW_GAP * 2 + VERTICAL_PADDING * 2,
    flexDirection: 'row',
    gap: 14,
    paddingVertical: VERTICAL_PADDING,
    overflow: 'hidden',
  },
  column: {
    width: CIRCLE_TILE_WIDTH,
    gap: ROW_GAP,
  },
  row: {
    height: CIRCLE_AVATAR_DIAMETER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  labelStack: {
    flex: 1,
    gap: 6,
  },
  nameLine: {
    width: '82%',
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.gray[800],
    opacity: 0.72,
  },
  relationshipLine: {
    width: '64%',
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.gray[800],
    opacity: 0.52,
  },
});

export default CircleSkeleton;
