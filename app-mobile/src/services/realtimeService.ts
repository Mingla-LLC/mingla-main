import { supabase } from "./supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import { CollaborationSession, Board, Save } from "../types";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Offline action queue item
interface QueuedAction {
  id: string;
  type: string;
  sessionId: string;
  action: any;
  timestamp: number;
  retries: number;
}

// Board session callback type
interface BoardSessionCallbacks {
  onCardSaved?: (card: any, savedBy: string) => void;
  onCardVoted?: (
    savedCardId: string,
    userId: string,
    voteType: "up" | "down"
  ) => void;
  onCardRSVP?: (
    savedCardId: string,
    userId: string,
    rsvpStatus: "attending" | "not_attending"
  ) => void;
  onMessage?: (message: any) => void;
  onCardMessage?: (savedCardId: string, message: any) => void;
  onPresenceUpdate?: (
    userId: string,
    isOnline: boolean,
    lastSeenAt: string
  ) => void;
  onTypingStart?: (userId: string, savedCardId?: string) => void;
  onTypingStop?: (userId: string, savedCardId?: string) => void;
  onParticipantJoined?: (participant: any) => void;
  onParticipantLeft?: (participant: any) => void;
  onSessionUpdated?: (session: any) => void;
  onPreferencesChanged?: (newPrefs: any, oldPrefs: any) => void;
  onDeckRegenerated?: (deckPayload: any) => void;
  onCardLocked?: (savedCardId: string, lockedAt: string) => void;
}

