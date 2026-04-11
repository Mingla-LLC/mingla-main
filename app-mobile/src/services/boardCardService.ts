import { supabase } from './supabase';
import { realtimeService } from './realtimeService';

export interface SaveCardToBoardParams {
  sessionId: string;
  experienceId: string;
  experienceData: any;
  userId: string;
}

export interface SwipeState {
  sessionId: string;
  experienceId: string;
  userId: string;
  swipeDirection: 'left' | 'right';
  swipedAt: string;
}

export class BoardCardService {
  /**
   * Save a card to a board session
   */
  static async saveCardToBoard({
    sessionId,
    experienceId,
    experienceData,
    userId,
  }: SaveCardToBoardParams): Promise<{ data: any; error: any }> {
    try {
      // Check if card already exists in this session by checking card_data JSONB
      // Cards are identified by their ID stored in card_data->>'id'
      const { data: existingCards, error: checkError } = await supabase
        .from('board_saved_cards')
        .select('id')
        .eq('session_id', sessionId)
        .eq('card_data->>id', experienceId);

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 is "not found" - that's fine, but other errors should be thrown
        if (checkError.code !== '42703') { // 42703 is column doesn't exist, try alternative
          throw checkError;
        }
      }

      // If column doesn't exist error, try alternative check
      if (checkError?.code === '42703' || (!checkError && existingCards && existingCards.length > 0)) {
        // Try checking all cards and filtering in memory
        const { data: allCards } = await supabase
          .from('board_saved_cards')
          .select('id, card_data')
          .eq('session_id', sessionId);

        const existing = allCards?.find((card: any) => 
          card.card_data?.id === experienceId || card.card_data?.experience_id === experienceId
        );

        if (existing) {
          return { data: existing, error: null };
        }
      } else if (existingCards && existingCards.length > 0) {
        // Card already saved, return existing
        return { data: existingCards[0], error: null };
      }

      // Insert new saved card
      // Store the full card data in card_data JSONB
      // experience_id can be NULL if the card doesn't exist in experiences table yet
      const { data, error } = await supabase
        .from('board_saved_cards')
        .insert({
          session_id: sessionId,
          experience_id: null, // Can be NULL if card doesn't exist in experiences table
          saved_experience_id: null, // Can be NULL if not from saved_experiences
          card_data: {
            ...experienceData,
            id: experienceId, // Ensure ID is stored in card_data
            experience_id: experienceId, // Also store as experience_id in JSONB for easy lookup
          },
          saved_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      // Broadcast real-time update
      realtimeService.broadcastCardSave(sessionId, {
        id: data.id,
        session_id: sessionId,
        saved_by: userId,
        saved_at: data.saved_at,
        experience_data: data.card_data,
      });

      return { data, error: null };
    } catch (err: any) {
      console.error('Error saving card to board:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Track user swipe state for a card in a board session
   */
  static async trackSwipeState({
    sessionId,
    experienceId,
    userId,
    swipeDirection,
  }: Omit<SwipeState, 'swipedAt'>): Promise<{ data: any; error: any }> {
    try {
      // Upsert swipe state
      const { data, error } = await supabase
        .from('board_user_swipe_states')
        .upsert(
          {
            session_id: sessionId,
            experience_id: experienceId,
            user_id: userId,
            swipe_direction: swipeDirection,
            swiped_at: new Date().toISOString(),
          },
          {
            onConflict: 'board_user_swipe_states_session_experience_user_unique',
          }
        )
        .select()
        .single();

      if (error) throw error;

      // Broadcast swipe state update
      realtimeService.broadcastCardSwipe(sessionId, {
        experience_id: experienceId,
        user_id: userId,
        swipe_direction: swipeDirection,
        swiped_at: data.swiped_at,
      });

      return { data, error: null };
    } catch (err: any) {
      console.error('Error tracking swipe state:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Get swipe states for a card in a session
   */
  static async getCardSwipeStates(
    sessionId: string,
    experienceId: string
  ): Promise<{ data: any[]; error: any }> {
    try {
      const { data, error } = await supabase
        .from('board_user_swipe_states')
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('session_id', sessionId)
        .eq('experience_id', experienceId);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (err: any) {
      console.error('Error getting swipe states:', err);
      return { data: [], error: err };
    }
  }

  /**
   * Get all saved cards for a session
   */
  static async getSessionSavedCards(
    sessionId: string
  ): Promise<{ data: any[]; error: any }> {
    try {
      const { data, error } = await supabase
        .from('board_saved_cards')
        .select('*')
        .eq('session_id', sessionId)
        .order('saved_at', { ascending: false });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (err: any) {
      console.error('Error getting session saved cards:', err);
      return { data: [], error: err };
    }
  }

  /**
   * Remove a card from a board session
   */
  static async removeCardFromBoard(
    sessionId: string,
    savedCardId: string
  ): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('board_saved_cards')
        .delete()
        .eq('session_id', sessionId)
        .eq('id', savedCardId);

      if (error) throw error;

      // Broadcast removal
      realtimeService.broadcastCardSave(sessionId, {
        id: savedCardId,
        session_id: sessionId,
        removed: true,
      });

      return { error: null };
    } catch (err: any) {
      console.error('Error removing card from board:', err);
      return { error: err };
    }
  }
}

