/**
 * Issue #1985 — durable client pointer to the active Ari conversation.
 *
 * Conversation messages and task state remain server-owned in Supabase. This
 * store persists only the UUID of the conversation the user chose for each
 * account + brand pair. A stored null is intentional: it means the user tapped
 * "New conversation" and must not have an older thread silently reopened.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type { AgentConversation } from "../services/agentChatService";

export const ARI_CONVERSATION_SELECTION_STORAGE_KEY =
  "mingla-business.ariConversationSelection.v1";

export type AriConversationSelections = Record<string, string | null>;

export interface AriConversationSelectionState {
  selections: AriConversationSelections;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setSelection: (scopeKey: string, conversationId: string | null) => void;
  reset: () => void;
}

type PersistedState = Pick<AriConversationSelectionState, "selections">;

export function ariConversationScopeKey(
  accountId: string | null,
  brandId: string | null,
): string | null {
  return accountId && brandId ? `${accountId}:${brandId}` : null;
}

export function hasStoredAriConversationSelection(
  selections: AriConversationSelections,
  scopeKey: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(selections, scopeKey);
}

/**
 * Resolve a persisted pointer against server-visible conversation truth.
 *
 * - Stored null is an explicit "new conversation" selection and stays null.
 * - A visible stored UUID is restored, including a deliberately selected
 *   legacy read-only thread.
 * - A missing preference adopts the newest brand-bound conversation once.
 * - A stale/deleted/inaccessible UUID fails closed to a new conversation.
 */
export function resolveRestoredAriConversation(
  storedSelection: string | null | undefined,
  visibleConversations: AgentConversation[],
  selectedBrandId: string,
): string | null {
  if (storedSelection === null) return null;
  if (typeof storedSelection === "string") {
    return visibleConversations.some(
      (conversation) =>
        conversation.id === storedSelection &&
        (conversation.brand_id === selectedBrandId ||
          conversation.brand_id === null),
    )
      ? storedSelection
      : null;
  }
  return (
    visibleConversations.find(
      (conversation) => conversation.brand_id === selectedBrandId,
    )?.id ?? null
  );
}

function sanitizeSelections(value: unknown): AriConversationSelections {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: AriConversationSelections = {};
  for (const [scopeKey, conversationId] of Object.entries(value)) {
    if (!scopeKey.includes(":")) continue;
    if (conversationId === null || typeof conversationId === "string") {
      result[scopeKey] = conversationId;
    }
  }
  return result;
}

const persistOptions: PersistOptions<
  AriConversationSelectionState,
  PersistedState
> = {
  // Keep the literal at the persist owner: I-PROPOSED-M statically proves every
  // reaper whitelist entry has a live Zustand `name:` source.
  name: "mingla-business.ariConversationSelection.v1",
  storage: createJSONStorage(() => AsyncStorage),
  version: 1,
  partialize: (state) => ({ selections: state.selections }),
  migrate: (persistedState) => ({
    selections: sanitizeSelections(
      (persistedState as Partial<PersistedState> | null)?.selections,
    ),
  }),
  merge: (persistedState, currentState) => ({
    ...currentState,
    selections: sanitizeSelections(
      (persistedState as Partial<PersistedState> | null)?.selections,
    ),
  }),
  onRehydrateStorage: () => (_state, _error) => {
    useAriConversationSelectionStore.getState().setHasHydrated(true);
  },
};

export const useAriConversationSelectionStore =
  create<AriConversationSelectionState>()(
    persist(
      (set) => ({
        selections: {},
        hasHydrated: false,
        setHasHydrated: (value) => set({ hasHydrated: value }),
        setSelection: (scopeKey, conversationId) =>
          set((state) => ({
            selections: {
              ...state.selections,
              [scopeKey]: conversationId,
            },
          })),
        reset: () => set({ selections: {} }),
      }),
      persistOptions,
    ),
  );
