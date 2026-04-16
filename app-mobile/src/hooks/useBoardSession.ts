import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { realtimeService } from "../services/realtimeService";
import { BoardInviteService } from "../services/boardInviteService";
import { normalizePreferencesForSave } from "../utils/preferencesConverter";
import { useQueryClient } from "@tanstack/react-query";

export interface BoardSession {
  id: string;
  name: string;
  session_type: "board" | "collaboration";
  board_id?: string;
  invite_code?: string;
  invite_link?: string;
  max_participants?: number;
  is_active: boolean;
  archived_at?: string | null;
  status?: string;
  created_by: string;
  created_at: string;
  last_activity_at?: string;
  participants?: any[];
}

export interface BoardSessionPreferences {
  id?: string;
  session_id: string;
  user_id?: string;
  categories?: string[];
  intents?: string[];
  intent_toggle?: boolean;
  category_toggle?: boolean;
  time_of_day?: string | null;
  datetime_pref?: string | null;
  date_option?: string | null;
  selected_dates?: string[] | null;
  location?: string | null;
  custom_location?: string | null;
  custom_lat?: number | null;
  custom_lng?: number | null;
  use_gps_location?: boolean;
  travel_mode?: string;
  travel_constraint_type?: 'time';
  travel_constraint_value?: number;
  created_at?: string;
  updated_at?: string;
}

