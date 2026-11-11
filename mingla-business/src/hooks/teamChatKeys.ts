/**
 * #4255 W5 — Mingla team: the one query-key factory and the badge read.
 *
 * Kept tiny because the top bar (on every Host app screen) reads the badge;
 * everything else about team chat loads with the team screens. Every key
 * starts with the signed-in user's id, so one person's team data can never be
 * served to the next person on the same device (and sign-out clears them all
 * with the rest of the query cache).
 */
import { supabase } from "../services/supabase";

export interface TeamBadge {
  staff: boolean;
  chats: number;
  messages: number;
  mentions: number;
  total: number;
}

export const teamChatKeys = {
  all: (userId: string) => ["team-chat", userId] as const,
  badge: (userId: string) => ["team-chat", userId, "badge"] as const,
  threads: (userId: string) => ["team-chat", userId, "threads"] as const,
  messages: (userId: string, threadId: string) => ["team-chat", userId, "messages", threadId] as const,
  people: (userId: string) => ["team-chat", userId, "people"] as const,
  mentions: (userId: string) => ["team-chat", userId, "mentions"] as const,
  file: (userId: string, attachmentId: string) => ["team-chat", userId, "file", attachmentId] as const,
  prefs: (userId: string) => ["team-chat", userId, "prefs"] as const,
};

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The icon badge: unread team chats plus unread mentions; nothing for non-staff. */
export function teamBadgeCount(badge: Partial<TeamBadge> | null | undefined): number {
  if (!badge || badge.staff !== true) return 0;
  return count(badge.chats) + count(badge.mentions);
}

/** team_badge answers staff:false (never an error) for a signed-in host who is not staff. */
export async function fetchTeamBadge(): Promise<TeamBadge> {
  const { data, error } = await supabase.rpc("team_badge");
  if (error) throw new Error(error.message || "Couldn't check Mingla team.");
  const row = (data ?? null) as Partial<TeamBadge> | null;
  return {
    staff: row?.staff === true,
    chats: count(row?.chats),
    messages: count(row?.messages),
    mentions: count(row?.mentions),
    total: count(row?.total),
  };
}
