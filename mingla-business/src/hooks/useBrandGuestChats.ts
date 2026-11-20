import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../services/supabase";
import {
  listMyBrandGuestActivity,
  listMyBrandGuestChats,
  type BrandGuestActivity,
  type BrandGuestChatSummary,
} from "../services/brandGuestChatList";

/**
 * #4459: the brand Guest chats I run. Loading, error (with retry) and the list.
 * #4420: plus each chat's guest-side activity (unread count and last line) for
 * the one-row-per-brand inbox and the switcher. Activity is a separate read:
 * when it fails the chats still show, the badges are left off (never a guessed
 * 0) and the failure is reported in `activityError`.
 */
export function useBrandGuestChats(): {
  chats: BrandGuestChatSummary[];
  activity: ReadonlyMap<string, BrandGuestActivity>;
  activityError: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Re-reads only the guest-side unread counts (after reading the Guests side). */
  refreshActivity: () => Promise<void>;
} {
  const [chats, setChats] = useState<BrandGuestChatSummary[]>([]);
  const [activity, setActivity] = useState<ReadonlyMap<string, BrandGuestActivity>>(new Map());
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelNonce = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

  const refreshActivity = useCallback(async () => {
    try {
      const rows = await listMyBrandGuestActivity();
      setActivity(new Map(rows.map((row) => [row.conversation_id, row])));
      setActivityError(null);
    } catch (err) {
      // Badges stay off rather than showing a made-up count.
      const message = err instanceof Error ? err.message : "guest_activity_failed";
      console.warn("[useBrandGuestChats] guest activity unavailable", message);
      setActivityError(message);
    }
  }, []);

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
    await refreshActivity();
  }, [refreshActivity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A new guest message (or a read elsewhere) moves the badges.
  const hasChats = chats.length > 0;
  useEffect(() => {
    if (!hasChats) return undefined;
    const channel = supabase
      .channel(`brand-guest-activity:${channelNonce.current}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        void refreshActivity();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hasChats, refreshActivity]);

  return { chats, activity, activityError, loading, error, refresh, refreshActivity };
}