export const useBoardSession = (sessionId?: string) => {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [preferences, setPreferences] =
    useState<BoardSessionPreferences | null>(null);
  const [allParticipantPreferences, setAllParticipantPreferences] = useState<BoardSessionPreferences[] | null>(null);
  const [loading, setLoading] = useState(!!sessionId);
  const [error, setError] = useState<string | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const loadSessionIdRef = useRef<string | null>(null);

  // Load session data with 10-second timeout.
  // Queries are parallelized where possible so the preferences sheet opens fast.
  const loadSession = useCallback(
    async (id: string) => {
      if (!id || !user) return;

      const loadId = `${id}-${Date.now()}`;
      loadSessionIdRef.current = loadId;

      setLoading(true);
      setError(null);

      // 10-second hard timeout — prevents the preferences sheet from spinning forever
      // when Supabase is slow or unreachable. Shows whatever data loaded so far.
      let didTimeout = false;
      const timeoutTimer = setTimeout(() => {
        didTimeout = true;
        if (loadSessionIdRef.current === loadId) {
          console.warn('[useBoardSession] 10s timeout — showing available data');
          setError('Session data is taking too long to load');
          setSessionValid(false);
          setHasPermission(false);
          setLoading(false);
        }
      }, 10000);

      try {
        // ORCH-0446: Parallel session + participants only. Prefs read from session JSONB.
        const [sessionResult, participantsResult] =
          await Promise.all([
            supabase
              .from("collaboration_sessions")
              .select("*")
              .eq("id", id)
              .maybeSingle(),
            supabase
              .from("session_participants")
              .select(
                `
            *,
            profiles (
              id,
              username,
              display_name,
              first_name,
              last_name,
              avatar_url
            )
          `
              )
              .eq("session_id", id),
          ]);

        if (didTimeout || loadSessionIdRef.current !== loadId) return;

        if (sessionResult.error) throw sessionResult.error;

        if (!sessionResult.data) {
          setError('This session is no longer available.');
          setSessionValid(false);
          setHasPermission(false);
          setLoading(false);
          return;
        }

        if (participantsResult.error) {
          console.error("Error loading participants:", participantsResult.error);
        }

        // ORCH-0446: Read participant_prefs from session JSONB (already loaded above)
        const rawParticipantPrefs = sessionResult.data?.participant_prefs || {};
        const userPrefs = rawParticipantPrefs[user?.id || ''] || null;
        const allPrefs = Object.entries(rawParticipantPrefs).map(([uid, prefs]: [string, any]) => ({
          user_id: uid,
          ...prefs,
        }));

        setAllParticipantPreferences(allPrefs);

        setSession({
          ...sessionResult.data,
          participants: participantsResult.data || [],
        } as BoardSession);

        if (userPrefs) {
          setPreferences(userPrefs as BoardSessionPreferences);
        }
        // ORCH-0446: Prefs are read from session JSONB, no separate table.
        // (via seedCollabPrefsFromSolo). Deck generator has solo fallback as defense-in-depth.

        // --- Derive session validity and user permission from fetched data ---
        // Eliminates 3 sequential BoardErrorHandler queries that re-fetched
        // the same data from collaboration_sessions and session_participants.
        const fetchedSession = sessionResult.data;
        const fetchedParticipants = participantsResult.data || [];

        const isValid = !!fetchedSession && fetchedSession.is_active && !fetchedSession.archived_at;
        const userParticipant = fetchedParticipants.find(
          (p: any) => p.user_id === user?.id
        );
        const isMember = !!userParticipant && userParticipant.has_accepted !== false;
        const isCreator = fetchedSession?.created_by === user?.id;

        setSessionValid(isValid);
        setHasPermission(isMember || isCreator);
        setIsAdmin(isCreator);

        if (!isValid) {
          setError(fetchedSession?.archived_at ? 'This session has been archived.' : 'This session is no longer active.');
        } else if (!isMember && !isCreator) {
          setError('You do not have access to this session.');
        }
      } catch (err: any) {
        if (loadSessionIdRef.current !== loadId) return;
        setError(err.message || "Failed to load session");
        console.error("Error loading session:", err);
      } finally {
        clearTimeout(timeoutTimer);
        if (!didTimeout && loadSessionIdRef.current === loadId) {
          setLoading(false);
        }
      }
    },
    [user]
  );

  // Update preferences (with normalization matching solo preferences rules)
  const updatePreferences = useCallback(
    async (newPreferences: Partial<BoardSessionPreferences>) => {
      if (!sessionId || !user) return;
      try {
        // Apply the same normalization rules as solo preferences to prevent
        // conflicting date/time/location combinations from being persisted.
        const normalized = normalizePreferencesForSave({
          date_option: newPreferences.date_option,
          datetime_pref: newPreferences.datetime_pref,
          use_gps_location: newPreferences.use_gps_location,
          custom_location: newPreferences.custom_location,
        });

        const payload = {
          ...newPreferences,
          // Overwrite with normalized values (only the fields normalization touches)
          date_option: normalized.date_option,
          datetime_pref: normalized.datetime_pref,
          use_gps_location: normalized.use_gps_location,
          custom_location: normalized.custom_location,
        };

        // ORCH-0446: Atomic merge via RPC — safe for 20+ concurrent participants
        const { error } = await supabase.rpc('upsert_participant_prefs', {
          p_session_id: sessionId,
          p_user_id: user.id,
          p_prefs: payload,
        });

        if (error) throw error;

        const updatedUserPrefs = {
          ...payload,
          session_id: sessionId,
          user_id: user.id,
        } as BoardSessionPreferences;

        // Optimistic local state update
        setPreferences(
          (prev) =>
            ({
              ...prev,
              ...updatedUserPrefs,
            } as BoardSessionPreferences)
        );

        // Optimistically update allParticipantPreferences so that
        // RecommendationsContext can recompute collabDeckParams immediately.
        setAllParticipantPreferences((prev) => {
          const list = prev ?? [];
          const idx = list.findIndex((p) => p.user_id === user.id);
          if (idx >= 0) {
            const updated = [...list];
            updated[idx] = { ...updated[idx], ...updatedUserPrefs };
            return updated;
          }
          return [...list, updatedUserPrefs];
        });

        // ORCH-0446B: Re-read session from DB so ALL instances of useBoardSession
        // (including RecommendationsContext's) see the updated participant_prefs.
        // The optimistic update above only affects THIS instance. The realtime path
        // (onSessionUpdated) is a backup but has ~200-500ms latency.
        loadSession(sessionId);
      } catch (err: any) {
        setError(err.message || "Failed to update preferences");
        throw err;
      }
    },
    [sessionId, user]
  );

  // Get invite link
  const getInviteLink = useCallback(async () => {
    if (!sessionId) return null;

    const linkData = await BoardInviteService.generateInviteLink(sessionId);
    return linkData;
  }, [sessionId]);

  // Subscribe to real-time updates — debounced to prevent rapid subscribe/unsubscribe
  // cycling during mode transitions when sessionId flickers across renders.
  const stableSessionIdRef = useRef<string | undefined>(undefined);
  const boardCallbacksRef = useRef<any>(null);

  useEffect(() => {
    // If sessionId is cleared, unsubscribe immediately (no debounce needed)
    if (!sessionId) {
      if (stableSessionIdRef.current && boardCallbacksRef.current) {
        realtimeService.unregisterBoardCallbacks(stableSessionIdRef.current, boardCallbacksRef.current);
        boardCallbacksRef.current = null;
        stableSessionIdRef.current = undefined;
      }
      return;
    }

    // If sessionId is the same as what we're already subscribed to, skip
    if (sessionId === stableSessionIdRef.current) return;

    // ORCH-0446B: ALWAYS clear stale prefs when sessionId changes — even if coming
    // from solo (stableSessionIdRef undefined). Without this, the previous session's
    // allParticipantPreferences leaks into the new session for 1-2 renders, causing
    // a stale-category deck fetch before loadSession completes.
    setAllParticipantPreferences(null);

    // Immediately unsubscribe from previous session to prevent stale events
    // from corrupting state during the debounce window (HIGH-001 fix).
    // Only the subscribe is debounced — unsubscribe is always instant.
    if (stableSessionIdRef.current) {
      if (boardCallbacksRef.current) {
        realtimeService.unregisterBoardCallbacks(stableSessionIdRef.current, boardCallbacksRef.current);
        boardCallbacksRef.current = null;
      }
      stableSessionIdRef.current = undefined;
    }

    // Debounce: wait 300ms before subscribing to avoid thrashing
    const capturedSessionId = sessionId;
    const timer = setTimeout(() => {
      stableSessionIdRef.current = sessionId;

      const callbacks = {
        onSessionUpdated: (updatedSession: any) => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          setSession((prev) => (prev ? { ...prev, ...updatedSession } : null));
          // ORCH-0446B: Extract participant_prefs from realtime payload.
          // The old board_session_preferences table was deleted — onPreferencesChanged
          // no longer fires. This is now the only path for pref-change propagation.
          if (updatedSession.participant_prefs) {
            const rawPrefs = updatedSession.participant_prefs;
            const allPrefs = Object.entries(rawPrefs).map(([uid, prefs]: [string, any]) => ({
              user_id: uid,
              ...prefs,
            }));
            setAllParticipantPreferences(allPrefs);
          }
        },
        onParticipantJoined: (participant: { user_id: string; [key: string]: unknown }) => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          setSession((prev) => {
            if (!prev) return null;
            const existing = prev.participants || [];
            if (existing.find((p) => p.user_id === participant.user_id)) {
              return prev;
            }
            return {
              ...prev,
              participants: [...existing, participant],
            };
          });
          // ORCH-0438: New participant → re-evaluate deck (may cross ≥2 accepted threshold)
          if (sessionId) {
            queryClient.invalidateQueries({ queryKey: ['session-deck', sessionId] });
            loadSession(sessionId);
          }
        },
        onParticipantLeft: (participant: { user_id: string; [key: string]: unknown }) => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          setSession((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              participants: (prev.participants || []).filter(
                (p) => p.user_id !== participant.user_id
              ),
            };
          });
        },
        onPreferencesChanged: () => {
          if (capturedSessionId !== stableSessionIdRef.current) return;
          // ORCH-0446: Re-read session JSONB. This updates allParticipantPreferences,
          // which triggers collabDeckParams recompute in RecommendationsContext,
          // which changes the React Query key → auto-fetch new deck. No manual invalidation needed.
          if (sessionId) {
            loadSession(sessionId);
          }
        },
        onDeckRegenerated: () => {
          // ORCH-0446: No-op. generate-session-deck is deleted. session_decks table is gone.
          // Deck re-fetch is handled by collabDeckParams change → React Query key change.
        },
        onSessionDeleted: () => {
          if (capturedSessionId !== stableSessionIdRef.current) return;
          setSession(null);
          setSessionValid(false);
          setError('This session has been deleted.');
          // ORCH-0446: No session-deck invalidation needed (hook deleted).
          // The mode switch is handled by the health monitor in RecommendationsContext.
        },
      };
      boardCallbacksRef.current = callbacks;
      realtimeService.subscribeToBoardSession(sessionId, callbacks);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [sessionId]);

  // Cleanup on unmount — unregister callbacks (safe — doesn't destroy channel)
  useEffect(() => {
    return () => {
      if (stableSessionIdRef.current && boardCallbacksRef.current) {
        realtimeService.unregisterBoardCallbacks(stableSessionIdRef.current, boardCallbacksRef.current);
        boardCallbacksRef.current = null;
        stableSessionIdRef.current = undefined;
      }
    };
  }, []);

  // Load session on mount or when sessionId or user changes
  useEffect(() => {
    if (sessionId && user) {
      loadSession(sessionId);
    }
  }, [sessionId, user?.id, loadSession]);

  return {
    session,
    preferences,
    allParticipantPreferences,
    loading,
    error,
    sessionValid,
    hasPermission,
    isAdmin,
    loadSession,
    updatePreferences,
    getInviteLink,
  };
};
