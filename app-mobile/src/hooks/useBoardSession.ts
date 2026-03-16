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
  price_tiers?: string[];
  budget_min?: number;
  budget_max?: number;
  time_of_day?: string | null;
  datetime_pref?: string | null;
  date_option?: string | null;
  time_slot?: string | null;
  exact_time?: string | null;
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
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const loadSessionIdRef = useRef<string | null>(null);

  // Load session data
  const loadSession = useCallback(
    async (id: string) => {
      if (!id || !user) return;

      const loadId = `${id}-${Date.now()}`;
      loadSessionIdRef.current = loadId;

      setLoading(true);
      setError(null);

      try {
        // Load session
        const { data: sessionData, error: sessionError } = await supabase
          .from("collaboration_sessions")
          .select("*")
          .eq("id", id)
          .single();

        if (sessionError) throw sessionError;
        if (loadSessionIdRef.current !== loadId) return;

        // Load preferences for the current user
        const { data: prefsData, error: prefsError } = await supabase
          .from("board_session_preferences")
          .select("*")
          .eq("session_id", id)
          .eq("user_id", user?.id || "")
          .single();

        if (prefsError && prefsError.code !== "PGRST116") {
          console.error("Error loading preferences:", prefsError);
        }
        if (loadSessionIdRef.current !== loadId) return;

        // Load ALL participants' preferences (for aggregation)
        const { data: allPrefsData, error: allPrefsError } = await supabase
          .from("board_session_preferences")
          .select("*")
          .eq("session_id", id);

        if (allPrefsError) {
          console.warn("Error loading all participant preferences:", allPrefsError);
        }
        if (loadSessionIdRef.current !== loadId) return;

        setAllParticipantPreferences(allPrefsData || []);

        // Load participants
        const { data: participantsData, error: participantsError } =
          await supabase
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
            .eq("session_id", id);

        if (participantsError) {
          console.error("Error loading participants:", participantsError);
        }
        if (loadSessionIdRef.current !== loadId) return;

        setSession({
          ...sessionData,
          participants: participantsData || [],
        } as BoardSession);

        if (prefsData) {
          setPreferences(prefsData as BoardSessionPreferences);
        }
      } catch (err: any) {
        if (loadSessionIdRef.current !== loadId) return;
        setError(err.message || "Failed to load session");
        console.error("Error loading session:", err);
      } finally {
        if (loadSessionIdRef.current === loadId) {
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
          time_slot: newPreferences.time_slot,
          exact_time: newPreferences.exact_time,
          datetime_pref: newPreferences.datetime_pref,
          use_gps_location: newPreferences.use_gps_location,
          custom_location: newPreferences.custom_location,
        });

        const payload = {
          ...newPreferences,
          // Overwrite with normalized values (only the fields normalization touches)
          date_option: normalized.date_option,
          time_slot: normalized.time_slot,
          exact_time: normalized.exact_time,
          datetime_pref: normalized.datetime_pref,
          use_gps_location: normalized.use_gps_location,
          custom_location: normalized.custom_location,
        };

        const { error } = await supabase
          .from("board_session_preferences")
          .upsert(
            {
              session_id: sessionId,
              user_id: user.id,
              ...payload,
            },
            {
              onConflict: "session_id,user_id",
            }
          );

        if (error) throw error;

        const updatedUserPrefs = {
          ...payload,
          session_id: sessionId,
          user_id: user.id,
        } as BoardSessionPreferences;

        setPreferences(
          (prev) =>
            ({
              ...prev,
              ...updatedUserPrefs,
            } as BoardSessionPreferences)
        );

        // Optimistically update allParticipantPreferences so that
        // RecommendationsContext detects the change immediately and
        // invalidates the session deck without waiting for realtime.
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

  useEffect(() => {
    // If sessionId is cleared, unsubscribe immediately (no debounce needed)
    if (!sessionId) {
      if (stableSessionIdRef.current) {
        realtimeService.unsubscribe(`board_session:${stableSessionIdRef.current}`);
        stableSessionIdRef.current = undefined;
      }
      return;
    }

    // If sessionId is the same as what we're already subscribed to, skip
    if (sessionId === stableSessionIdRef.current) return;

    // Immediately unsubscribe from previous session to prevent stale events
    // from corrupting state during the debounce window (HIGH-001 fix).
    // Only the subscribe is debounced — unsubscribe is always instant.
    if (stableSessionIdRef.current) {
      realtimeService.unsubscribe(`board_session:${stableSessionIdRef.current}`);
      stableSessionIdRef.current = undefined;
      setAllParticipantPreferences([]);
    }

    // Debounce: wait 300ms before subscribing to avoid thrashing
    const capturedSessionId = sessionId;
    const timer = setTimeout(() => {
      stableSessionIdRef.current = sessionId;

      realtimeService.subscribeToBoardSession(sessionId, {
        onSessionUpdated: (updatedSession) => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          setSession((prev) => (prev ? { ...prev, ...updatedSession } : null));
        },
        onParticipantJoined: (participant) => {
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
        },
        onParticipantLeft: (participant) => {
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
        onPreferencesChanged: (newPrefs: any) => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          if (sessionId) loadSession(sessionId);
          if (sessionId && newPrefs?.user_id === user?.id) {
            supabase.functions.invoke("generate-session-deck", {
              body: { sessionId, batchSeed: 0 },
            }).catch((err) => {
              console.warn("[useBoardSession] Deck regeneration after prefs change failed:", err);
            });
          }
        },
        onDeckRegenerated: () => {
          if (capturedSessionId !== stableSessionIdRef.current) {
            console.warn('[useBoardSession] Ignoring stale event for session:', capturedSessionId);
            return;
          }
          if (sessionId) {
            queryClient.invalidateQueries({ queryKey: ["session-deck", sessionId] });
          }
        },
      });
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [sessionId]);

  // Cleanup on unmount — unsubscribe from whatever channel is active
  useEffect(() => {
    return () => {
      if (stableSessionIdRef.current) {
        realtimeService.unsubscribe(`board_session:${stableSessionIdRef.current}`);
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
    loadSession,
    updatePreferences,
    getInviteLink,
  };
};
