/**
 * Shared React Query key factory for Ari surfaces.
 * Kept out of `useAgentChat` so conversation-list / prefs hooks do not pull the
 * recovery state machine into the web boot chunk (ORCH-1083).
 */

export const agentQueryKeys = {
  conversationsRoot: () => ["ari", "conversations"] as const,
  conversations: (brandId: string | null = null) =>
    ["ari", "conversations", brandId ?? "unscoped"] as const,
  messages: (conversationId: string | null) =>
    ["ari", "messages", conversationId ?? "new"] as const,
  profile: () => ["ari", "profile"] as const,
};
