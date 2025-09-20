import { supabase } from '@/integrations/supabase/client';

export type CreateSessionPayload = {
  name: string;
  participants: string[]; // usernames to invite
};

export type CreateSessionResponse = {
  id: string;
};

export type SessionListResponse = {
  sessions: Array<{
    id: string;
    name: string;
    status: 'pending' | 'active' | 'ended';
    board_id?: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    members: Array<{
      user_id: string;
      role: 'owner' | 'participant';
      joined_at: string;
      profile: {
        id: string;
        username: string;
        first_name?: string;
        last_name?: string;
        avatar_url?: string;
      };
    }>;
  }>;
};

// Create new session
export async function createSession(payload: CreateSessionPayload): Promise<CreateSessionResponse> {
  console.log('🎯 Creating session via edge function:', payload);
  
  const { data, error } = await supabase.functions.invoke('sessions', {
    method: 'POST',
    body: payload,
    headers: {
      'Idempotency-Key': crypto.randomUUID()
    }
  });

  if (error) {
    console.error('Session creation error:', error);
    throw new Error(error.message || 'Failed to create session');
  }

  return data;
}

// Get user's sessions (where user is a member)
export async function getUserSessions(): Promise<SessionListResponse> {
  console.log('🎯 Fetching user sessions via edge function');
  
  try {
    const { data, error } = await supabase.functions.invoke('sessions', {
      method: 'GET',
      body: {}
    });

    if (error) {
      console.error('Error fetching sessions:', error);
      // Return empty sessions instead of throwing
      return { sessions: [] };
    }

    return data || { sessions: [] };
  } catch (err) {
    console.error('Network error fetching sessions:', err);
    // Return empty sessions instead of throwing to prevent persistent errors
    return { sessions: [] };
  }
}

// Delete session (owner only)
export async function deleteSession(sessionId: string): Promise<void> {
  console.log('🎯 Deleting session via edge function:', sessionId);
  
  const { error } = await supabase.functions.invoke('sessions', {
    method: 'DELETE',
    body: {},
    headers: {
      'Idempotency-Key': crypto.randomUUID()
    }
  });

  if (error) {
    console.error('Session deletion error:', error);
    throw new Error(error.message || 'Failed to delete session');
  }
}