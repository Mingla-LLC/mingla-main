import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BoardHeader } from "./BoardHeader";
import { BoardTabs, BoardTab } from "./BoardTabs";
import { Participant } from "./ParticipantAvatars";
import { useBoardSession } from "../../hooks/useBoardSession";
import { supabase } from "../../services/supabase";
import { realtimeService } from "../../services/realtimeService";
import { useAppStore } from "../../store/appStore";
import SwipeableBoardCards from "../SwipeableBoardCards";
import { BoardSettingsModal } from "./BoardSettingsModal";
import { BoardDiscussionTab } from "./BoardDiscussionTab";
import { CardDiscussionModal } from "./CardDiscussionModal";
import { BoardErrorHandler } from "../../services/boardErrorHandler";
import { useNetworkMonitor } from "../../services/networkMonitor";
import { BoardCache } from "../../services/boardCache";
import { BoardMessageService } from "../../services/boardMessageService";
import { BoardSessionCard } from "./BoardSessionCard";

interface BoardViewScreenProps {
  sessionId: string;
  onBack?: () => void;
  onNavigateToSession?: (sessionId: string) => void;
  onExitBoard?: (sessionId?: string, sessionName?: string) => void;
}

interface SavedCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: any; // JSONB field containing full card data
  experience_data?: any; // Legacy field, kept for backward compatibility
}

