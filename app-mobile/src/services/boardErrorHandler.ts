import { Alert } from 'react-native';
import { supabase } from './supabase';

export interface BoardError {
  code: string;
  message: string;
  userFriendlyMessage: string;
  recoverable: boolean;
}

export class BoardErrorHandler {
  /**
   * Handle network errors
   */
  static handleNetworkError(error: any): BoardError {
    if (!error || !error.message) {
      return {
        code: 'UNKNOWN',
        message: 'An unknown error occurred',
        userFriendlyMessage: 'Something went wrong. Please try again.',
        recoverable: true,
      };
    }

    // Check for network connectivity issues
    if (
      error.message.includes('Network request failed') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError')
    ) {
      return {
        code: 'NETWORK_ERROR',
        message: error.message,
        userFriendlyMessage: 'No internet connection. Please check your network and try again.',
        recoverable: true,
      };
    }

    // Check for timeout errors
    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      return {
        code: 'TIMEOUT',
        message: error.message,
        userFriendlyMessage: 'Request timed out. Please try again.',
        recoverable: true,
      };
    }

    return {
      code: 'UNKNOWN',
      message: error.message,
      userFriendlyMessage: 'An error occurred. Please try again.',
      recoverable: true,
    };
  }

  /**
   * Handle session errors
   */
  static handleSessionError(error: any): BoardError {
    if (error?.code === 'PGRST116' || error?.message?.includes('not found')) {
      return {
        code: 'SESSION_NOT_FOUND',
        message: error.message,
        userFriendlyMessage: 'This board session no longer exists.',
        recoverable: false,
      };
    }

    if (error?.code === '42501' || error?.message?.includes('permission denied')) {
      return {
        code: 'PERMISSION_DENIED',
        message: error.message,
        userFriendlyMessage: 'You don\'t have permission to access this session.',
        recoverable: false,
      };
    }

    return this.handleNetworkError(error);
  }

  /**
   * Handle participant limit errors
   */
  static handleParticipantLimitError(error: any): BoardError {
    if (error?.message?.includes('participant limit') || error?.message?.includes('max participants')) {
      return {
        code: 'PARTICIPANT_LIMIT',
        message: error.message,
        userFriendlyMessage: 'This session has reached its participant limit.',
        recoverable: false,
      };
    }

    return this.handleSessionError(error);
  }

  /**
   * Handle authentication errors
   */
  static handleAuthError(error: any): BoardError {
    if (error?.code === 'PGRST301' || error?.message?.includes('JWT')) {
      return {
        code: 'AUTH_REQUIRED',
        message: error.message,
        userFriendlyMessage: 'Please sign in to continue.',
        recoverable: false,
      };
    }

    return this.handleNetworkError(error);
  }

  /**
   * Show user-friendly error alert
   */
  static showError(error: BoardError, onRetry?: () => void) {
    const buttons: any[] = [{ text: 'OK', style: 'default' }];

    if (error.recoverable && onRetry) {
      buttons.unshift({
        text: 'Retry',
        onPress: onRetry,
        style: 'default',
      });
    }

    Alert.alert('Error', error.userFriendlyMessage, buttons);
  }

  /**
   * Check if session is expired
   */
  static async checkSessionValidity(sessionId: string): Promise<{ valid: boolean; error?: BoardError }> {
    try {
      const { data, error } = await supabase
        .from('collaboration_sessions')
        .select('id, is_active, archived_at')
        .eq('id', sessionId)
        .single();

      if (error) {
        return {
          valid: false,
          error: this.handleSessionError(error),
        };
      }

      if (!data) {
        return {
          valid: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
            userFriendlyMessage: 'This board session no longer exists.',
            recoverable: false,
          },
        };
      }

      if (data.archived_at) {
        return {
          valid: false,
          error: {
            code: 'SESSION_ARCHIVED',
            message: 'Session archived',
            userFriendlyMessage: 'This board session has been archived.',
            recoverable: false,
          },
        };
      }

      if (!data.is_active) {
        return {
          valid: false,
          error: {
            code: 'SESSION_INACTIVE',
            message: 'Session inactive',
            userFriendlyMessage: 'This board session is no longer active.',
            recoverable: false,
          },
        };
      }

      return { valid: true };
    } catch (err: any) {
      return {
        valid: false,
        error: this.handleNetworkError(err),
      };
    }
  }

  /**
   * Check if user has permission to access session
   */
  static async checkSessionPermission(
    sessionId: string,
    userId: string
  ): Promise<{ hasPermission: boolean; error?: BoardError; isAdmin?: boolean }> {
    try {
      const { data, error } = await supabase
        .from('session_participants')
        .select('has_accepted, user_id')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return {
          hasPermission: false,
          error: {
            code: 'NOT_PARTICIPANT',
            message: 'User is not a participant',
            userFriendlyMessage: 'You are not a member of this board session.',
            recoverable: false,
          },
        };
      }

      if (!data.has_accepted) {
        return {
          hasPermission: false,
          error: {
            code: 'INVITE_PENDING',
            message: 'Invite not accepted',
            userFriendlyMessage: 'Please accept the invite to access this session.',
            recoverable: false,
          },
        };
      }

      // Check if user is creator/admin
      const { data: sessionData } = await supabase
        .from('collaboration_sessions')
        .select('created_by')
        .eq('id', sessionId)
        .single();

      const isAdmin = sessionData?.created_by === userId;

      return {
        hasPermission: true,
        isAdmin,
      };
    } catch (err: any) {
      return {
        hasPermission: false,
        error: this.handleNetworkError(err),
      };
    }
  }

  /**
   * Check participant limit
   */
  static async checkParticipantLimit(sessionId: string): Promise<{ canJoin: boolean; error?: BoardError; currentCount?: number; maxCount?: number }> {
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .select('max_participants')
        .eq('id', sessionId)
        .single();

      if (sessionError || !sessionData) {
        return {
          canJoin: false,
          error: this.handleSessionError(sessionError),
        };
      }

      if (!sessionData.max_participants) {
        // No limit set
        return { canJoin: true };
      }

      const { data: participants, error: participantsError } = await supabase
        .from('session_participants')
        .select('id')
        .eq('session_id', sessionId)
        .eq('has_accepted', true);

      if (participantsError) {
        return {
          canJoin: false,
          error: this.handleNetworkError(participantsError),
        };
      }

      const currentCount = participants?.length || 0;
      const maxCount = sessionData.max_participants;

      if (currentCount >= maxCount) {
        return {
          canJoin: false,
          currentCount,
          maxCount,
          error: {
            code: 'PARTICIPANT_LIMIT',
            message: 'Participant limit reached',
            userFriendlyMessage: `This session has reached its limit of ${maxCount} participants.`,
            recoverable: false,
          },
        };
      }

      return {
        canJoin: true,
        currentCount,
        maxCount,
      };
    } catch (err: any) {
      return {
        canJoin: false,
        error: this.handleNetworkError(err),
      };
    }
  }
}

