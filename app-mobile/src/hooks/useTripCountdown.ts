import { useEffect, useState } from 'react';

import { supabase } from '../services/supabase';

export type TripCountdownStatus = 'upcoming' | 'today' | 'past' | 'unknown';

export function useTripCountdown(eventId: string | null): {
  days: number | null;
  status: TripCountdownStatus;
  eventName: string | null;
} {
  const [state, setState] = useState<{
    days: number | null;
    status: TripCountdownStatus;
    eventName: string | null;
  }>({ days: null, status: 'unknown', eventName: null });

  useEffect(() => {
    if (!eventId) {
      setState({ days: null, status: 'unknown', eventName: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('events_with_master_date_view')
          .select('title, master_start_at, master_end_at')
          .eq('id', eventId)
          .maybeSingle();

        if (error) throw error;
        if (!data?.master_start_at) {
          if (!cancelled) {
            setState({
              days: null,
              status: 'unknown',
              eventName: data?.title ?? null,
            });
          }
          return;
        }

        const start = new Date(data.master_start_at);
        const end = data.master_end_at ? new Date(data.master_end_at) : null;
        if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
          if (!cancelled) {
            setState({ days: null, status: 'unknown', eventName: data.title ?? null });
          }
          return;
        }

        const now = new Date();
        const hideAfter = end ?? start;
        if (now.getTime() > hideAfter.getTime()) {
          if (!cancelled) {
            setState({ days: null, status: 'past', eventName: data.title ?? null });
          }
          return;
        }

        const startDay = new Date(start);
        startDay.setHours(0, 0, 0, 0);
        const nowDay = new Date(now);
        nowDay.setHours(0, 0, 0, 0);
        const days = Math.ceil((startDay.getTime() - nowDay.getTime()) / 86_400_000);

        if (!cancelled) {
          setState({
            days: Math.max(days, 0),
            status: days <= 0 ? 'today' : 'upcoming',
            eventName: data.title ?? null,
          });
        }
      } catch (error) {
        console.warn('[useTripCountdown] failed to load countdown', error);
        if (!cancelled) setState({ days: null, status: 'unknown', eventName: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return state;
}
