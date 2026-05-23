import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';

export interface SessionScheduledCardRow {
  savedCardId: string;
  cardData: Record<string, unknown> | null;
  scheduledAt: string;
  lockedAt: string;
  lockedBy: string | null;
  lockedByDisplayName?: string;
}

interface SavedCardRow {
  id: string;
  card_data: Record<string, unknown> | null;
  saved_by: string | null;
  locked_at: string | null;
}

interface CalendarEntryRow {
  board_card_id: string | null;
  scheduled_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}

function displayName(profile: ProfileRow | undefined): string | undefined {
  if (!profile) return undefined;
  if (profile.display_name) return profile.display_name;
  if (profile.first_name && profile.last_name) return `${profile.first_name} ${profile.last_name}`;
  return profile.first_name || profile.username || undefined;
}

export function useSessionScheduledCards(sessionId: string | null | undefined): {
  rows: SessionScheduledCardRow[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery<SessionScheduledCardRow[]>({
    queryKey: ['scheduledCards', sessionId],
    enabled: !!sessionId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!sessionId) return [];

      const { data: savedCards, error: savedError } = await supabase
        .from('board_saved_cards')
        .select('id, card_data, saved_by, locked_at')
        .eq('session_id', sessionId)
        .eq('is_locked', true)
        .not('locked_at', 'is', null);

      if (savedError) throw savedError;

      const savedRows = (savedCards ?? []) as SavedCardRow[];
      const savedCardIds = savedRows.map((row) => row.id);
      if (savedCardIds.length === 0) return [];

      const { data: calendarEntries, error: calendarError } = await supabase
        .from('calendar_entries')
        .select('board_card_id, scheduled_at')
        .in('board_card_id', savedCardIds)
        .not('scheduled_at', 'is', null)
        .order('scheduled_at', { ascending: true });

      if (calendarError) throw calendarError;

      const entries = ((calendarEntries ?? []) as CalendarEntryRow[]).filter(
        (entry) => !!entry.board_card_id && !!entry.scheduled_at,
      );
      if (entries.length === 0) return [];

      const profileIds = Array.from(new Set(savedRows.map((row) => row.saved_by).filter(Boolean))) as string[];
      const profileMap = new Map<string, ProfileRow>();
      if (profileIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, display_name, first_name, last_name, username')
          .in('id', profileIds);
        if (!profileError) {
          for (const profile of (profiles ?? []) as ProfileRow[]) {
            profileMap.set(profile.id, profile);
          }
        }
      }

      const savedById = new Map(savedRows.map((row) => [row.id, row]));
      const rows: SessionScheduledCardRow[] = [];
      for (const entry of entries) {
        const saved = savedById.get(entry.board_card_id as string);
        if (!saved || !saved.locked_at) continue;
        rows.push({
            savedCardId: saved.id,
            cardData: saved.card_data ?? null,
            scheduledAt: entry.scheduled_at,
            lockedAt: saved.locked_at,
            lockedBy: saved.saved_by,
            lockedByDisplayName: displayName(saved.saved_by ? profileMap.get(saved.saved_by) : undefined),
        });
      }
      return rows.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    },
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