export class RealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private boardSessionCallbackSets: Map<string, BoardSessionCallbacks[]> = new Map();
  private offlineQueue: QueuedAction[] = [];
  private isOnline: boolean = true;
  private queueProcessing: boolean = false;

  // Session collaboration
  subscribeToSession(
    sessionId: string,
    callbacks: {
      onParticipantJoined?: (participant: any) => void;
      onParticipantLeft?: (participant: any) => void;
      onSessionUpdated?: (session: CollaborationSession) => void;
      onMessage?: (message: any) => void;
    }
  ) {
    const channelName = `session:${sessionId}`;

    if (this.channels.has(channelName)) {
      return this.channels.get(channelName);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          callbacks.onParticipantJoined?.(payload.new);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          callbacks.onParticipantLeft?.(payload.old);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "collaboration_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          callbacks.onSessionUpdated?.(payload.new as CollaborationSession);
        }
      )
      .on("broadcast", { event: "message" }, (payload) => {
        callbacks.onMessage?.(payload);
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  // Board collaboration
  subscribeToBoard(
    boardId: string,
    callbacks: {
      onBoardUpdated?: (board: Board) => void;
      onExperienceAdded?: (experience: any) => void;
      onExperienceRemoved?: (experienceId: string) => void;
      onCollaboratorJoined?: (collaborator: any) => void;
      onCollaboratorLeft?: (collaborator: any) => void;
    }
  ) {
    const channelName = `board:${boardId}`;

    if (this.channels.has(channelName)) {
      return this.channels.get(channelName);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "boards",
          filter: `id=eq.${boardId}`,
        },
        (payload) => {
          callbacks.onBoardUpdated?.(payload.new as Board);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_collaborators",
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          callbacks.onCollaboratorJoined?.(payload.new);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "board_collaborators",
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          callbacks.onCollaboratorLeft?.(payload.old);
        }
      )
      .on("broadcast", { event: "experience_added" }, (payload) => {
        callbacks.onExperienceAdded?.(payload);
      })
      .on("broadcast", { event: "experience_removed" }, (payload) => {
        callbacks.onExperienceRemoved?.(payload.experienceId);
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  // Send message to session
  sendSessionMessage(
    sessionId: string,
    message: {
      type: "text" | "experience_shared" | "board_created" | "status_update";
      content: string;
      data?: any;
    }
  ) {
    const channel = this.channels.get(`session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "message",
        payload: {
          ...message,
          timestamp: new Date().toISOString(),
          sessionId,
        },
      });
    }
  }

  // Send board update
  sendBoardUpdate(
    boardId: string,
    event: "experience_added" | "experience_removed",
    data: any
  ) {
    const channel = this.channels.get(`board:${boardId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event,
        payload: data,
      });
    }
  }

  // Unsubscribe from channel
  /**
   * Remove a specific callback set from a board session channel without destroying the channel.
   * Use this in hook cleanup effects to prevent callback accumulation.
   */
  unregisterBoardCallbacks(sessionId: string, callbacks: BoardSessionCallbacks) {
    const channelName = `board_session:${sessionId}`;
    const sets = this.boardSessionCallbackSets.get(channelName);
    if (sets) {
      const idx = sets.indexOf(callbacks);
      if (idx !== -1) {
        sets.splice(idx, 1);
      }
    }
  }

  unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
      this.boardSessionCallbackSets.delete(channelName);
    }
  }

  // Unsubscribe from all channels
  unsubscribeAll() {
    this.channels.forEach((channel, channelName) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    this.boardSessionCallbackSets.clear();
  }

  // Get active channels
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  // ===========================================
  // BOARD SESSION REAL-TIME SUBSCRIPTIONS
  // ===========================================

  /**
   * Subscribe to a board session for real-time collaboration
   * Handles: card saves, votes, RSVPs, messages, presence, typing indicators
   */
  subscribeToBoardSession(
    sessionId: string,
    callbacks: BoardSessionCallbacks
  ) {
    const channelName = `board_session:${sessionId}`;

    // Register this set of callbacks
    if (!this.boardSessionCallbackSets.has(channelName)) {
      this.boardSessionCallbackSets.set(channelName, []);
    }
    this.boardSessionCallbackSets.get(channelName)!.push(callbacks);

    // If channel already exists, return it — new callbacks are already registered above
    // and will be dispatched by the existing channel's event handlers.
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName);
    }

    // Helper: dispatch to ALL registered callback sets for this channel
    const dispatch = <K extends keyof BoardSessionCallbacks>(
      key: K,
      ...args: Parameters<NonNullable<BoardSessionCallbacks[K]>>
    ) => {
      const sets = this.boardSessionCallbackSets.get(channelName) || [];
      for (const cbSet of sets) {
        const fn = cbSet[key] as ((...a: any[]) => void) | undefined;
        fn?.(...args);
      }
    };

    const channel = supabase
      .channel(channelName)
      // Card saves
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_saved_cards",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onCardSaved', payload.new, payload.new.saved_by);
        }
      )
      // Votes
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_votes",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.new.saved_card_id) {
            dispatch('onCardVoted',
              payload.new.saved_card_id,
              payload.new.user_id,
              payload.new.vote_type
            );
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_votes",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.new.saved_card_id) {
            dispatch('onCardVoted',
              payload.new.saved_card_id,
              payload.new.user_id,
              payload.new.vote_type
            );
          }
        }
      )
      // RSVPs
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_card_rsvps",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onCardRSVP',
            payload.new.saved_card_id,
            payload.new.user_id,
            payload.new.rsvp_status
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_card_rsvps",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onCardRSVP',
            payload.new.saved_card_id,
            payload.new.user_id,
            payload.new.rsvp_status
          );
        }
      )
      // Main board messages
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onMessage', payload.new);
        }
      )
      // Card-specific messages
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_card_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onCardMessage', payload.new.saved_card_id, payload.new);
        }
      )
      // Presence updates
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_participant_presence",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onPresenceUpdate',
            payload.new.user_id,
            payload.new.is_online,
            payload.new.last_seen_at
          );
        }
      )
      // Typing indicators via broadcast
      .on("broadcast", { event: "typing_start" }, (payload) => {
        dispatch('onTypingStart', payload.userId, payload.savedCardId);
      })
      .on("broadcast", { event: "typing_stop" }, (payload) => {
        dispatch('onTypingStop', payload.userId, payload.savedCardId);
      })
      // Participants
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onParticipantJoined', payload.new);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "session_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onParticipantLeft', payload.old);
        }
      )
      // Preference changes — triggers deck refresh for all participants
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'board_session_preferences',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onPreferencesChanged', payload.new as any, payload.old as any);
        }
      )
      // Card lock-in detection (board_saved_cards UPDATE with is_locked change)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_saved_cards",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newRow = payload.new as any;
          const oldRow = payload.old as any;
          if (newRow.is_locked === true && oldRow?.is_locked !== true) {
            dispatch('onCardLocked', newRow.id, newRow.locked_at);
          }
        }
      )
      // Session deck regeneration — all participants refetch when new deck is generated
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_decks",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          dispatch('onDeckRegenerated', payload.new);
        }
      )
      // Session updates
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "collaboration_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newSession = payload.new as any;
          dispatch('onSessionUpdated', newSession);
        }
      )
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  // ===========================================
  // CARD SWIPE EVENT BROADCASTING
  // ===========================================

  /**
   * Broadcast card swipe event to all session participants
   */
  broadcastCardSwipe(
    sessionId: string,
    data: {
      experience_id: string;
      user_id: string;
      swipe_direction: "left" | "right";
      swiped_at: string;
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "card_swipe",
        payload: {
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      // Queue for offline
      this.queueAction(sessionId, "card_swipe", data);
    }
  }

  /**
   * Broadcast card save event to all session participants
   */
  broadcastCardSave(
    sessionId: string,
    data: {
      id?: string;
      session_id: string;
      saved_card_id?: string;
      saved_by?: string;
      saved_at?: string;
      experience_data?: any;
      removed?: boolean;
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "card_saved",
        payload: {
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      // Queue for offline
      this.queueAction(sessionId, "card_saved", data);
    }
  }

  // ===========================================
  // VOTE/RSVP REAL-TIME UPDATES
  // ===========================================

  /**
   * Broadcast vote update (already handled by postgres_changes, but can use for optimistic updates)
   */
  broadcastVoteUpdate(
    sessionId: string,
    savedCardId: string,
    data: {
      user_id: string;
      vote_type: "up" | "down";
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "vote_update",
        payload: {
          savedCardId,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Broadcast RSVP update
   */
  broadcastRSVPUpdate(
    sessionId: string,
    savedCardId: string,
    data: {
      user_id: string;
      rsvp_status: "attending" | "not_attending";
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "rsvp_update",
        payload: {
          savedCardId,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  // ===========================================
  // MESSAGE DELIVERY (MAIN + CARD-SPECIFIC)
  // ===========================================

  /**
   * Send message to board session (main discussion)
   */
  sendBoardMessage(
    sessionId: string,
    message: {
      content: string;
      mentions?: string[];
      replyToId?: string;
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      // Message is saved to DB via API, this just broadcasts for optimistic updates
      channel.send({
        type: "broadcast",
        event: "message_sent",
        payload: {
          ...message,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      this.queueAction(sessionId, "send_message", message);
    }
  }

  /**
   * Send message to card-specific discussion
   */
  sendCardMessage(
    sessionId: string,
    savedCardId: string,
    message: {
      content: string;
      mentions?: string[];
      replyToId?: string;
    }
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "card_message_sent",
        payload: {
          savedCardId,
          ...message,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      this.queueAction(sessionId, "send_card_message", {
        savedCardId,
        ...message,
      });
    }
  }

  // ===========================================
  // PRESENCE TRACKING
  // ===========================================

  /**
   * Update user presence in a session
   */
  async updatePresence(sessionId: string, userId: string, isOnline: boolean) {
    try {
      const { error } = await supabase
        .from("board_participant_presence")
        .upsert(
          {
            session_id: sessionId,
            user_id: userId,
            is_online: isOnline,
            last_seen_at: new Date().toISOString(),
          },
          {
            onConflict: "session_id,user_id",
          }
        );

      if (error) throw error;
    } catch (error) {
      console.error("Error updating presence:", error);
      // Queue for retry
      this.queueAction(sessionId, "update_presence", { userId, isOnline });
    }
  }

  /**
   * Mark user as online
   */
  markOnline(sessionId: string, userId: string) {
    return this.updatePresence(sessionId, userId, true);
  }

  /**
   * Mark user as offline
   */
  markOffline(sessionId: string, userId: string) {
    return this.updatePresence(sessionId, userId, false);
  }

  // ===========================================
  // TYPING INDICATORS
  // ===========================================

  /**
   * Broadcast typing start
   */
  broadcastTypingStart(
    sessionId: string,
    userId: string,
    savedCardId?: string
  ) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "typing_start",
        payload: {
          userId,
          savedCardId: savedCardId || null,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Also update database
    this.updateTypingIndicator(sessionId, userId, savedCardId, true);
  }

  /**
   * Broadcast typing stop
   */
  broadcastTypingStop(sessionId: string, userId: string, savedCardId?: string) {
    const channel = this.channels.get(`board_session:${sessionId}`);
    if (channel) {
      channel.send({
        type: "broadcast",
        event: "typing_stop",
        payload: {
          userId,
          savedCardId: savedCardId || null,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Also update database
    this.updateTypingIndicator(sessionId, userId, savedCardId, false);
  }

  /**
   * Update typing indicator in database
   * Note: Typing indicators are handled via broadcast only, no database storage needed
   */
  private async updateTypingIndicator(
    sessionId: string,
    userId: string,
    savedCardId: string | undefined,
    isTyping: boolean
  ) {
    // Typing indicators are handled via broadcast only
    // No database storage needed - this prevents errors if table doesn't exist
    return;
  }

  // ===========================================
  // OFFLINE SUPPORT - ACTION QUEUE
  // ===========================================

  /**
   * Queue an action for when connection is restored
   */
  private queueAction(sessionId: string, type: string, action: any) {
    const queuedAction: QueuedAction = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      sessionId,
      action,
      timestamp: Date.now(),
      retries: 0,
    };

    this.offlineQueue.push(queuedAction);
    this.saveQueueToStorage();
  }

  /**
   * Process queued actions when back online
   */
  private async processQueue() {
    if (this.queueProcessing || this.offlineQueue.length === 0) return;

    this.queueProcessing = true;

    while (this.offlineQueue.length > 0) {
      const action = this.offlineQueue[0];

      try {
        // Re-broadcast the action
        const channel = this.channels.get(`board_session:${action.sessionId}`);
        if (channel) {
          channel.send({
            type: "broadcast",
            event: action.type,
            payload: {
              ...action.action,
              timestamp: new Date().toISOString(),
            },
          });

          // Remove from queue on success
          this.offlineQueue.shift();
        } else {
          // Channel not available, keep in queue
          action.retries++;
          if (action.retries > 5) {
            // Remove after too many retries
            this.offlineQueue.shift();
          }
          break;
        }
      } catch (error) {
        console.error("Error processing queued action:", error);
        action.retries++;
        if (action.retries > 5) {
          this.offlineQueue.shift();
        }
        break;
      }
    }

    this.queueProcessing = false;
    this.saveQueueToStorage();
  }

  /**
   * Save queue to AsyncStorage
   */
  private async saveQueueToStorage() {
    try {
      await AsyncStorage.setItem(
        "realtime_offline_queue",
        JSON.stringify(this.offlineQueue)
      );
    } catch (error) {
      console.error("Error saving queue to storage:", error);
    }
  }

  /**
   * Load queue from AsyncStorage
   */
  async loadQueueFromStorage() {
    try {
      const stored = await AsyncStorage.getItem("realtime_offline_queue");
      if (stored) {
        this.offlineQueue = JSON.parse(stored);
      }
    } catch (error) {
      console.error("Error loading queue from storage:", error);
    }
  }

  /**
   * Set online status and process queue if coming back online
   */
  setOnlineStatus(isOnline: boolean) {
    const wasOffline = !this.isOnline;
    this.isOnline = isOnline;

    if (wasOffline && isOnline) {
      // Just came back online, process queue
      this.processQueue();
    }
  }

  /**
   * Get current online status
   */
  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Get queued actions count
   */
  getQueuedActionsCount(): number {
    return this.offlineQueue.length;
  }
}

export const realtimeService = new RealtimeService();
