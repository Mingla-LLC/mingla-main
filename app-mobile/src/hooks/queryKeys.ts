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

export const userLevelKeys = {
  all: ['userLevel'] as const,
  level: (userId: string) => [...userLevelKeys.all, userId] as const,
};

export const personCardKeys = {
  all: ['personCards'] as const,
  hero: (pairedUserId: string, holidayKey: string) =>
    [...personCardKeys.all, 'hero', pairedUserId, holidayKey] as const,
  // ORCH-0684 D-Q4: `mode` parameter added so individual / bilateral / shuffle
  // cache separately. Default 'default' preserves backwards-compat with old
  // call sites that pass 3 args.
  paired: (pairedUserId: string, holidayKey: string, locationKey: string, mode: string = 'default') =>
    [...personCardKeys.all, 'paired', pairedUserId, holidayKey, locationKey, mode] as const,
};
