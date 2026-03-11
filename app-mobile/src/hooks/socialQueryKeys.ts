/**
 * Shared query key factories for social-related hooks.
 *
 * Extracted to avoid circular imports between useFriendLinks and
 * usePendingFriendLinkIntents (CRIT-001).
 */

export const friendLinkKeys = {
  all: ["friend-links"] as const,
  pending: (userId: string) =>
    [...friendLinkKeys.all, "pending", userId] as const,
  sent: (userId: string) => [...friendLinkKeys.all, "sent", userId] as const,
  search: (query: string) =>
    [...friendLinkKeys.all, "search", query] as const,
  phoneInvites: (userId: string) =>
    [...friendLinkKeys.all, "phone-invites", userId] as const,
};

export const friendLinkIntentKeys = {
  all: ["friend-link-intents"] as const,
  pending: (userId: string) =>
    [...friendLinkIntentKeys.all, "pending", userId] as const,
};
