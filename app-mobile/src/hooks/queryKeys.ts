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

// META-ORCH-1161 Sub-A — consumer notification-preferences matrix.
// One factory for the (categories + user channel prefs) read; the toggle
// mutation invalidates via notificationPrefsKeys.matrix(userId).
export const notificationPrefsKeys = {
  all: ['notificationPrefs'] as const,
  matrix: (userId: string) =>
    [...notificationPrefsKeys.all, 'matrix', userId] as const,
};

export const chatKeys = {
  all: ['chat'] as const,
  participants: (conversationId: string | null) =>
    [...chatKeys.all, 'participants', conversationId ?? 'none'] as const,
};

export const userLevelKeys = {
  all: ['userLevel'] as const,
  level: (userId: string) => [...userLevelKeys.all, userId] as const,
};

export const circleKeys = {
  all: ['circle'] as const,
  forUser: (viewerUserId: string) =>
    [...circleKeys.all, 'user', viewerUserId] as const,
  page: (viewerUserId: string, limit: number, offset: number) =>
    [...circleKeys.forUser(viewerUserId), { limit, offset }] as const,
};

// ORCH-1339 — cross-entity social proof (pg_public_social_proof payload).
// One key per event id; the three consumer detail screens read it (staleTime
// refresh only — no client mutation invalidates it in this leg).
export const socialProofKeys = {
  all: ['socialProof'] as const,
  summary: (eventId: string) => [...socialProofKeys.all, eventId] as const,
};

// ORCH-1341 — consumer guest-list sheet (peer_list_event_guests payload).
// One key per event id; useEventGuestList is the sole reader and pins
// staleTime 0 + gcTime 0 (fresh fetch on every sheet open — DESIGN §2.6).
export const guestListKeys = {
  all: ['eventGuestList'] as const,
  list: (eventId: string) => [...guestListKeys.all, eventId] as const,
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
  pairedProfile: (pairedUserId: string, mode: string = 'default') =>
    [...personCardKeys.all, 'pairedProfile', pairedUserId, mode] as const,
};
