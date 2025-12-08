import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_SESSION_KEY = 'mingla_active_session';

export interface ActiveSession {
  sessionId: string;
  sessionName: string;
  switchedAt: string;
}

class SessionService {
  /**
   * Switch to a collaboration session
   * Validates user is a participant, persists to database and local storage
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

      // 3. Persist active session to local storage
      const activeSession: ActiveSession = {
        sessionId: session.id,
        sessionName: session.name,
        switchedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify(activeSession)
      );

      // 4. Update session's last_activity_at
      await supabase
        .from('collaboration_sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', sessionId);

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
   * Switch to solo mode (clear active session)
   */
  static async switchToSolo(): Promise<{ success: boolean; error?: string }> {
    try {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
      return { success: true };
    } catch (error: any) {
      console.error('Error switching to solo:', error);
      return {
        success: false,
        error: error.message || 'Failed to switch to solo mode',
      };
    }
  }

  /**
   * Get current active session from local storage
   */
  static async getActiveSession(): Promise<ActiveSession | null> {
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
      if (!stored) return null;

      const activeSession: ActiveSession = JSON.parse(stored);

      // Validate session still exists and user is still a participant
      const { data: participant } = await supabase
        .from('session_participants')
        .select('user_id')
        .eq('session_id', activeSession.sessionId)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!participant) {
        // Session is no longer valid, clear it
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
        return null;
      }

      return activeSession;
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * Validate and refresh active session
   * Returns null if session is invalid
   */
  static async validateActiveSession(
    userId: string
  ): Promise<ActiveSession | null> {
    try {
      const activeSession = await this.getActiveSession();
      if (!activeSession) return null;

      // Check if session still exists
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .select('id, name, status')
        .eq('id', activeSession.sessionId)
        .single();

      if (sessionError || !session) {
        // Session deleted, clear active session
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
        return null;
      }

      // Check if user is still a participant
      const { data: participant } = await supabase
        .from('session_participants')
        .select('user_id, has_accepted')
        .eq('session_id', activeSession.sessionId)
        .eq('user_id', userId)
        .single();

      if (!participant || !participant.has_accepted) {
        // User is no longer a participant, clear active session
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
        return null;
      }

      // Update session name if it changed
      if (session.name !== activeSession.sessionName) {
        const updatedSession: ActiveSession = {
          ...activeSession,
          sessionName: session.name,
        };
        await AsyncStorage.setItem(
          ACTIVE_SESSION_KEY,
          JSON.stringify(updatedSession)
        );
        return updatedSession;
      }

      return activeSession;
    } catch (error) {
      console.error('Error validating active session:', error);
      return null;
    }
  }

  /**
   * Clear active session (used when leaving a session)
   */
  static async clearActiveSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch (error) {
      console.error('Error clearing active session:', error);
    }
  }
}

export { SessionService };

