import { useCallback, useEffect, useState } from "react";

import { supabase } from "../services/supabase";
import {
  getEventGroupChat,
  listMessages,
  postPlannerMessage,
  type EventGroupConversation,
  type EventGroupMessage,
  type PlannerImageAttachment,
} from "../services/groupChatService";

export function useEventGroupChat(eventId: string): {
  conversation: EventGroupConversation | null;
  messages: EventGroupMessage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  postMessage: (
    content: string,
    attachment?: PlannerImageAttachment | null,
  ) => Promise<{ messageId: string | null; error: string | null }>;
} {
  const [conversation, setConversation] = useState<EventGroupConversation | null>(null);
  const [messages, setMessages] = useState<EventGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const chatResult = await getEventGroupChat(eventId);
      if (chatResult.error) throw new Error(chatResult.error);
      setConversation(chatResult.conversation);
      if (chatResult.conversation === null) {
        setMessages([]);
        return;
      }
      const messageResult = await listMessages(chatResult.conversation.id);
      if (messageResult.error) throw new Error(messageResult.error);
      setMessages(messageResult.messages);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load group chat";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (conversation === null) return;
    const channel = supabase
      .channel(`conversation:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversation?.id, refresh]);

  const postMessage = useCallback(
    async (content: string, attachment?: PlannerImageAttachment | null) => {
      if (conversation === null) return { messageId: null, error: "Conversation not loaded" };
      const result = await postPlannerMessage(conversation.id, content, attachment);
      if (result.error === null) await refresh();
      return result;
    },
    [conversation, refresh],
  );

  return { conversation, messages, loading, error, refresh, postMessage };
}
