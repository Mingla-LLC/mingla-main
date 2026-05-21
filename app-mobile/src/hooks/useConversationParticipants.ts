import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { chatKeys } from "./queryKeys";

export interface ChatParticipant {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

const readableName = (profile: ProfileRow | undefined): string => {
  const displayName = profile?.display_name?.trim();
  if (displayName) return displayName;
  const username = profile?.username?.trim();
  if (username) return username;
  return "Unknown";
};

// Two-step fetch: conversation_participants.user_id FK targets auth.users(id),
// NOT public.profiles(id), so PostgREST has no relationship to walk for an
// implicit `profiles!inner(...)` join (errors with "Could not find a
// relationship between 'conversation_participants' and 'profiles' in the
// schema cache"). Manual join via .in() avoids the schema-cache miss + works
// without adding a duplicate FK migration.
export function useConversationParticipants(
  conversationId: string | null,
  currentUserId?: string | null,
) {
  return useQuery<ChatParticipant[]>({
    queryKey: chatKeys.participants(conversationId),
    enabled: !!conversationId,
    staleTime: 30_000,
    refetchInterval: 5_000,
    queryFn: async () => {
      if (!conversationId) return [];

      const { data: rows, error: rowsError } = await supabase
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId);

      if (rowsError) throw rowsError;

      const userIds = (rows ?? [])
        .map((r) => r.user_id as string)
        .filter((id) => id !== currentUserId);

      if (userIds.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      const byId = new Map<string, ProfileRow>(
        ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]),
      );

      return userIds.map((userId) => {
        const profile = byId.get(userId);
        return {
          userId,
          displayName: readableName(profile),
          username: profile?.username ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        };
      });
    },
  });
}
