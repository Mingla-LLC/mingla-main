/**
 * #4255 W5 — Mingla team: React Query reads and the realtime bridge.
 *
 * Server state lives in React Query only (Constitution 5), under
 * teamChatKey (one key per entity, every key under the signed-in user's id).
 * Realtime only invalidates: the database functions stay the one source of
 * what a person may see. Channels close when the screen goes away or the
 * person signs out (Constitution 6), and reopen when the app comes back to
 * the foreground (the #4275 lesson: a socket that died in the background
 * never says so).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import { teamChatKey } from "../../hooks/useBusinessNotifications";
import { supabase } from "../../services/supabase";
import {
  getTeamMessages,
  listTeamMentions,
  listTeamPeople,
  listTeamThreads,
  type TeamMessage,
  type TeamMessagesPage,
} from "../../services/teamChatService";

export interface TeamAccess {
  userId: string | null;
  /** Still finding out (signed-in state or the staff check). */
  checking: boolean;
  staff: boolean;
  error: Error | null;
  retry: () => void;
}

/** Staff or not, from the same team_badge read the top bar uses. */
export function useTeamAccess(): TeamAccess {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const badge = useQuery({
    queryKey: teamChatKey(userId ?? "signed-out", "badge"),
    // The same small lazy chunk the top bar uses (teamBadge.tsx).
    queryFn: async () => (await import("./teamBadge")).fetchTeamBadge(),
    enabled: userId !== null,
    staleTime: 30 * 1000,
  });
  const { refetch } = badge;
  const retry = useCallback(() => { void refetch(); }, [refetch]);
  return {
    userId,
    checking: loading || (userId !== null && badge.isPending),
    staff: userId !== null && badge.data?.staff === true,
    error: badge.isError ? (badge.error as Error) : null,
    retry,
  };
}

export function useTeamThreads(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: teamChatKey(userId ?? "signed-out", "threads"),
    queryFn: listTeamThreads,
    enabled: enabled && userId !== null,
    staleTime: 15 * 1000,
  });
}

export function useTeamPeople(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: teamChatKey(userId ?? "signed-out", "people"),
    queryFn: listTeamPeople,
    enabled: enabled && userId !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeamMentions(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: teamChatKey(userId ?? "signed-out", "mentions"),
    queryFn: listTeamMentions,
    enabled: enabled && userId !== null,
    staleTime: 15 * 1000,
  });
}

/** Pages newest first; each page is oldest-first inside, so the thread reads top to bottom. */
export function flattenTeamPages(data: InfiniteData<TeamMessagesPage> | undefined): TeamMessage[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: TeamMessage[] = [];
  for (const page of [...data.pages].reverse()) {
    for (const message of page.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out;
}

export function useTeamMessages(userId: string | null, threadId: string | null, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: teamChatKey(userId ?? "signed-out", "messages", threadId ?? "none"),
    queryFn: ({ pageParam }) => getTeamMessages(threadId as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more && last.messages.length > 0 ? last.messages[0].created_at : undefined),
    enabled: enabled && userId !== null && threadId !== null,
    staleTime: 10 * 1000,
  });
  const messages = useMemo(() => flattenTeamPages(query.data), [query.data]);
  const head = query.data?.pages[0];
  return { query, messages, thread: head?.thread ?? null, members: head?.members ?? [] };
}

type Channel = ReturnType<typeof supabase.channel>;

/**
 * One channel per screen: `team:list:<uid>` for the chat list, `team:<thread>`
 * for a thread. Every change refreshes the list, the badge and (in a thread)
 * that thread. Closed on unmount, on sign-out (userId becomes null) and
 * reopened when the app returns to the foreground.
 */
export function useTeamRealtime(userId: string | null, threadId: string | null, enabled: boolean): void {
  const queryClient = useQueryClient();
  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    if (!enabled || userId === null) return undefined;
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "badge") });
      if (threadId) void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "messages", threadId) });
    };
    const open = (): void => {
      const name = threadId ? `team:${threadId}` : `team:list:${userId}`;
      let channel = supabase.channel(name);
      if (threadId) {
        channel = channel
          .on("postgres_changes", { event: "*", schema: "public", table: "team_messages", filter: `thread_id=eq.${threadId}` }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "team_message_reactions" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "team_thread_members", filter: `thread_id=eq.${threadId}` }, refresh)
          // No primary-key filter (I-PROPOSED-ORCH-0931: realtime drops an
          // id=eq.* binding on an RLS table): every thread update this member
          // can see arrives, and only this thread's refreshes.
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "team_threads" }, (payload: { new?: { id?: unknown } }) => {
            if (payload.new?.id === threadId) refresh();
          });
      } else {
        channel = channel
          .on("postgres_changes", { event: "*", schema: "public", table: "team_threads" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "team_thread_members", filter: `user_id=eq.${userId}` }, refresh)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages" }, refresh);
      }
      channelRef.current = channel.subscribe();
    };
    const close = (): void => {
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
    open();
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;
      close();
      open();
      refresh();
    });
    return () => {
      subscription.remove();
      close();
    };
  }, [enabled, queryClient, threadId, userId]);
}
