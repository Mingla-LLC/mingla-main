import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';
import { getDisplayName } from '../utils/getDisplayName';

export interface VoteCounts {
  [cardId: string]: {
    yes: number;
    no: number;
    userVote: 'yes' | 'no' | null;
    voters: string[];
  };
}

export interface RsvpCounts {
  [cardId: string]: {
    responded: number;
    total: number;
    userRSVP: 'yes' | 'no' | null;
    attendees: string[];
  };
}

export interface LockedCards {
  [cardId: string]: {
    isLocked: boolean;
    lockedAt: string | null;
  };
}

export interface UseSessionVotingReturn {
  voteCounts: VoteCounts;
  rsvpCounts: RsvpCounts;
  lockedCards: LockedCards;
  handleVote: (savedCardId: string, vote: 'yes' | 'no') => Promise<void>;
  handleRSVP: (savedCardId: string, rsvp: 'yes' | 'no') => Promise<void>;
  loadCounts: () => Promise<void>;
  isVoting: boolean;
  isRSVPing: boolean;
}

export function useSessionVoting(
  sessionId: string | null,
  userId: string | undefined,
  participantCount: number,
): UseSessionVotingReturn {
  const [voteCounts, setVoteCounts] = useState<VoteCounts>({});
  const [rsvpCounts, setRsvpCounts] = useState<RsvpCounts>({});
  const [lockedCards, setLockedCards] = useState<LockedCards>({});
  const [isVoting, setIsVoting] = useState(false);
  const [isRSVPing, setIsRSVPing] = useState(false);

  // H6 FIX: Synchronous refs for concurrency guards.
  // React batches state updates, so `isVoting` state may not propagate fast enough
  // to block a rapid double-tap. Refs update synchronously and are checked immediately.
  const isVotingRef = useRef(false);
  const isRSVPingRef = useRef(false);

  // Track saved card IDs for bulk loading
  const savedCardIdsRef = useRef<string[]>([]);

  const loadCounts = useCallback(async () => {
    if (!sessionId || !userId) return;

    try {
      // Load all saved cards for this session (to get IDs and lock state)
      const { data: savedCardsData, error: savedCardsError } = await supabase
        .from('board_saved_cards')
        .select('id, is_locked, locked_at')
        .eq('session_id', sessionId);

      if (savedCardsError) throw savedCardsError;

      const cardIds = (savedCardsData || []).map((c) => c.id);
      savedCardIdsRef.current = cardIds;

      if (cardIds.length === 0) {
        setVoteCounts({});
        setRsvpCounts({});
        setLockedCards({});
        return;
      }

      // Update locked cards state
      const newLockedCards: LockedCards = {};
      (savedCardsData || []).forEach((card) => {
        newLockedCards[card.id] = {
          isLocked: card.is_locked || false,
          lockedAt: card.locked_at || null,
        };
      });
      setLockedCards(newLockedCards);

      // Load votes
      const { data: votesData, error: votesError } = await supabase
        .from('board_votes')
        .select('saved_card_id, vote_type, user_id')
        .eq('session_id', sessionId)
        .in('saved_card_id', cardIds);

      if (votesError) throw votesError;

      // Aggregate vote counts
      const newVoteCounts: VoteCounts = {};
      cardIds.forEach((cardId) => {
        const cardVotes = (votesData || []).filter(
          (v) => v.saved_card_id === cardId
        );
        const upVoters = cardVotes
          .filter((v) => v.vote_type === 'up')
          .map((v) => v.user_id);
        const downCount = cardVotes.filter((v) => v.vote_type === 'down').length;
        const userVoteRaw = cardVotes.find(
          (v) => String(v.user_id) === String(userId)
        )?.vote_type;
        const userVote =
          userVoteRaw === 'up' ? 'yes' : userVoteRaw === 'down' ? 'no' : null;

        newVoteCounts[cardId] = {
          yes: upVoters.length,
          no: downCount,
          userVote,
          voters: upVoters,
        };
      });
      setVoteCounts(newVoteCounts);

      // Load RSVPs
      const { data: rsvpsData, error: rsvpsError } = await supabase
        .from('board_card_rsvps')
        .select('saved_card_id, rsvp_status, user_id')
        .eq('session_id', sessionId)
        .in('saved_card_id', cardIds);

      if (rsvpsError) throw rsvpsError;

      // Aggregate RSVP counts
      const newRsvpCounts: RsvpCounts = {};
      cardIds.forEach((cardId) => {
        const cardRsvps = (rsvpsData || []).filter(
          (r) => r.saved_card_id === cardId
        );
        const attendees = cardRsvps
          .filter((r) => r.rsvp_status === 'attending')
          .map((r) => r.user_id);
        const totalResponded = attendees.length;
        const userRsvpRaw = cardRsvps.find(
          (r) => String(r.user_id) === String(userId)
        )?.rsvp_status;
        const userRSVP =
          userRsvpRaw === 'attending'
            ? 'yes'
            : userRsvpRaw === 'not_attending'
            ? 'no'
            : null;

        newRsvpCounts[cardId] = {
          responded: totalResponded,
          total: participantCount,
          userRSVP,
          attendees,
        };
      });
      setRsvpCounts(newRsvpCounts);
    } catch (err: unknown) {
      console.error('[useSessionVoting] Error loading counts:', err);
    }
  }, [sessionId, userId, participantCount]);

  // Handle vote with optimistic updates and concurrency guard
  const handleVote = useCallback(
    async (savedCardId: string, vote: 'yes' | 'no') => {
      // H6 FIX: Check ref synchronously BEFORE any async work.
      // This blocks rapid double-taps that slip through batched state updates.
      if (!userId || !sessionId || isVotingRef.current) return;
      isVotingRef.current = true;

      setIsVoting(true);

      // Get current vote state — query DB if local state is empty/stale
      let currentVoteCounts = voteCounts[savedCardId];
      if (
        !currentVoteCounts ||
        (currentVoteCounts.userVote === null &&
          currentVoteCounts.yes === 0 &&
          currentVoteCounts.no === 0)
      ) {
        const { data: allCardVotes, error: voteCheckError } = await supabase
          .from('board_votes')
          .select('vote_type, user_id')
          .eq('session_id', sessionId)
          .eq('saved_card_id', savedCardId);

        if (!voteCheckError && allCardVotes) {
          const upVoters = allCardVotes
            .filter((v) => v.vote_type === 'up')
            .map((v) => v.user_id);
          const noVotes = allCardVotes.filter(
            (v) => v.vote_type === 'down'
          ).length;
          const userVoteRaw = allCardVotes.find(
            (v) => String(v.user_id) === String(userId)
          )?.vote_type;
          const userVote =
            userVoteRaw === 'up'
              ? 'yes'
              : userVoteRaw === 'down'
              ? 'no'
              : null;

          currentVoteCounts = {
            yes: upVoters.length,
            no: noVotes,
            userVote,
            voters: upVoters,
          };
        } else {
          currentVoteCounts = { yes: 0, no: 0, userVote: null, voters: [] };
        }
      }

      // Compute optimistic state
      const previousVote = currentVoteCounts.userVote;
      let newYesCount = currentVoteCounts.yes;
      let newNoCount = currentVoteCounts.no;
      let newVoters = [...currentVoteCounts.voters];
      let finalVote: 'yes' | 'no' | null;

      if (vote === previousVote) {
        // Toggle off
        finalVote = null;
        if (previousVote === 'yes') {
          newYesCount = Math.max(0, newYesCount - 1);
          newVoters = newVoters.filter((v) => v !== userId);
        } else if (previousVote === 'no') {
          newNoCount = Math.max(0, newNoCount - 1);
        }
      } else {
        // Switch or new vote
        finalVote = vote;
        if (previousVote === 'yes') {
          newYesCount = Math.max(0, newYesCount - 1);
          newVoters = newVoters.filter((v) => v !== userId);
        } else if (previousVote === 'no') {
          newNoCount = Math.max(0, newNoCount - 1);
        }
        if (vote === 'yes') {
          newYesCount += 1;
          newVoters.push(userId);
        } else {
          newNoCount += 1;
        }
      }

      // Apply optimistic update
      setVoteCounts((prev) => ({
        ...prev,
        [savedCardId]: {
          yes: newYesCount,
          no: newNoCount,
          userVote: finalVote,
          voters: newVoters,
        },
      }));

      try {
        const voteType =
          finalVote === 'yes' ? 'up' : finalVote === 'no' ? 'down' : null;

        if (voteType === null) {
          // Remove vote
          const { error } = await supabase
            .from('board_votes')
            .delete()
            .eq('session_id', sessionId)
            .eq('saved_card_id', savedCardId)
            .eq('user_id', userId);

          if (error) throw error;
        } else {
          // Upsert vote — single round-trip, race-condition safe
          const { error } = await supabase
            .from('board_votes')
            .upsert(
              {
                session_id: sessionId,
                saved_card_id: savedCardId,
                user_id: userId,
                vote_type: voteType,
              },
              { onConflict: 'session_id,saved_card_id,user_id' }
            );

          if (error) throw error;

          // Notify card saver about the vote (fire-and-forget, only for positive votes)
          if (voteType === 'up') {
            import('../services/boardNotificationService').then(({ notifyCardVoted }) => {
              // Look up card saver + session name + voter name in parallel
              Promise.all([
                supabase.from('board_saved_cards').select('saved_by, experience_data').eq('id', savedCardId).maybeSingle(),
                supabase.from('collaboration_sessions').select('name').eq('id', sessionId).maybeSingle(),
                supabase.from('profiles').select('display_name, first_name').eq('id', userId).maybeSingle(),
              ]).then(([cardRes, sessionRes, profileRes]) => {
                const cardData = cardRes.data;
                if (cardData?.saved_by && cardData.saved_by !== userId) {
                  const voterName = getDisplayName(profileRes.data);
                  notifyCardVoted({
                    sessionId,
                    sessionName: sessionRes.data?.name || 'Session',
                    userId: userId!,
                    userName: voterName,
                    savedCardId,
                    cardName: (cardData.experience_data as Record<string, unknown>)?.title as string || undefined,
                    cardSaverId: cardData.saved_by,
                    voteType: 'up',
                  });
                }
              });
            }).catch(() => {});
          }
        }

        // Realtime subscription handles reload — no setTimeout needed
        loadCounts();
      } catch (err: unknown) {
        console.error('[useSessionVoting] Error voting:', err);
        // Rollback
        setVoteCounts((prev) => ({
          ...prev,
          [savedCardId]: currentVoteCounts,
        }));
        Alert.alert('Error', 'Failed to submit vote');
      } finally {
        isVotingRef.current = false;
        setIsVoting(false);
      }
    },
    [userId, sessionId, voteCounts, loadCounts]
  );

  // Handle RSVP with optimistic updates and concurrency guard
  const handleRSVP = useCallback(
    async (savedCardId: string, rsvp: 'yes' | 'no') => {
      if (!userId || !sessionId || isRSVPingRef.current) return;
      isRSVPingRef.current = true;

      setIsRSVPing(true);

      // Get current RSVP state — query DB if local state is empty/stale
      let currentRsvpCounts = rsvpCounts[savedCardId];
      if (
        !currentRsvpCounts ||
        (currentRsvpCounts.userRSVP === null &&
          currentRsvpCounts.responded === 0)
      ) {
        const { data: allCardRsvps, error: rsvpCheckError } = await supabase
          .from('board_card_rsvps')
          .select('rsvp_status, user_id')
          .eq('session_id', sessionId)
          .eq('saved_card_id', savedCardId);

        if (!rsvpCheckError && allCardRsvps) {
          const attendees = allCardRsvps
            .filter((r) => r.rsvp_status === 'attending')
            .map((r) => r.user_id);
          const totalResponded = attendees.length;
          const userRsvpRaw = allCardRsvps.find(
            (r) => String(r.user_id) === String(userId)
          )?.rsvp_status;
          const userRSVP =
            userRsvpRaw === 'attending'
              ? 'yes'
              : userRsvpRaw === 'not_attending'
              ? 'no'
              : null;

          currentRsvpCounts = {
            responded: totalResponded,
            total: participantCount,
            userRSVP,
            attendees,
          };
        } else {
          currentRsvpCounts = {
            responded: 0,
            total: participantCount,
            userRSVP: null,
            attendees: [],
          };
        }
      }

      // Compute optimistic state
      const previousRSVP = currentRsvpCounts.userRSVP;
      let newResponded = currentRsvpCounts.responded;
      let newAttendees = [...currentRsvpCounts.attendees];
      let finalRSVP: 'yes' | 'no' | null;

      if (rsvp === 'yes') {
        if (previousRSVP === 'yes') {
          // Toggle off — store "not attending" instead of removing
          finalRSVP = 'no';
          newResponded = Math.max(0, newResponded - 1);
          newAttendees = newAttendees.filter((a) => a !== userId);
        } else {
          // New RSVP or change from no
          finalRSVP = 'yes';
          if (previousRSVP === null) {
            newResponded = Math.min(participantCount, newResponded + 1);
          }
          newAttendees.push(userId);
        }
      } else {
        // Explicit "no" RSVP
        finalRSVP = 'no';
        if (previousRSVP === 'yes') {
          newResponded = Math.max(0, newResponded - 1);
          newAttendees = newAttendees.filter((a) => a !== userId);
        }
      }

      // Apply optimistic update
      setRsvpCounts((prev) => ({
        ...prev,
        [savedCardId]: {
          ...currentRsvpCounts,
          responded: newResponded,
          userRSVP: finalRSVP,
          attendees: newAttendees,
        },
      }));

      try {
        if (finalRSVP === 'no') {
          // Store "not attending" — don't delete, so other users can see the explicit decline
          const { error } = await supabase
            .from('board_card_rsvps')
            .upsert(
              {
                session_id: sessionId,
                saved_card_id: savedCardId,
                user_id: userId,
                rsvp_status: 'not_attending',
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'session_id,saved_card_id,user_id' }
            );

          if (error) throw error;
        } else {
          const rsvpStatus =
            finalRSVP === 'yes' ? 'attending' : 'not_attending';

          // Upsert RSVP — single round-trip, race-condition safe
          const { error } = await supabase
            .from('board_card_rsvps')
            .upsert(
              {
                session_id: sessionId,
                saved_card_id: savedCardId,
                user_id: userId,
                rsvp_status: rsvpStatus,
              },
              { onConflict: 'session_id,saved_card_id,user_id' }
            );

          if (error) throw error;

          // Notify card saver about RSVP (fire-and-forget, only for 'attending')
          if (rsvpStatus === 'attending') {
            import('../services/boardNotificationService').then(({ notifyCardRsvp }) => {
              Promise.all([
                supabase.from('board_saved_cards').select('saved_by, experience_data').eq('id', savedCardId).maybeSingle(),
                supabase.from('collaboration_sessions').select('name').eq('id', sessionId).maybeSingle(),
                supabase.from('profiles').select('display_name, first_name').eq('id', userId).maybeSingle(),
              ]).then(([cardRes, sessionRes, profileRes]) => {
                const cardData = cardRes.data;
                if (cardData?.saved_by && cardData.saved_by !== userId) {
                  const rsvperName = getDisplayName(profileRes.data);
                  notifyCardRsvp({
                    sessionId,
                    sessionName: sessionRes.data?.name || 'Session',
                    userId: userId!,
                    userName: rsvperName,
                    savedCardId,
                    cardName: (cardData.experience_data as Record<string, unknown>)?.title as string || undefined,
                    cardSaverId: cardData.saved_by,
                  });
                }
              });
            }).catch(() => {});
          }
        }

        // Note: DB trigger check_card_lock_in handles lock-in automatically.
        // loadCounts will pick up any lock state changes.
        loadCounts();
      } catch (err: unknown) {
        console.error('[useSessionVoting] Error RSVPing:', err);
        // Rollback
        setRsvpCounts((prev) => ({
          ...prev,
          [savedCardId]: currentRsvpCounts,
        }));
        Alert.alert('Error', 'Failed to update RSVP');
      } finally {
        isRSVPingRef.current = false;
        setIsRSVPing(false);
      }
    },
    [userId, sessionId, rsvpCounts, participantCount, loadCounts]
  );

  // Stable ref for loadCounts — prevents useEffect re-runs when participantCount changes
  const loadCountsRef = useRef(loadCounts);
  useEffect(() => { loadCountsRef.current = loadCounts; }, [loadCounts]);

  // Load vote/RSVP/lock counts immediately on mount.
  // Don't rely solely on realtime events — the channel may not be ready yet,
  // and there may be no other active users to trigger an event.
  useEffect(() => {
    if (sessionId && userId) {
      loadCounts();
    }
  }, [sessionId, userId, loadCounts]);

  // Listen for realtime vote/RSVP/lock events — only depends on sessionId
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onCardVoted: () => {
        loadCountsRef.current();
      },
      onCardRSVP: () => {
        loadCountsRef.current();
      },
      onCardLocked: (savedCardId: string, lockedAt: string) => {
        // Immediately update locked state without waiting for full reload
        setLockedCards((prev) => ({
          ...prev,
          [savedCardId]: { isLocked: true, lockedAt },
        }));
        // Also reload for consistency
        loadCountsRef.current();
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);

    return () => {
      // Remove this specific callback set without destroying the shared channel
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
    };
  }, [sessionId]);

  return {
    voteCounts,
    rsvpCounts,
    lockedCards,
    handleVote,
    handleRSVP,
    loadCounts,
    isVoting,
    isRSVPing,
  };
}
