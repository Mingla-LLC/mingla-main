/**
 * Centralized query key factories.
 *
 * Each domain entity should have exactly one key factory.
 * All mutations that change an entity must invalidate via the factory's `all` prefix.
 *
 * Existing factories (to be consolidated here in Pass 6):
 * - friendsKeys: useFriendsQuery.ts
 * - pairedSavesKeys: usePairedSaves.ts
 * - personHeroCardKeys: usePersonHeroCards.ts
 * - pairedCardKeys: usePairedCards.ts
 * - saveKeys: useSaveQueries.ts
 * - pairingKeys: usePairings.ts
 * - notificationKeys: useNotifications.ts
 * - phoneLookupKeys: usePhoneLookup.ts
 */

export const savedCardKeys = {
  all: ['savedCards'] as const,
  list: (userId: string) => [...savedCardKeys.all, 'list', userId] as const,
  paired: (pairedUserId: string, category?: string) =>
    [...savedCardKeys.all, 'paired', pairedUserId, category || 'all'] as const,
  board: (sessionId: string) => [...savedCardKeys.all, 'board', sessionId] as const,
};
