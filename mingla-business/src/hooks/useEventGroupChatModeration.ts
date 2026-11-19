import { useCallback, useEffect, useState } from "react";

import {
  deleteMessage,
  listParticipants,
  removeParticipant,
  restoreParticipant,
  setBroadcastOnly,
  type EventGroupParticipant,
} from "../services/groupChatService";

export function useEventGroupChatModeration(conversationId: string | null): {
  participants: EventGroupParticipant[];
  loading: boolean;
  /** #4420: the roster has loaded at least once for this chat. */
  loaded: boolean;
  /** #4420: the last roster read failed (the count is then unknown, never 0). */
  error: string | null;
  refresh: () => Promise<void>;
  setBroadcastOnly: (value: boolean) => Promise<{ error: string | null }>;
  removeParticipant: (userId: string) => Promise<{ error: string | null }>;
  /** #4459: lifts a sticky removal (the remove toast's Undo). */
  restoreParticipant: (userId: string) => Promise<{ error: string | null }>;
  deleteMessage: (messageId: string) => Promise<{ error: string | null }>;
} {
  const [participants, setParticipants] = useState<EventGroupParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (conversationId === null) {
      setParticipants([]);
      setLoaded(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const result = await listParticipants(conversationId);
      if (result.error) throw new Error(result.error);
      setParticipants(result.participants);
      setError(null);
      setLoaded(true);
    } catch (err) {
      // #4420: a failed roster is reported, not turned into an empty room.
      console.warn("[useEventGroupChatModeration] failed to load participants", err);
      setError(err instanceof Error ? err.message : "Couldn't load the guest list.");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateBroadcastOnly = useCallback(
    async (value: boolean) => {
      if (conversationId === null) return { error: "Conversation not loaded" };
      return await setBroadcastOnly(conversationId, value);
    },
    [conversationId],
  );

  const remove = useCallback(
    async (userId: string) => {
      if (conversationId === null) return { error: "Conversation not loaded" };
      const result = await removeParticipant(conversationId, userId);
      if (result.error === null) await refresh();
      return result;
    },
    [conversationId, refresh],
  );

  const restore = useCallback(
    async (userId: string) => {
      if (conversationId === null) return { error: "Conversation not loaded" };
      const result = await restoreParticipant(conversationId, userId);
      if (result.error === null) await refresh();
      return result;
    },
    [conversationId, refresh],
  );

  const softDelete = useCallback(async (messageId: string) => {
    return await deleteMessage(messageId);
  }, []);

  return {
    participants,
    loading,
    loaded,
    error,
    refresh,
    setBroadcastOnly: updateBroadcastOnly,
    removeParticipant: remove,
    restoreParticipant: restore,
    deleteMessage: softDelete,
  };
}
