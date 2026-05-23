import React, { useCallback, useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Sentry from '@sentry/react-native';
import { colors, fontWeights } from '../../../constants/designSystem';
import { useAppStore } from '../../../store/appStore';
import { useUserCircle } from '../../../hooks/useUserCircle';
import type { CirclePerson } from '../../../types/circle';
import { CircleEmptyState } from './CircleEmptyState';
import { CircleGrid } from './CircleGrid';
import { CircleSkeleton } from './CircleSkeleton';

interface YourCircleSectionProps {
  onViewProfile?: (userId: string) => void;
}

export const YourCircleSection: React.FC<YourCircleSectionProps> = ({
  onViewProfile,
}) => {
  const viewerUserId = useAppStore((s) => s.user?.id);
  const {
    people,
    error,
    isLoading,
    isFetching,
    isLoadingMore,
    hasMore,
    loadMore,
    refetch,
  } = useUserCircle(viewerUserId);

  useEffect(() => {
    if (error && people.length > 0) {
      Sentry.captureException(error);
    }
  }, [error, people.length]);

  const handlePressPerson = useCallback((person: CirclePerson) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onViewProfile?.(person.userId);
  }, [onViewProfile]);

  const hasInitialError = !!error && people.length === 0 && !isLoading;
  const showSkeleton = isLoading && people.length === 0;
  const showEmpty = !showSkeleton && !hasInitialError && people.length === 0;

  return (
    <View style={styles.container} testID="your-circle-section">
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Your Circle</Text>
        </View>
      </View>

      {showSkeleton ? <CircleSkeleton /> : null}

      {hasInitialError ? (
        <Pressable
          onPress={() => refetch()}
          style={styles.errorBox}
          accessibilityRole="button"
          accessibilityLabel="Retry loading your circle"
          testID="circle-error-state"
        >
          <Text style={styles.errorText}>{"Couldn't load your circle. Pull to refresh."}</Text>
        </Pressable>
      ) : null}

      {showEmpty ? <CircleEmptyState /> : null}

      {people.length > 0 ? (
        <CircleGrid
          people={people}
          isLoading={isFetching && people.length === 0}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onEndReached={loadMore}
          onPressPerson={handlePressPerson}
        />
      ) : null}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 252,
  },
  header: {
    minHeight: 24,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text.inverse,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.bold,
  },
  errorBox: {
    height: 214,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 14,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  errorText: {
    color: colors.gray[200],
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});

export default YourCircleSection;