export const BoardViewScreen: React.FC<BoardViewScreenProps> = ({
  sessionId,
  onBack,
  onNavigateToSession,
  onExitBoard,
}) => {
  const {
    session,
    preferences,
    loading: sessionLoading,
    error: sessionError,
  } = useBoardSession(sessionId);
  const { user } = useAppStore();
  const networkState = useNetworkMonitor();
  const [activeTab, setActiveTab] = useState<BoardTab>("saved");
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardForDiscussion, setSelectedCardForDiscussion] = useState<{
    savedCardId: string;
    cardTitle: string;
  } | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showExitMenu, setShowExitMenu] = useState(false);
  const [exitMenuItemPressed, setExitMenuItemPressed] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);

  // Load saved cards for the session with pagination
  const [savedCardsPage, setSavedCardsPage] = useState(0);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const CARDS_PER_PAGE = 20;

  const loadSavedCards = useCallback(
    async (page: number = 0, append: boolean = false) => {
      if (!sessionId) return;

      // Check cache first
      const cacheKey = BoardCache.getSavedCardsKey(sessionId, page);
      const cached = await BoardCache.get<any[]>(cacheKey);
      if (cached && !append) {
        setSavedCards(cached);
        setLoadingCards(false);
        // Still fetch in background to update cache
      }

      setLoadingCards(true);
      try {
        const { data, error } = await supabase
          .from("board_saved_cards")
          .select("*")
          .eq("session_id", sessionId)
          .order("saved_at", { ascending: false })
          .range(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE - 1);

        if (error) {
          const boardError = BoardErrorHandler.handleNetworkError(error);
          BoardErrorHandler.showError(boardError, () =>
            loadSavedCards(page, append)
          );
          return;
        }

        // Cache the data
        await BoardCache.set(cacheKey, data || [], 2 * 60 * 1000); // 2 minutes

        if (append) {
          setSavedCards((prev) => [...prev, ...(data || [])]);
          // Initialize vote counts for newly appended cards
          const newCounts: Record<
            string,
            { yes: number; no: number; userVote: "yes" | "no" | null }
          > = {};
          (data || []).forEach((card) => {
            newCounts[card.id] = {
              yes: 0,
              no: 0,
              userVote: null,
            };
          });
          setVoteCounts((prev) => ({ ...prev, ...newCounts }));
        } else {
          setSavedCards(data || []);
          // Initialize vote counts for all cards (even if 0) so they display immediately
          const initialCounts: Record<
            string,
            { yes: number; no: number; userVote: "yes" | "no" | null }
          > = {};
          (data || []).forEach((card) => {
            initialCounts[card.id] = {
              yes: 0,
              no: 0,
              userVote: null,
            };
          });
          setVoteCounts(initialCounts);
        }

        setHasMoreCards((data || []).length === CARDS_PER_PAGE);
        setSavedCardsPage(page);
      } catch (err: any) {
        console.error("Error loading saved cards:", err);
        const boardError = BoardErrorHandler.handleNetworkError(err);
        BoardErrorHandler.showError(boardError);
      } finally {
        setLoadingCards(false);
      }
    },
    [sessionId]
  );

  // Load participants
  const loadParticipants = useCallback(async () => {
    if (!sessionId) return;

    try {
      const { data, error } = await supabase
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
        .eq("session_id", sessionId);

      if (error) throw error;

      setParticipants((data || []) as Participant[]);
    } catch (err: any) {
      console.error("Error loading participants:", err);
    }
  }, [sessionId]);

  // Load unread message count
  const loadUnreadCount = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    try {
      const { count, error } =
        await BoardMessageService.getUnreadBoardMessagesCount(
          sessionId,
          user.id
        );

      if (error) {
        console.warn("Error loading unread count:", error);
        setUnreadMessages(0);
        return;
      }

      setUnreadMessages(count || 0);
    } catch (err: any) {
      console.error("Error loading unread count:", err);
      setUnreadMessages(0);
    }
  }, [sessionId, user?.id]);

  // Handle card vote with optimistic UI updates
  const handleVote = useCallback(
    async (cardId: string, vote: "yes" | "no") => {
      if (!user?.id || !sessionId) return;

      const savedCard = savedCards.find(
        (c) => c.id === cardId || c.saved_card_id === cardId
      );
      if (!savedCard) {
        console.error("Card not found for vote:", cardId);
        return;
      }

      // Use the primary key ID from board_saved_cards table
      const savedCardId = savedCard.id;

      // Get current vote state - if not in state or has default values, query DB directly
      let currentVoteCounts = voteCounts[savedCardId];

      // Check if state is missing or has default/empty values (might be stale)
      if (
        !currentVoteCounts ||
        (currentVoteCounts.userVote === null &&
          currentVoteCounts.yes === 0 &&
          currentVoteCounts.no === 0)
      ) {
        // Query the database directly to get current vote state
        const { data: allCardVotes, error: voteCheckError } = await supabase
          .from("board_votes")
          .select("vote_type, user_id")
          .eq("session_id", sessionId)
          .eq("saved_card_id", savedCardId);

        if (!voteCheckError && allCardVotes) {
          const yesVotes = allCardVotes.filter(
            (v) => v.vote_type === "up"
          ).length;
          const noVotes = allCardVotes.filter(
            (v) => v.vote_type === "down"
          ).length;
          const userVoteRaw = allCardVotes.find(
            (v) => String(v.user_id) === String(user.id)
          )?.vote_type;
          const userVote =
            userVoteRaw === "up" ? "yes" : userVoteRaw === "down" ? "no" : null;

          currentVoteCounts = {
            yes: yesVotes,
            no: noVotes,
            userVote,
          };
        } else {
          currentVoteCounts = {
            yes: 0,
            no: 0,
            userVote: null,
          };
        }
      }

      // Optimistic update: immediately update UI
      const previousVote = currentVoteCounts.userVote;
      let newYesCount = currentVoteCounts.yes;
      let newNoCount = currentVoteCounts.no;
      let finalVote: "yes" | "no" | null;

      // Toggle behavior:
      // - If clicking the same button (upvote when already upvoted, or downvote when already downvoted), remove the vote
      // - If clicking a different button or no vote exists, switch to that vote
      if (vote === previousVote) {
        // User clicked the same button - toggle it off (remove vote)
        finalVote = null;
        if (previousVote === "yes") {
          newYesCount = Math.max(0, newYesCount - 1);
        } else if (previousVote === "no") {
          newNoCount = Math.max(0, newNoCount - 1);
        }
      } else {
        // User clicked a different button or has no vote - switch to the clicked vote
        finalVote = vote;

        // Remove previous vote if it exists (switching from upvote to downvote or vice versa)
        if (previousVote === "yes") {
          newYesCount = Math.max(0, newYesCount - 1);
        } else if (previousVote === "no") {
          newNoCount = Math.max(0, newNoCount - 1);
        }

        // Add the new vote
        if (vote === "yes") {
          newYesCount += 1;
        } else {
          newNoCount += 1;
        }
      }

      // Update state immediately (optimistic)
      setVoteCounts((prev) => ({
        ...prev,
        [savedCardId]: {
          yes: newYesCount,
          no: newNoCount,
          userVote: finalVote,
        },
      }));

      try {
        // Convert 'yes'/'no' to 'up'/'down' for database
        const voteType =
          finalVote === "yes" ? "up" : finalVote === "no" ? "down" : null;

        if (voteType === null) {
          // Remove vote
          const { data: deleteData, error } = await supabase
            .from("board_votes")
            .delete()
            .eq("session_id", sessionId)
            .eq("saved_card_id", savedCardId)
            .eq("user_id", user.id)
            .select();

          if (error) {
            throw error;
          }
        } else {
          // Check if vote already exists
          const { data: existingVote, error: checkError } = await supabase
            .from("board_votes")
            .select("id")
            .eq("session_id", sessionId)
            .eq("saved_card_id", savedCardId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (checkError) throw checkError;

          if (existingVote) {
            // Update existing vote
            const { error } = await supabase
              .from("board_votes")
              .update({ vote_type: voteType })
              .eq("id", existingVote.id);

            if (error) throw error;
          } else {
            // Insert new vote
            const { error } = await supabase.from("board_votes").insert({
              session_id: sessionId,
              saved_card_id: savedCardId,
              user_id: user.id,
              vote_type: voteType,
            });

            if (error) throw error;
          }
        }

        // Broadcast vote update
        if (voteType !== null) {
          realtimeService.broadcastVoteUpdate(sessionId, savedCardId, {
            user_id: user.id,
            vote_type: voteType,
          });
        }

        // Reload vote counts to ensure accuracy (in case of race conditions)
        // Use a small delay to ensure database operation completes
        setTimeout(() => {
          loadVoteAndRSVPCounts();
        }, 100);
      } catch (err: any) {
        console.error("Error voting:", err);

        // Rollback optimistic update on error
        setVoteCounts((prev) => ({
          ...prev,
          [savedCardId]: currentVoteCounts,
        }));

        Alert.alert("Error", "Failed to submit vote");
      }
    },
    [user?.id, sessionId, savedCards, voteCounts, loadVoteAndRSVPCounts]
  );

  // Handle RSVP with optimistic UI updates
  const handleRSVP = useCallback(
    async (cardId: string, rsvp: "yes" | "no") => {
      if (!user?.id || !sessionId) return;

      // Check network
      if (!networkState.isConnected) {
        Alert.alert(
          "No Connection",
          "Please check your internet connection and try again."
        );
        return;
      }

      const savedCard = savedCards.find(
        (c) => c.id === cardId || c.saved_card_id === cardId
      );
      if (!savedCard) {
        console.error("Card not found for RSVP:", cardId);
        Alert.alert("Error", "Card not found");
        return;
      }

      // Get current RSVP state - if not in state or has default values, query DB directly
      let currentRsvpCounts = rsvpCounts[savedCard.id];

      // Check if state is missing or has default/empty values (might be stale)
      if (
        !currentRsvpCounts ||
        (currentRsvpCounts.userRSVP === null &&
          currentRsvpCounts.responded === 0)
      ) {
        // Query the database directly to get current RSVP state
        const { data: allCardRSVPs, error: rsvpCheckError } = await supabase
          .from("board_card_rsvps")
          .select("rsvp_status, user_id")
          .eq("session_id", sessionId)
          .eq("saved_card_id", savedCard.id);

        if (!rsvpCheckError && allCardRSVPs) {
          const totalParticipants = participants.filter(
            (p) => p.has_accepted
          ).length;
          const yesRSVPs = allCardRSVPs.filter(
            (r) => r.rsvp_status === "attending"
          ).length;
          const noRSVPs = allCardRSVPs.filter(
            (r) => r.rsvp_status === "not_attending"
          ).length;
          const userRSVPRaw = allCardRSVPs.find(
            (r) => String(r.user_id) === String(user.id)
          )?.rsvp_status;
          const userRSVP =
            userRSVPRaw === "attending"
              ? "yes"
              : userRSVPRaw === "not_attending"
              ? "no"
              : null;

          currentRsvpCounts = {
            responded: yesRSVPs + noRSVPs,
            total: totalParticipants,
            userRSVP,
          };
        } else {
          currentRsvpCounts = {
            responded: 0,
            total: participants.filter((p) => p.has_accepted).length,
            userRSVP: null,
          };
        }
      }

      // Optimistic update: immediately update UI
      const previousRSVP = currentRsvpCounts.userRSVP;
      let newResponded = currentRsvpCounts.responded;
      let finalRSVP: "yes" | "no" | null;

      // Determine the final RSVP state
      if (rsvp === "yes") {
        if (previousRSVP === "yes") {
          // User clicked RSVP Yes when already RSVP'd - toggle off
          finalRSVP = null;
          newResponded = Math.max(0, newResponded - 1);
        } else {
          // User is RSVP'ing yes for the first time or changing from no
          finalRSVP = "yes";
          if (previousRSVP === null) {
            // First time RSVP'ing
            newResponded = Math.min(currentRsvpCounts.total, newResponded + 1);
          }
          // If changing from "no", responded count stays the same
        }
      } else {
        // RSVP "no" - remove RSVP
        finalRSVP = null;
        if (previousRSVP === "yes") {
          newResponded = Math.max(0, newResponded - 1);
        }
      }

      // Update state immediately (optimistic)
      setRsvpCounts((prev) => ({
        ...prev,
        [savedCard.id]: {
          ...currentRsvpCounts,
          responded: newResponded,
          userRSVP: finalRSVP,
        },
      }));

      try {
        if (finalRSVP === null) {
          // Remove RSVP
          const { error } = await supabase
            .from("board_card_rsvps")
            .delete()
            .eq("session_id", sessionId)
            .eq("saved_card_id", savedCard.id)
            .eq("user_id", user.id);

          if (error) throw error;
        } else {
          // Convert 'yes'/'no' to 'attending'/'not_attending' for database
          const rsvpStatus =
            finalRSVP === "yes" ? "attending" : "not_attending";

          // Check if RSVP already exists
          const { data: existingRSVP, error: checkError } = await supabase
            .from("board_card_rsvps")
            .select("id")
            .eq("session_id", sessionId)
            .eq("saved_card_id", savedCard.id)
            .eq("user_id", user.id)
            .maybeSingle();

          if (checkError) throw checkError;

          if (existingRSVP) {
            // Update existing RSVP
            const { error } = await supabase
              .from("board_card_rsvps")
              .update({ rsvp_status: rsvpStatus })
              .eq("id", existingRSVP.id);

            if (error) throw error;
          } else {
            // Insert new RSVP
            const { error } = await supabase.from("board_card_rsvps").insert({
              session_id: sessionId,
              saved_card_id: savedCard.id,
              user_id: user.id,
              rsvp_status: rsvpStatus,
            });

            if (error) throw error;
          }

          // Broadcast RSVP update
          realtimeService.broadcastRSVPUpdate(sessionId, savedCard.id, {
            user_id: user.id,
            rsvp_status: rsvpStatus,
          });
        }

        // Reload RSVP counts to ensure accuracy (in case of race conditions)
        loadVoteAndRSVPCounts();
      } catch (err: any) {
        console.error("Error RSVPing:", err);
        const boardError = BoardErrorHandler.handleNetworkError(err);
        BoardErrorHandler.showError(boardError);
      }
    },
    [
      user?.id,
      sessionId,
      savedCards,
      rsvpCounts,
      participants,
      loadVoteAndRSVPCounts,
      networkState.isConnected,
    ]
  );

  // Handle exit board
  const handleExitBoard = useCallback(async () => {
    if (!user?.id || !sessionId) return;

    // Get session name before exiting to check if it's the active session
    const sessionName = session?.name;

    Alert.alert(
      "Exit Board",
      "Are you sure you want to exit this board? You will no longer receive updates or be able to participate.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Exit",
          style: "destructive",
          onPress: async () => {
            // OPTIMISTIC UPDATES FIRST - Update UI immediately
            // 1. Remove board from boards list immediately
            if (onExitBoard) {
              // Pass sessionId and sessionName so parent can optimistically remove it
              // Parent will handle database operations and refresh
              onExitBoard(sessionId, sessionName);
            }

            // 2. Navigate back immediately (before DB operations)
            if (onBack) {
              onBack();
            }
          },
        },
      ]
    );
  }, [user?.id, sessionId, session?.name, onBack, onExitBoard]);

  // Load card message counts
  const [cardMessageCounts, setCardMessageCounts] = useState<
    Record<string, number>
  >({});

  const loadCardMessageCounts = useCallback(async () => {
    if (!sessionId || !user?.id || savedCards.length === 0) return;

    try {
      const savedCardIds = savedCards.map((c) => c.id);
      const { data, error } = await supabase
        .from("board_card_messages")
        .select("saved_card_id")
        .eq("session_id", sessionId)
        .in("saved_card_id", savedCardIds)
        .is("deleted_at", null);

      if (error) throw error;

      // Count messages per card
      const counts: Record<string, number> = {};
      savedCardIds.forEach((cardId) => {
        counts[cardId] = (data || []).filter(
          (m) => m.saved_card_id === cardId
        ).length;
      });

      setCardMessageCounts(counts);
    } catch (err: any) {
      console.error("Error loading card message counts:", err);
    }
  }, [sessionId, user?.id, savedCards]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onCardSaved: (card) => {
        setSavedCards((prev) => {
          if (prev.find((c) => c.id === card.id)) return prev;
          return [card, ...prev];
        });
        loadCardMessageCounts();
      },
      onCardVoted: () => {
        loadVoteAndRSVPCounts();
      },
      onCardRSVP: () => {
        loadVoteAndRSVPCounts();
      },
      onMessage: () => {
        loadUnreadCount();
        loadCardMessageCounts();
      },
      onCardMessage: () => {
        loadCardMessageCounts();
      },
      onParticipantJoined: () => {
        loadParticipants();
      },
      onParticipantLeft: () => {
        loadParticipants();
      },
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
    };
  }, [
    sessionId,
    loadSavedCards,
    loadUnreadCount,
    loadParticipants,
    loadCardMessageCounts,
    loadVoteAndRSVPCounts,
  ]);

  // Validate session and permissions on mount
  useEffect(() => {
    const validateSession = async () => {
      if (!sessionId || !user?.id) return;

      // Check session validity
      const validityCheck = await BoardErrorHandler.checkSessionValidity(
        sessionId
      );
      setSessionValid(validityCheck.valid);

      if (!validityCheck.valid && validityCheck.error) {
        BoardErrorHandler.showError(validityCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }

      // Check permissions
      const permissionCheck = await BoardErrorHandler.checkSessionPermission(
        sessionId,
        user.id
      );
      setHasPermission(permissionCheck.hasPermission);
      setIsAdmin(permissionCheck.isAdmin || false);

      if (!permissionCheck.hasPermission && permissionCheck.error) {
        BoardErrorHandler.showError(permissionCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }
    };

    validateSession();
  }, [sessionId, user?.id, onBack]);

  // Load data on mount
  useEffect(() => {
    if (sessionValid && hasPermission) {
      loadSavedCards(0, false);
      loadParticipants();
      loadUnreadCount();
    }
  }, [
    sessionValid,
    hasPermission,
    loadSavedCards,
    loadParticipants,
    loadUnreadCount,
  ]);

  // Load vote and RSVP counts for saved cards
  const [voteCounts, setVoteCounts] = useState<
    Record<string, { yes: number; no: number; userVote: "yes" | "no" | null }>
  >({});
  const [rsvpCounts, setRsvpCounts] = useState<
    Record<
      string,
      { responded: number; total: number; userRSVP: "yes" | "no" | null }
    >
  >({});

  const loadVoteAndRSVPCounts = useCallback(async () => {
    if (!sessionId || !user?.id || savedCards.length === 0) return;

    try {
      // Load vote counts for all saved cards
      const savedCardIds = savedCards.map((c) => c.id);

      // If no saved cards, return early
      if (savedCardIds.length === 0) {
        return;
      }

      const { data: votesData, error: votesError } = await supabase
        .from("board_votes")
        .select("*")
        .eq("session_id", sessionId)
        .in("saved_card_id", savedCardIds);

      if (votesError) {
        console.error("❌ Error loading votes:", votesError);
        throw votesError;
      }

      // If no votes returned but we expect some, log a warning
      if (!votesData || votesData.length === 0) {
        console.warn(
          "⚠️ No votes returned from database for cards:",
          savedCardIds
        );
      }

      // Aggregate vote counts (convert 'up'/'down' to 'yes'/'no')
      const counts: Record<
        string,
        { yes: number; no: number; userVote: "yes" | "no" | null }
      > = {};

      savedCards.forEach((card) => {
        // Try matching by both card.id and any potential saved_card_id field
        const cardVotes =
          votesData?.filter(
            (v) =>
              v.saved_card_id === card.id ||
              v.saved_card_id === card.saved_card_id ||
              String(v.saved_card_id) === String(card.id)
          ) || [];

        const yesVotes = cardVotes.filter((v) => v.vote_type === "up").length;
        const noVotes = cardVotes.filter((v) => v.vote_type === "down").length;

        // Find user's vote - check both string and UUID comparison
        const userVoteRaw = cardVotes.find(
          (v) => String(v.user_id) === String(user.id)
        )?.vote_type;
        const userVote =
          userVoteRaw === "up" ? "yes" : userVoteRaw === "down" ? "no" : null;

        counts[card.id] = {
          yes: yesVotes,
          no: noVotes,
          userVote,
        };
      });

      // Merge with existing counts to preserve any cards that might not be in current savedCards
      setVoteCounts((prev) => ({ ...prev, ...counts }));

      // Load RSVP counts
      const { data: rsvpsData, error: rsvpsError } = await supabase
        .from("board_card_rsvps")
        .select("*")
        .eq("session_id", sessionId)
        .in("saved_card_id", savedCardIds);

      if (rsvpsError) throw rsvpsError;

      // Aggregate RSVP counts (convert 'attending'/'not_attending' to 'yes'/'no')
      const rsvpCountsData: Record<
        string,
        { responded: number; total: number; userRSVP: "yes" | "no" | null }
      > = {};
      const totalParticipants = participants.filter(
        (p) => p.has_accepted
      ).length;
      savedCards.forEach((card) => {
        const cardRSVPs =
          rsvpsData?.filter((r) => r.saved_card_id === card.id) || [];
        const yesRSVPs = cardRSVPs.filter(
          (r) => r.rsvp_status === "attending"
        ).length;
        const noRSVPs = cardRSVPs.filter(
          (r) => r.rsvp_status === "not_attending"
        ).length;
        const userRSVPRaw = cardRSVPs.find(
          (r) => r.user_id === user.id
        )?.rsvp_status;
        const userRSVP =
          userRSVPRaw === "attending"
            ? "yes"
            : userRSVPRaw === "not_attending"
            ? "no"
            : null;

        rsvpCountsData[card.id] = {
          responded: yesRSVPs + noRSVPs,
          total: totalParticipants,
          userRSVP,
        };
      });
      setRsvpCounts(rsvpCountsData);
    } catch (err: any) {
      console.error("Error loading vote/RSVP counts:", err);
    }
  }, [sessionId, user?.id, savedCards, participants]);

  useEffect(() => {
    if (savedCards.length > 0) {
      loadVoteAndRSVPCounts();
      loadCardMessageCounts();
    }
  }, [savedCards, loadVoteAndRSVPCounts, loadCardMessageCounts]);

  // Transform saved cards to board card format
  const boardCards = savedCards.map((savedCard) => {
    // Use card_data JSONB field (which contains the full card data)
    const experience = savedCard.card_data || savedCard.experience_data || {};
    const voteData = voteCounts[savedCard.id] || {
      yes: 0,
      no: 0,
      userVote: null,
    };
    const rsvpData = rsvpCounts[savedCard.id] || {
      responded: 0,
      total: participants.filter((p) => p.has_accepted).length,
      userRSVP: null,
    };
    const messageCount = cardMessageCounts[savedCard.id] || 0;

    return {
      id: experience.id || savedCard.saved_card_id || savedCard.id,
      title: experience.title || "Untitled Experience",
      category: experience.category || "Experience",
      categoryIcon: experience.categoryIcon || "star",
      image: experience.image || "",
      images: experience.images || [],
      rating: experience.rating || 0,
      reviewCount: experience.reviewCount || 0,
      travelTime: experience.travelTime || "N/A",
      priceRange: experience.priceRange || "N/A",
      description: experience.description || "",
      fullDescription: experience.fullDescription || "",
      address: experience.address || "",
      highlights: experience.highlights || [],
      matchScore: experience.matchScore || 0,
      socialStats: experience.socialStats || { views: 0, likes: 0, saves: 0 },
      votes: voteData,
      rsvps: rsvpData,
      messages: messageCount,
      isLocked: false,
    };
  });

  const handleDeleteSession = useCallback(async () => {
    if (deletingSession) return;
    if (!sessionId || !user?.id) return;
    if (!isAdmin && session?.created_by !== user.id) {
      Alert.alert("Permission denied", "Only admins can delete this session.");
      return;
    }

    try {
      setDeletingSession(true);
      const { error } = await supabase
        .from("collaboration_sessions")
        .delete()
        .eq("id", sessionId);

      if (error) throw error;

      // Optimistic cleanup in parent
      if (onExitBoard) {
        onExitBoard(sessionId, session?.name);
      }

      if (onBack) {
        onBack();
      }
    } catch (error: any) {
      console.error("Error deleting session:", error);
      Alert.alert(
        "Delete failed",
        error?.message || "Unable to delete this session."
      );
    } finally {
      setDeletingSession(false);
      setShowSettings(false);
    }
  }, [
    deletingSession,
    sessionId,
    user?.id,
    isAdmin,
    session?.created_by,
    session?.name,
    onExitBoard,
    onBack,
  ]);

  // Show network error banner
  const showNetworkBanner = !networkState.isConnected;

  if (sessionLoading || sessionValid === null || hasPermission === null) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      </View>
    );
  }

  if (sessionError || !session || !sessionValid || !hasPermission) {
    const error = sessionError
      ? BoardErrorHandler.handleSessionError({ message: sessionError })
      : !sessionValid
      ? { userFriendlyMessage: "This board session is no longer available." }
      : !hasPermission
      ? {
          userFriendlyMessage:
            "You don't have permission to access this session.",
        }
      : { userFriendlyMessage: "Session not found" };

    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#FF3B30" />
          <Text style={styles.errorText}>
            {error.userFriendlyMessage || "Session not found"}
          </Text>
          {onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Network Error Banner */}
      {showNetworkBanner && (
        <View style={styles.networkBanner}>
          <Ionicons name="wifi-outline" size={16} color="white" />
          <Text style={styles.networkBannerText}>
            No internet connection. Some features may be unavailable.
          </Text>
        </View>
      )}

      <BoardHeader
        session={session}
        participants={participants}
        onBack={onBack}
        onSettingsPress={() => {
          if (isAdmin || session.created_by === user?.id) {
            setShowSettings(true);
          } else {
            // Show exit menu for non-admins
            setShowExitMenu(true);
          }
        }}
        loading={loadingCards}
      />

      <BoardTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        savedCount={savedCards.length}
        unreadMessages={unreadMessages}
      />

      <View style={styles.content}>
        {activeTab === "saved" && (
          <View style={styles.savedContainer}>
            {/* Session Cards Header */}
            {savedCards.length > 0 && (
              <View style={styles.sessionCardsHeader}>
                <Text style={styles.sessionCardsTitle}>Session Cards</Text>
                {/*   <View style={styles.sessionCardsNav}>
                  <Text style={styles.sessionCardsCounter}>
                    {savedCardsPage * 20 + 1} of {savedCards.length}
                  </Text>
                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={() => {
                      // Navigate to previous card if implemented
                    }}
                  >
                    <Ionicons name="chevron-back" size={20} color="#6b7280" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={() => {
                      // Navigate to next card if implemented
                    }}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color="#6b7280"
                    />
                  </TouchableOpacity>
                </View> */}
              </View>
            )}

            <ScrollView
              onScrollEndDrag={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } =
                  e.nativeEvent;
                const isCloseToBottom =
                  contentOffset.y + layoutMeasurement.height >=
                  contentSize.height - 200;
                if (isCloseToBottom && hasMoreCards && !loadingCards) {
                  loadSavedCards(savedCardsPage + 1, true);
                }
              }}
              scrollEventThrottle={400}
            >
              {loadingCards && savedCards.length === 0 ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#eb7825" />
                </View>
              ) : savedCards.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="images-outline" size={64} color="#ccc" />
                  <Text style={styles.emptyText}>No saved cards yet</Text>
                  <Text style={styles.emptySubtext}>
                    Swipe right on cards to save them to this board
                  </Text>
                </View>
              ) : (
                <>
                  {savedCards.map((card, index) => {
                    const voteCount = voteCounts[card.id] || {
                      yes: 0,
                      no: 0,
                      userVote: null,
                    };
                    const rsvpCount = rsvpCounts[card.id] || {
                      responded: 0,
                      total: participants.filter((p) => p.has_accepted).length,
                      userRSVP: null,
                    };
                    return (
                      <BoardSessionCard
                        key={card.id}
                        card={card}
                        voteCounts={voteCount}
                        rsvpCounts={rsvpCount}
                        onVote={handleVote}
                        onRSVP={handleRSVP}
                        onViewDetails={(cardId) => {
                          const cardData =
                            card.card_data || card.experience_data || {};
                          setSelectedCardForDiscussion({
                            savedCardId: card.id,
                            cardTitle: cardData.title || "Untitled",
                          });
                        }}
                        currentIndex={index}
                        totalCards={savedCards.length}
                      />
                    );
                  })}
                  {loadingCards && savedCards.length > 0 && (
                    <View style={styles.loadingMoreContainer}>
                      <ActivityIndicator size="small" color="#eb7825" />
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        )}

        {activeTab === "discussion" && (
          <BoardDiscussionTab
            sessionId={sessionId}
            participants={participants}
            onUnreadCountChange={loadUnreadCount}
          />
        )}
      </View>

      {showSettings && (
        <BoardSettingsModal
          visible={showSettings}
          sessionId={sessionId}
          onClose={() => setShowSettings(false)}
          onDelete={handleDeleteSession}
        />
      )}

      {selectedCardForDiscussion && (
        <CardDiscussionModal
          visible={!!selectedCardForDiscussion}
          sessionId={sessionId}
          savedCardId={selectedCardForDiscussion.savedCardId}
          cardTitle={selectedCardForDiscussion.cardTitle}
          participants={participants}
          onClose={() => setSelectedCardForDiscussion(null)}
        />
      )}

      {/* Exit Board Menu Popover */}
      {showExitMenu && (
        <TouchableOpacity
          style={styles.exitMenuOverlay}
          activeOpacity={1}
          onPress={() => setShowExitMenu(false)}
        >
          <View style={styles.exitMenuPopover}>
            <TouchableOpacity
              style={[
                styles.exitMenuItem,
                exitMenuItemPressed && styles.exitMenuItemPressed,
              ]}
              onPress={() => {
                setShowExitMenu(false);
                handleExitBoard();
              }}
              onPressIn={() => setExitMenuItemPressed(true)}
              onPressOut={() => setExitMenuItemPressed(false)}
              activeOpacity={1}
            >
              <Ionicons name="exit-outline" size={20} color="#FF3B30" />
              <Text style={styles.exitMenuText}>Exit Board</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    fontWeight: "500",
  },
  backButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: "white",
    fontWeight: "600",
  },
  networkBanner: {
    backgroundColor: "#FF9500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  networkBannerText: {
    color: "white",
    fontSize: 13,
    fontWeight: "500",
  },
  content: {
    flex: 1,
  },
  savedContainer: {
    flex: 1,
  },
  sessionCardsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sessionCardsTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  sessionCardsNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionCardsCounter: {
    fontSize: 14,
    color: "#6b7280",
    marginRight: 4,
  },
  navButton: {
    padding: 4,
  },
  savedCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  savedCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  savedCardDescription: {
    fontSize: 14,
    color: "#666",
  },
  discussionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  comingSoonText: {
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  loadingMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
    color: "#666",
  },
  exitMenuOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  exitMenuPopover: {
    position: "absolute",
    top: 35,
    right: 16,
    backgroundColor: "white",
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  exitMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  exitMenuItemPressed: {
    backgroundColor: "#f3f4f6",
  },
  exitMenuText: {
    fontSize: 16,
    color: "#FF3B30",
    fontWeight: "400",
  },
});
