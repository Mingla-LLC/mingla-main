/**
 * ORCH-0437: Main container for the Near You leaderboard tab.
 * Assembles all leaderboard components + wires hooks.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Text } from 'react-native';
import { useLeaderboardPresence } from '../../hooks/useLeaderboardPresence';
import { useTagAlongRequests } from '../../hooks/useTagAlongRequests';
import { useMapSettings } from '../../hooks/useMapSettings';
import { leaderboardService } from '../../services/leaderboardService';
import { useAppStore } from '../../store/appStore';
import { AmbientGradient } from './AmbientGradient';
import { LeaderboardProfileHeader } from './LeaderboardProfileHeader';
import { LeaderboardFilters, type LeaderboardFilterState } from './LeaderboardFilters';
import { LeaderboardCard } from './LeaderboardCard';
import { LeaderboardSkeleton } from './LeaderboardSkeleton';
import { LeaderboardEmptyState } from './LeaderboardEmptyState';
import { TagAlongBanner } from './TagAlongBanner';
import { TagAlongMatchOverlay } from './TagAlongMatchOverlay';
import { colors } from '../../constants/designSystem';
import type { LeaderboardUser, AcceptTagAlongResponse } from '../../types/leaderboard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LeaderboardFeedProps {
  userLocation: { lat: number; lng: number } | null;
  onOpenPreferences: () => void;
  onOpenSession?: (sessionId: string) => void;
}

export function LeaderboardFeed({
  userLocation,
  onOpenPreferences,
  onOpenSession,
}: LeaderboardFeedProps): React.ReactElement {
  const user = useAppStore((s) => s.user);
  const { settings } = useMapSettings();

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
  useEffect(() => {
    if (userLocation && settings?.is_discoverable) {
      leaderboardService.upsertPresence({
        lat: userLocation.lat,
        lng: userLocation.lng,
        is_discoverable: true,
        visibility_level: settings.visibility_level,
        activity_status: settings.activity_status ?? undefined,
        available_seats: settings.available_seats,
      }).catch((err) => console.warn('[LeaderboardFeed] Initial presence registration failed:', err));
    }
  }, [userLocation?.lat, userLocation?.lng, settings?.is_discoverable]);

  // Filters
  const [filters, setFilters] = useState<LeaderboardFilterState>({
    radiusKm: 5,
    statuses: [],
    categories: [],
    minSeats: 0,
  });

  // Match overlay state
  const [matchData, setMatchData] = useState<{
    visible: boolean;
    theirAvatarUrl: string | null;
    theirName: string;
    sessionId: string;
  }>({ visible: false, theirAvatarUrl: null, theirName: '', sessionId: '' });

  // Apply client-side filters
  const filteredUsers = useMemo((): LeaderboardUser[] => {
    return users.filter((u) => {
      if (u.distance_km > filters.radiusKm) return false;
      if (filters.statuses.length > 0 && u.activity_status && !filters.statuses.includes(u.activity_status)) return false;
      if (filters.minSeats > 0 && u.available_seats < filters.minSeats) return false;
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
    // Show match overlay
    const req = incomingRequests.find((r) => r.id === requestId);
    setMatchData({
      visible: true,
      theirAvatarUrl: req?.sender_avatar_url ?? null,
      theirName: req?.sender_display_name ?? 'User',
      sessionId: result.collab_session_id,
    });
  }, [acceptRequest, incomingRequests]);

  const handleExpandRadius = useCallback((): void => {
    const currentIdx = [1, 5, 10, 25, 50, 100].indexOf(filters.radiusKm);
    const nextKm = [1, 5, 10, 25, 50, 100][Math.min(currentIdx + 1, 5)] ?? 100;
    setFilters((prev) => ({ ...prev, radiusKm: nextKm }));
  }, [filters.radiusKm]);

  const handleGoToSession = useCallback((sessionId: string): void => {
    setMatchData((prev) => ({ ...prev, visible: false }));
    onOpenSession?.(sessionId);
  }, [onOpenSession]);

  const cardWidth = SCREEN_WIDTH - 32; // 16px margins each side

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

  // Profile header data
  const myPresence = users.find((u) => u.user_id === user?.id);
  const profile = useAppStore((s) => s.user);

  return (
    <View style={styles.container}>
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

      {/* Self-profile header */}
      <View style={styles.headerSection}>
        <LeaderboardProfileHeader
          avatarUrl={profile?.avatar_url ?? null}
          displayName={profile?.display_name ?? profile?.first_name ?? 'You'}
          level={myPresence?.user_level ?? 1}
          status={settings?.activity_status ?? null}
          categories={myPresence?.preference_categories ?? []}
          availableSeats={settings?.available_seats ?? 1}
          activeMinutes={myPresence?.active_for_minutes ?? 0}
          isDiscoverable={settings?.is_discoverable ?? false}
          swipeCount={myPresence?.swipe_count ?? 0}
          onPress={onOpenPreferences}
        />
      </View>

      {/* Filters */}
      <View style={styles.filterSection}>
        <LeaderboardFilters filters={filters} onFiltersChange={setFilters} />
      </View>

      {/* Main list */}
      {isLoading ? (
        <LeaderboardSkeleton />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Couldn't load nearby explorers. Check your connection.</Text>
          <Text style={styles.errorRetry}>Pull down to retry.</Text>
        </View>
      ) : filteredUsers.length === 0 ? (
        <LeaderboardEmptyState onExpandRadius={handleExpandRadius} />
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderCard}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          // [TRANSITIONAL] Using FlatList — FlashList not installed. Exit: install @shopify/flash-list
        />
      )}

      {/* Match overlay */}
      <TagAlongMatchOverlay
        visible={matchData.visible}
        yourAvatarUrl={profile?.avatar_url ?? null}
        theirAvatarUrl={matchData.theirAvatarUrl}
        theirName={matchData.theirName}
        sessionId={matchData.sessionId}
        onGoToSession={handleGoToSession}
      />
    </View>
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
  filterSection: {
    marginTop: 8,
  },
  listContent: {
    paddingTop: 10,
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
