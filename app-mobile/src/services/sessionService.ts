import { supabase } from './supabase';

export interface ActiveSession {
  sessionId: string;
  sessionName: string;
  switchedAt: string;
}

class SessionService {
  /**
   * Switch to a collaboration session
   * Validates user is a participant and updates session's last_activity_at
   * The active session is determined by the most recently active session the user participates in
   */
  static async switchToSession(
    userId: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string; session?: any }> {
    try {
      // 1. Validate session exists and user is a participant
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .select('id, name, status, created_by')
        .eq('id', sessionId)
        .single();

      if (sessionError || !session) {
        return {
          success: false,
          error: 'Session not found',
        };
      }

      // 2. Check if user is a participant
      const { data: participant, error: participantError } = await supabase
        .from('session_participants')
        .select('user_id, has_accepted')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single();

      if (participantError || !participant) {
        return {
          success: false,
          error: 'You are not a participant in this session',
        };
      }

      if (!participant.has_accepted) {
        return {
          success: false,
          error: 'You must accept the invitation before switching to this session',
        };
      }

      // 3. Update session's last_activity_at to mark it as the most recently active
      const { error: updateError } = await supabase
        .from('collaboration_sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (updateError) {
        console.error('Error updating session activity:', updateError);
      }

      return {
        success: true,
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
        },
      };
    } catch (error: any) {
      console.error('Error switching to session:', error);
      return {
        success: false,
        error: error.message || 'Failed to switch session',
      };
    }
  }

  /**
   * Switch to solo mode
   * No database action needed - active session is determined by most recent activity
   */
  static async switchToSolo(): Promise<{ success: boolean; error?: string }> {
    // No database action needed - the active session is determined dynamically
    return { success: true };
  }

  /**
   * Get current active session from database
   * Returns the most recently active session the user is participating in
   */
  static async getActiveSession(userId: string): Promise<ActiveSession | null> {
    try {
      // Get all sessions where user is a participant and has accepted
      const { data: participations, error: participationError } = await supabase
        .from('session_participants')
        .select('session_id, has_accepted')
        .eq('user_id', userId)
        .eq('has_accepted', true);

      if (participationError || !participations || participations.length === 0) {
        return null;
      }

      const sessionIds = participations.map(p => p.session_id);

      // Get the most recently active session
      const { data: sessions, error: sessionsError } = await supabase
        .from('collaboration_sessions')
        .select('id, name, last_activity_at')
        .in('id', sessionIds)
        .is('archived_at', null)
        .order('last_activity_at', { ascending: false })
        .limit(1);

      if (sessionsError || !sessions || sessions.length === 0) {
        return null;
      }

      const activeSession = sessions[0];
      return {
        sessionId: activeSession.id,
        sessionName: activeSession.name,
        switchedAt: activeSession.last_activity_at || new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Validate and get active session from database
   * Returns null if no valid active session
   */
  static async validateActiveSession(
    userId: string
  ): Promise<ActiveSession | null> {
    return await this.getActiveSession(userId);
  }

  /**
   * Clear active session (used when leaving a session)
   * No action needed - user is removed from session_participants, so they won't have an active session
   */
  static async clearActiveSession(): Promise<void> {
    // No action needed - active session is determined dynamically from database
  }
}

export { SessionService };

