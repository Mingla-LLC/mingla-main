import { useCallback, useEffect, useState } from "react";

import { listMyBrandGuestChats, type BrandGuestChatSummary } from "../services/groupChatService";

/** #4459: Messages → Guests. Loading, error (with retry) and the list. */
export function useBrandGuestChats(): {
  chats: BrandGuestChatSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [chats, setChats] = useState<BrandGuestChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setChats(await listMyBrandGuestChats());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your Guest chats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { chats, loading, error, refresh };
}
