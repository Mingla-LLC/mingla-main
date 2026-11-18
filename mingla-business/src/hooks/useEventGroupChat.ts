import { useCallback, useEffect, useState } from "react";

import { supabase } from "../services/supabase";
import {
  getBrandGuestChat,
  getEventGroupChat,
  listMessages,
  postPlannerMessage,
  type EventGroupConversation,
  type EventGroupMessage,
} from "../services/groupChatService";

/** #4459: opened from a listing (its brand's Guest chat) or by brand id (Messages → Guests). */
export function useEventGroupChat(eventId: string | null, brandId: string | null = null): {
  conversation: EventGroupConversation | null;
  messages: EventGroupMessage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** #4459: text only; the server stamps the post as the brand. */
  postMessage: (content: string) => Promise<{ messageId: string | null; error: string | null }>;
} {
  const [conversation, setConversation] = useState<EventGroupConversation | null>(null);
  const [messages, setMessages] = useState<EventGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const chatResult = brandId !== null
        ? await getBrandGuestChat(brandId)
        : eventId !== null
          ? await getEventGroupChat(eventId)
          : { conversation: null, error: null };
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
  }, [brandId, eventId]);

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
    async (content: string) => {
      if (conversation === null) return { messageId: null, error: "Conversation not loaded" };
      const result = await postPlannerMessage(conversation.id, content);
      if (result.error === null) await refresh();
      return result;
    },
    [conversation, refresh],
  );

  return { conversation, messages, loading, error, refresh, postMessage };
}
