import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItem,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../../../constants/designSystem';
import type { CirclePerson } from '../../../types/circle';
import {
  CIRCLE_AVATAR_DIAMETER,
  CIRCLE_TILE_WIDTH,
  CircleAvatarTile,
} from './CircleAvatarTile';

const ROWS_PER_COLUMN = 3;
const ROW_GAP = 12;
const VERTICAL_PADDING = 8;
const GRID_HEIGHT =
  CIRCLE_AVATAR_DIAMETER * ROWS_PER_COLUMN +
  ROW_GAP * (ROWS_PER_COLUMN - 1) +
  VERTICAL_PADDING * 2;

interface CircleGridProps {
  people: CirclePerson[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onEndReached: () => void;
  onPressPerson: (person: CirclePerson) => void;
}

export function chunkCirclePeopleByColumn(people: CirclePerson[]): CirclePerson[][] {
  return people.reduce<CirclePerson[][]>((columns, person, index) => {
    const columnIndex = Math.floor(index / ROWS_PER_COLUMN);
    const rowIndex = index % ROWS_PER_COLUMN;
    if (!columns[columnIndex]) columns[columnIndex] = [];
    columns[columnIndex][rowIndex] = person;
    return columns;
  }, []);
}

export const CircleGrid: React.FC<CircleGridProps> = ({
  people,
  isLoading,
  isLoadingMore,
  hasMore,
  onEndReached,
  onPressPerson,
}) => {
  const columns = useMemo(() => chunkCirclePeopleByColumn(people), [people]);

  const renderColumn: ListRenderItem<CirclePerson[]> = ({ item, index }) => (
    <View
      style={styles.column}
      testID={`circle-column-${index}`}
      accessibilityLabel={`Circle column ${index + 1}`}
    >
      {item.map((person, rowIndex) => (
        <CircleAvatarTile
          key={person.userId}
          person={person}
          onPress={() => onPressPerson(person)}
        />
      ))}
      {item.length < ROWS_PER_COLUMN
        ? Array.from({ length: ROWS_PER_COLUMN - item.length }).map((_, gapIndex) => (
            <View
              key={`spacer-${gapIndex}`}
              style={styles.rowSpacer}
            />
          ))
        : null}
    </View>
  );

  return (
    <FlatList
      horizontal
      data={columns}
      renderItem={renderColumn}
      keyExtractor={(column, index) =>
        column.map((person) => person.userId).join(':') || `column-${index}`
      }
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.list}
      removeClippedSubviews={false}
      onEndReached={hasMore && !isLoading && !isLoadingMore ? onEndReached : undefined}
      onEndReachedThreshold={0.5}
      windowSize={5}
      maxToRenderPerBatch={10}
      initialNumToRender={15}
      ListFooterComponent={
        isLoadingMore ? (
          <View style={styles.loadingMoreColumn}>
            <ActivityIndicator size="small" color={colors.primary[500]} />
          </View>
        ) : null
      }
      testID="circle-grid"
    />
  );
};

const styles = StyleSheet.create({
  list: {
    height: GRID_HEIGHT,
    overflow: 'visible',
  },
  content: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: VERTICAL_PADDING,
    paddingRight: 8,
  },
  column: {
    width: CIRCLE_TILE_WIDTH,
    gap: ROW_GAP,
  },
  rowSpacer: {
    width: CIRCLE_TILE_WIDTH,
    height: CIRCLE_AVATAR_DIAMETER,
  },
  loadingMoreColumn: {
    width: CIRCLE_TILE_WIDTH,
    height: GRID_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 14,
  },
});

export default CircleGrid;
