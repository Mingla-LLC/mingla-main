/**
 * ORCH-0437: Main container for the Near You leaderboard tab.
 * Assembles all leaderboard components + wires hooks.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Text, Keyboard, Pressable, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLeaderboardPresence } from '../../hooks/useLeaderboardPresence';
import { useTagAlongRequests } from '../../hooks/useTagAlongRequests';
import { useMapSettings } from '../../hooks/useMapSettings';
import { leaderboardService } from '../../services/leaderboardService';
import { PreferencesService } from '../../services/preferencesService';
import { useAppStore } from '../../store/appStore';
import { AmbientGradient } from './AmbientGradient';
import { LeaderboardProfileHeader, type LeaderboardProfileHeaderHandle } from './LeaderboardProfileHeader';
import { LeaderboardFilters, type LeaderboardFilterState } from './LeaderboardFilters';
import { LeaderboardCard } from './LeaderboardCard';
import { LeaderboardSkeleton } from './LeaderboardSkeleton';
import { LeaderboardEmptyState } from './LeaderboardEmptyState';
import { TagAlongBanner } from './TagAlongBanner';
import { TagAlongMatchOverlay } from './TagAlongMatchOverlay';
import { colors } from '../../constants/designSystem';
import type { LeaderboardUser, LeaderboardPresenceRow, AcceptTagAlongResponse } from '../../types/leaderboard';
import { leaderboardKeys } from '../../hooks/queryKeys';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LeaderboardFeedProps {
  userLocation: { lat: number; lng: number } | null;
  onOpenPreferences: () => void;
  onOpenSession?: (sessionId: string) => void;
  onDeckPreferencesChanged?: () => void;
}

export function LeaderboardFeed({
  userLocation,
  onOpenPreferences,
  onOpenSession,
  onDeckPreferencesChanged,
}: LeaderboardFeedProps): React.ReactElement {
  const user = useAppStore((s) => s.user);
  const { settings, isLoading: settingsLoading, updateSettings: updateMapSettings } = useMapSettings();
  const headerRef = useRef<LeaderboardProfileHeaderHandle>(null);
  const queryClient = useQueryClient();

  const {
    users,
    isLoading,
    error,
  } = useLeaderboardPresence(userLocation);

  const {
    incomingRequests,
    outgoingRequestIds,
    sendInterest,
    acceptRequest,
    declineRequest,
    isSending,
    isAccepting,
  } = useTagAlongRequests(user?.id);

  // ORCH-0437: Register on leaderboard when tab opens (if discoverable)
  // Initial presence registration moved after allPreferenceCategories declaration

  // Filters
  const [filters, setFilters] = useState<LeaderboardFilterState>({
    radiusKm: 5,
    statuses: [],
    categories: [],
    minSeats: 0,
  });
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);

  // Match overlay state
  const [matchData, setMatchData] = useState<{
    visible: boolean;
    theirAvatarUrl: string | null;
    theirName: string;
    sessionId: string;
  }>({ visible: false, theirAvatarUrl: null, theirName: '', sessionId: '' });

  // Active filter count for the badge
  const activeFilterCount = useMemo((): number => {
    return (filters.radiusKm !== 5 ? 1 : 0) +
      filters.statuses.length +
      filters.categories.length +
      (filters.minSeats > 0 ? 1 : 0);
  }, [filters]);

  // Apply client-side filters
  const filteredUsers = useMemo((): LeaderboardUser[] => {
    return users.filter((u) => {
      if (u.distance_km > filters.radiusKm) return false;
      if (filters.statuses.length > 0 && u.activity_status && !filters.statuses.includes(u.activity_status)) return false;
      if (filters.minSeats > 0) {
        // 5 = "5+" filter (5 or more), others = exact match
        if (filters.minSeats >= 5) {
          if (u.available_seats < 5) return false;
        } else {
          if (u.available_seats !== filters.minSeats) return false;
        }
      }
      if (filters.categories.length > 0) {
        const hasMatch = u.preference_categories.some((c) => filters.categories.includes(c));
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [users, filters]);

  const handleSendInterest = useCallback(async (userId: string): Promise<void> => {
    await sendInterest(userId);
  }, [sendInterest]);

  const handleAcceptRequest = useCallback(async (requestId: string): Promise<void> => {
    const result: AcceptTagAlongResponse = await acceptRequest(requestId);
    const req = incomingRequests.find((r) => r.id === requestId);
    setMatchData({
      visible: true,
      theirAvatarUrl: req?.sender_avatar_url ?? null,
      theirName: req?.sender_display_name ?? 'User',
      sessionId: result.collab_session_id,
    });
  }, [acceptRequest, incomingRequests]);

  const handleExpandRadius = useCallback((): void => {
    const opts = [5, 10, 25, 50, 100];
    const currentIdx = opts.indexOf(filters.radiusKm);
    const nextKm = opts[Math.min(currentIdx + 1, opts.length - 1)] ?? 100;
    setFilters((prev) => ({ ...prev, radiusKm: nextKm }));
  }, [filters.radiusKm]);

  const handleGoToSession = useCallback((sessionId: string): void => {
    setMatchData((prev) => ({ ...prev, visible: false }));
    onOpenSession?.(sessionId);
  }, [onOpenSession]);

  const cardWidth = SCREEN_WIDTH - 32;

  const renderCard = useCallback(({ item }: { item: LeaderboardUser }): React.ReactElement => (
    <LeaderboardCard
      user={item}
      interestSent={outgoingRequestIds.has(item.user_id)}
      onSendInterest={handleSendInterest}
      isSending={isSending}
      cardWidth={cardWidth}
    />
  ), [outgoingRequestIds, handleSendInterest, isSending, cardWidth]);

  const keyExtractor = useCallback((item: LeaderboardUser): string => item.user_id, []);

  const myPresence = users.find((u) => u.user_id === user?.id);
  const profile = useAppStore((s) => s.profile);

  // Fetch accurate level from user_levels table (authoritative, not from presence cache)
  const { data: myLevelData } = useQuery({
    queryKey: leaderboardKeys.userLevel(user?.id ?? ''),
    queryFn: () => leaderboardService.fetchUserLevel(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const myLevel = myLevelData?.level ?? myPresence?.user_level ?? 1;

  // Read user preferences for header display (intents + categories)
  const { data: userPrefs } = useQuery({
    queryKey: ['userPreferences', user?.id],
    queryFn: () => PreferencesService.getUserPreferences(user!.id),
    enabled: !!user?.id,
    staleTime: Infinity, // Same staleTime as DiscoverScreen — cached from preference load
  });

  const userIntents = useMemo((): string[] => {
    if (!userPrefs?.intents) return [];
    return Array.isArray(userPrefs.intents) ? userPrefs.intents : [];
  }, [userPrefs?.intents]);

  const userCategories = useMemo((): string[] => {
    if (!userPrefs?.categories) return [];
    const intentIds = new Set(['adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll']);
    return (Array.isArray(userPrefs.categories) ? userPrefs.categories : []).filter((c: string) => !intentIds.has(c));
  }, [userPrefs?.categories]);

  // Combine intents + categories for presence registration
  const allPreferenceCategories = useMemo((): string[] => {
    return [...userIntents, ...userCategories];
  }, [userIntents, userCategories]);

  // Register on leaderboard when tab opens (if discoverable)
  useEffect(() => {
    if (userLocation && settings?.is_discoverable) {
      leaderboardService.upsertPresence({
        lat: userLocation.lat,
        lng: userLocation.lng,
        is_discoverable: true,
        visibility_level: settings.visibility_level,
        activity_status: settings.activity_status ?? undefined,
        available_seats: settings.available_seats,
        preference_categories: allPreferenceCategories,
      }).then((res) => {
        if (res?.user_level && user?.id) {
          // Update presence cache with accurate level
          queryClient.setQueryData<LeaderboardPresenceRow[]>(
            leaderboardKeys.presence(),
            (old) => old?.map((u) =>
              u.user_id === user.id ? { ...u, user_level: res.user_level } : u
            ) ?? old,
          );
          // Also refresh the level query
          queryClient.invalidateQueries({ queryKey: leaderboardKeys.userLevel(user.id) });
        }
      }).catch((err) => console.warn('[LeaderboardFeed] Initial presence registration failed:', err));
    }
  }, [userLocation?.lat, userLocation?.lng, settings?.is_discoverable, allPreferenceCategories]);

  // ── Inline save handlers (auto-save on change) ──

  const handleVisibilityChange = useCallback((val: boolean): void => {
    updateMapSettings({ is_discoverable: val }).catch((err) =>
      console.warn('[LeaderboardFeed] Visibility save failed:', err));
  }, [updateMapSettings]);

  const handleStatusChange = useCallback((val: string | null): void => {
    updateMapSettings({ activity_status: val }).catch((err) =>
      console.warn('[LeaderboardFeed] Status save failed:', err));
  }, [updateMapSettings]);

  const handleSeatsChange = useCallback((val: number): void => {
    updateMapSettings({ available_seats: val }).catch((err) =>
      console.warn('[LeaderboardFeed] Seats save failed:', err));
  }, [updateMapSettings]);

  const applyDeckChange = useCallback((updater: () => void): void => {
    Alert.alert(
      'Update your deck?',
      'Changing this will refresh your swipeable cards to match your new preferences.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          style: 'default',
          onPress: () => {
            updater();
            onDeckPreferencesChanged?.();
          },
        },
      ],
    );
  }, [onDeckPreferencesChanged]);

  const handleIntentsChange = useCallback((newIntents: string[]): void => {
    if (!user?.id) return;
    applyDeckChange(() => {
      queryClient.setQueryData(['userPreferences', user.id], (old: Record<string, unknown> | undefined) => {
        if (!old) return old;
        return { ...old, intents: newIntents };
      });
      PreferencesService.updateUserPreferences(user.id, { intents: newIntents } as never)
        .catch((err) => console.warn('[LeaderboardFeed] Intents save failed:', err));
    });
  }, [user?.id, queryClient, applyDeckChange]);

  const handleCategoriesChange = useCallback((newCategories: string[]): void => {
    if (!user?.id) return;
    applyDeckChange(() => {
      const merged = [...newCategories, ...userIntents];
      queryClient.setQueryData(['userPreferences', user.id], (old: Record<string, unknown> | undefined) => {
        if (!old) return old;
        return { ...old, categories: merged };
      });
      PreferencesService.updateUserPreferences(user.id, { categories: merged } as never)
        .catch((err) => console.warn('[LeaderboardFeed] Categories save failed:', err));
    });
  }, [user?.id, userIntents, queryClient, applyDeckChange]);

  return (
    <Pressable style={styles.container} onPress={() => { Keyboard.dismiss(); headerRef.current?.collapse(); }}>
      <AmbientGradient />

      {/* Tag-along banners (overlay at top) */}
      <View style={styles.bannerContainer}>
        {incomingRequests.slice(0, 3).map((req) => (
          <TagAlongBanner
            key={req.id}
            request={req}
            onAccept={handleAcceptRequest}
            onDecline={(id) => declineRequest(id)}
            isAccepting={isAccepting}
          />
        ))}
      </View>

      {/* Self-profile header — wait for settings to load to avoid toggle flicker */}
      {!settingsLoading && (
      <View style={styles.headerSection}>
        <LeaderboardProfileHeader
          ref={headerRef}
          avatarUrl={profile?.avatar_url ?? null}
          displayName={profile?.display_name ?? profile?.first_name ?? 'You'}
          level={myLevel}
          status={settings?.activity_status ?? null}
          categories={userCategories}
          intents={userIntents}
          availableSeats={settings?.available_seats ?? 1}
          isDiscoverable={settings?.is_discoverable ?? false}
          activeFilterCount={activeFilterCount}
          onVisibilityChange={handleVisibilityChange}
          onStatusChange={handleStatusChange}
          onIntentsChange={handleIntentsChange}
          onCategoriesChange={handleCategoriesChange}
          onSeatsChange={handleSeatsChange}
          onFilterPress={() => setIsFilterModalVisible(true)}
        />
      </View>
      )}

      {/* Main list */}
      {isLoading ? (
        <LeaderboardSkeleton />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Couldn't load nearby explorers. Check your connection.</Text>
          <Text style={styles.errorRetry}>Pull down to retry.</Text>
        </View>
      ) : filteredUsers.length === 0 ? (
        <LeaderboardEmptyState onExpandRadius={() => setIsFilterModalVisible(true)} />
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderCard}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => { Keyboard.dismiss(); headerRef.current?.collapse(); }}
        />
      )}

      {/* Filter bottom sheet modal */}
      <LeaderboardFilters
        visible={isFilterModalVisible}
        filters={filters}
        onFiltersChange={setFilters}
        onClose={() => setIsFilterModalVisible(false)}
      />

      {/* Match overlay */}
      <TagAlongMatchOverlay
        visible={matchData.visible}
        yourAvatarUrl={profile?.avatar_url ?? null}
        theirAvatarUrl={matchData.theirAvatarUrl}
        theirName={matchData.theirName}
        sessionId={matchData.sessionId}
        onGoToSession={handleGoToSession}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    gap: 8,
  },
  headerSection: {
    paddingTop: 8,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 100,
  },
  errorContainer: {
    padding: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
    textAlign: 'center',
  },
  errorRetry: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.gray[500],
    marginTop: 4,
  },
});
