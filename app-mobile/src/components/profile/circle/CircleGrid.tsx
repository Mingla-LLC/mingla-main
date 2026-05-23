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
  CircleAvatarTile,
} from './CircleAvatarTile';

const ROWS_PER_COLUMN = 3;

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
    height: CIRCLE_AVATAR_DIAMETER * 3 + 16,
  },
  content: {
    gap: 12,
    paddingRight: 2,
  },
  column: {
    width: CIRCLE_AVATAR_DIAMETER,
    gap: 8,
  },
  rowSpacer: {
    width: CIRCLE_AVATAR_DIAMETER,
    height: CIRCLE_AVATAR_DIAMETER,
  },
  loadingMoreColumn: {
    width: CIRCLE_AVATAR_DIAMETER,
    height: CIRCLE_AVATAR_DIAMETER * 3 + 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
});

export default CircleGrid;
