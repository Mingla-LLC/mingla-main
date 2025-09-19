import { supabase } from '@/integrations/supabase/client';

export type AcceptInviteResponse = {
  sessionId: string;
  boardId?: string;
  status: 'accepted';
};

export type DeclineInviteResponse = {
  status: 'declined';
};

export type RevokeInviteResponse = {
  status: 'revoked';
};

// Accept an invite (transactional: accept invite + update session + create board if needed)
export async function acceptInvite(inviteId: string): Promise<AcceptInviteResponse> {
  console.log('🎯 Accepting invite via edge function:', inviteId);
  
  const { data, error } = await supabase.functions.invoke('invites', {
    method: 'POST',
    body: {},
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (error) {
    console.error('Invite acceptance error:', error);
    throw new Error(error.message || 'Failed to accept invite');
  }

  return data;
}

// Decline an invite
export async function declineInvite(inviteId: string): Promise<DeclineInviteResponse> {
  console.log('🎯 Declining invite via edge function:', inviteId);
  
  const { data, error } = await supabase.functions.invoke('invites', {
    method: 'POST',
    body: {},
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (error) {
    console.error('Invite decline error:', error);
    throw new Error(error.message || 'Failed to decline invite');
  }

  return data;
}

// Revoke an invite (inviter only)
export async function revokeInvite(inviteId: string): Promise<RevokeInviteResponse> {
  console.log('🎯 Revoking invite via edge function:', inviteId);
  
  const { data, error } = await supabase.functions.invoke('invites', {
    method: 'POST',
    body: {},
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (error) {
    console.error('Invite revoke error:', error);
    throw new Error(error.message || 'Failed to revoke invite');
  }

  return data;
}

// Get pending invites for current user
export async function getPendingInvites() {
  console.log('🎯 Fetching pending invites');
  
  const { data: invites, error } = await supabase
    .from('collaboration_invites')
    .select(`
      id,
      session_id,
      message,
      status,
      created_at,
      collaboration_sessions!inner (
        id,
        name
      ),
      profiles!collaboration_invites_invited_by_fkey (
        id,
        username,
        first_name,
        last_name,
        avatar_url
      )
    `)
    .eq('invited_user_id', (await supabase.auth.getUser()).data.user?.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching pending invites:', error);
    throw new Error('Failed to fetch pending invites');
  }

  return invites?.map(invite => ({
    id: invite.id,
    sessionId: invite.session_id,
    sessionName: invite.collaboration_sessions.name,
    invitedBy: {
      id: invite.profiles.id,
      name: invite.profiles.first_name && invite.profiles.last_name 
        ? `${invite.profiles.first_name} ${invite.profiles.last_name}`
        : invite.profiles.username,
      username: invite.profiles.username,
      avatar: invite.profiles.avatar_url
    },
    message: invite.message,
    status: invite.status,
    createdAt: invite.created_at
  })) || [];
}

// Get sent invites (for current user)
export async function getSentInvites() {
  console.log('🎯 Fetching sent invites');
  
  const { data: invites, error } = await supabase
    .from('collaboration_invites')
    .select(`
      id,
      session_id,
      message,
      status,
      created_at,
      collaboration_sessions!inner (
        id,
        name
      ),
      profiles!collaboration_invites_invited_user_id_fkey (
        id,
        username,
        first_name,
        last_name,
        avatar_url
      )
    `)
    .eq('invited_by', (await supabase.auth.getUser()).data.user?.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching sent invites:', error);
    throw new Error('Failed to fetch sent invites');
  }

  return invites?.map(invite => ({
    id: invite.id,
    sessionId: invite.session_id,
    sessionName: invite.collaboration_sessions.name,
    invitedUser: {
      id: invite.profiles.id,
      name: invite.profiles.first_name && invite.profiles.last_name 
        ? `${invite.profiles.first_name} ${invite.profiles.last_name}`
        : invite.profiles.username,
      username: invite.profiles.username,
      avatar: invite.profiles.avatar_url
    },
    message: invite.message,
    status: invite.status,
    createdAt: invite.created_at
  })) || [];
}