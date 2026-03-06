import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';
import { DeviceCalendarService } from '../services/deviceCalendarService';
import { useQueryClient } from '@tanstack/react-query';

export interface CalendarEntryRecord {
  id: string;
  user_id: string;
  board_card_id: string;
  source: string;
  card_data: Record<string, unknown>;
  status: string;
  scheduled_at: string;
  duration_minutes: number | null;
}

export function useCollaborationCalendar(
  sessionId: string | null,
  userId: string | undefined,
): {
  lockedCalendarEntry: CalendarEntryRecord | null;
  syncToDeviceCalendar: (entry: CalendarEntryRecord) => Promise<void>;
  showCalendarPrompt: boolean;
  dismissCalendarPrompt: () => void;
} {
  const [lockedCalendarEntry, setLockedCalendarEntry] =
    useState<CalendarEntryRecord | null>(null);
  const [showCalendarPrompt, setShowCalendarPrompt] = useState(false);
  const queryClient = useQueryClient();

  // When a card lock-in event fires, query for the calendar entry
  const handleCardLocked = useCallback(
    async (savedCardId: string) => {
      if (!userId) return;

      // Poll for the calendar entry created by the DB trigger (up to 3 attempts)
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 300;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }

        const { data, error } = await supabase
          .from('calendar_entries')
          .select('*')
          .eq('board_card_id', savedCardId)
          .eq('user_id', userId)
          .eq('source', 'collaboration')
          .maybeSingle();

        if (!error && data) {
          setLockedCalendarEntry(data as CalendarEntryRecord);
          setShowCalendarPrompt(true);
          queryClient.invalidateQueries({ queryKey: ['calendarEntries', userId] });
          return;
        }
      }

      // Trigger may not have fired yet — silent failure, user can find entry in calendar later
      console.warn('[useCollaborationCalendar] Calendar entry not found after retries for card:', savedCardId);
    },
    [userId, queryClient]
  );

  // Listen for lock-in events
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onCardLocked: (savedCardId: string) => {
        handleCardLocked(savedCardId);
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);

    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
    };
  }, [sessionId, handleCardLocked]);

  // Sync to device calendar
  const syncToDeviceCalendar = useCallback(
    async (entry: CalendarEntryRecord) => {
      const cardData = entry.card_data || {};
      const scheduledAt = new Date(entry.scheduled_at);
      const durationMinutes = entry.duration_minutes || 60;

      const event = DeviceCalendarService.createEventFromCard(
        cardData,
        scheduledAt,
        durationMinutes
      );

      await DeviceCalendarService.addEventToDeviceCalendar(event);
      setShowCalendarPrompt(false);
    },
    []
  );

  const dismissCalendarPrompt = useCallback(() => {
    setShowCalendarPrompt(false);
  }, []);

  return {
    lockedCalendarEntry,
    syncToDeviceCalendar,
    showCalendarPrompt,
    dismissCalendarPrompt,
  };
}
