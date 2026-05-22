import { useCallback, useEffect, useState } from "react";

import {
  deleteMessage,
  listParticipants,
  removeParticipant,
  setBroadcastOnly,
  type EventGroupParticipant,
} from "../services/groupChatService";

export function useEventGroupChatModeration(conversationId: string | null): {
  participants: EventGroupParticipant[];
  loading: boolean;
  refresh: () => Promise<void>;
  setBroadcastOnly: (value: boolean) => Promise<{ error: string | null }>;
  removeParticipant: (userId: string) => Promise<{ error: string | null }>;
  deleteMessage: (messageId: string) => Promise<{ error: string | null }>;
} {
  const [participants, setParticipants] = useState<EventGroupParticipant[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (conversationId === null) {
      setParticipants([]);
      return;
    }
    setLoading(true);
    try {
      const result = await listParticipants(conversationId);
      if (result.error) throw new Error(result.error);
      setParticipants(result.participants);
    } catch (err) {
      console.warn("[useEventGroupChatModeration] failed to load participants", err);
      setParticipants([]);
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

  const softDelete = useCallback(async (messageId: string) => {
    return await deleteMessage(messageId);
  }, []);

  return {
    participants,
    loading,
    refresh,
    setBroadcastOnly: updateBroadcastOnly,
    removeParticipant: remove,
    deleteMessage: softDelete,
  };
}
