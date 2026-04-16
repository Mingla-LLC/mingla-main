/**
 * Centralized query key factories.
 *
 * Each domain entity should have exactly one key factory.
 * All mutations that change an entity must invalidate via the factory's `all` prefix.
 *
 * Remaining factories in their original files (not yet consolidated):
 * - friendsKeys: useFriendsQuery.ts
 * - pairingKeys: usePairings.ts
 * - notificationKeys: useNotifications.ts
 * - phoneLookupKeys: usePhoneLookup.ts
 */

export const savedCardKeys = {
  all: ['savedCards'] as const,
  list: (userId: string) => [...savedCardKeys.all, 'list', userId] as const,
  saves: (userId: string) => [...savedCardKeys.all, 'saves', userId] as const,
  paired: (pairedUserId: string, category?: string) =>
    [...savedCardKeys.all, 'paired', pairedUserId, category || 'all'] as const,
  board: (sessionId: string) => [...savedCardKeys.all, 'board', sessionId] as const,
};

export const leaderboardKeys = {
  all: ['leaderboard'] as const,
  presence: () => [...leaderboardKeys.all, 'presence'] as const,
  tagAlongRequests: (userId: string) => [...leaderboardKeys.all, 'tag-along', userId] as const,
  incomingRequests: (userId: string) => [...leaderboardKeys.all, 'incoming', userId] as const,
  userLevel: (userId: string) => [...leaderboardKeys.all, 'level', userId] as const,
};

export const personCardKeys = {
  all: ['personCards'] as const,
  hero: (pairedUserId: string, holidayKey: string) =>
    [...personCardKeys.all, 'hero', pairedUserId, holidayKey] as const,
  paired: (pairedUserId: string, holidayKey: string, locationKey: string) =>
    [...personCardKeys.all, 'paired', pairedUserId, holidayKey, locationKey] as const,
};
