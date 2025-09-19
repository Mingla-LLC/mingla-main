import { supabase } from '@/integrations/supabase/client';

export type AcceptInviteResponse = {
  sessionId: string;
  boardId?: string;
  status: 'accepted';
};

export type DeclineInviteResponse = {
  inviteId: string;
  status: 'declined';
};

export type RevokeInviteResponse = {
  inviteId: string;
  status: 'revoked';
};

// Accept an invite (transactional: accept invite + update session + create board if needed)
export async function acceptInvite(inviteId: string): Promise<AcceptInviteResponse> {
  console.log('🎯 acceptInvite called with inviteId:', inviteId);
  
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get the invite details
    const { data: invite, error: inviteError } = await supabase
      .from('collaboration_invites')
      .select('*')
      .eq('id', inviteId)
      .eq('invited_user_id', user.id)
      .eq('status', 'pending')
      .single();

    if (inviteError || !invite) {
      throw new Error('Invite not found or already processed');
    }

    // Get the session details separately
    const { data: session, error: sessionError } = await supabase
      .from('collaboration_sessions')
      .select('*')
      .eq('id', invite.session_id)
      .single();

    if (sessionError || !session) {
      throw new Error('Session not found');
    }

    console.log('📨 Found invite:', invite);
    console.log('📋 Found session:', session);

    // Start transaction by updating invite status
    const { error: updateInviteError } = await supabase
      .from('collaboration_invites')
      .update({ 
        status: 'accepted',
        updated_at: new Date().toISOString()
      })
      .eq('id', inviteId)
      .eq('status', 'pending'); // Ensure we only update pending invites

    if (updateInviteError) {
      throw new Error(`Failed to accept invite: ${updateInviteError.message}`);
    }

    // Update session participant acceptance
    const { error: participantError } = await supabase
      .from('session_participants')
      .update({ 
        has_accepted: true, 
        joined_at: new Date().toISOString() 
      })
      .eq('session_id', invite.session_id)
      .eq('user_id', user.id);

    if (participantError) {
      throw new Error(`Failed to update participant status: ${participantError.message}`);
    }

    // Check if all participants have now accepted
    const { data: allParticipants, error: participantsError } = await supabase
      .from('session_participants')
      .select('user_id, has_accepted')
      .eq('session_id', invite.session_id);

    if (participantsError) {
      throw new Error(`Failed to check participant status: ${participantsError.message}`);
    }

    const allAccepted = allParticipants?.every(p => p.has_accepted) && allParticipants.length >= 2;
    console.log('👥 Participant check:', { 
      totalParticipants: allParticipants?.length, 
      allAccepted,
      participants: allParticipants 
    });

    let boardId: string | undefined;

    // If all participants accepted, activate session and create board
    if (allAccepted) {
      console.log('✅ All participants accepted, activating session and creating board');
      
      // Create board for the session
      const { data: newBoard, error: boardError } = await supabase
        .from('boards')
        .insert({
          name: `${session.name} Board`,
          description: `Collaborative board for ${session.name}`,
          session_id: invite.session_id,
          created_by: session.created_by,
          is_public: false
        })
        .select()
        .single();

      if (boardError) {
        console.error('⚠️ Failed to create board:', boardError);
        // Don't fail the accept operation, just log the error
      } else {
        boardId = newBoard.id;
        console.log('📋 Created board:', newBoard);

        // Update session with board ID and set to active
        const { error: sessionUpdateError } = await supabase
          .from('collaboration_sessions')
          .update({ 
            status: 'active',
            board_id: boardId,
            updated_at: new Date().toISOString()
          })
          .eq('id', invite.session_id);

        if (sessionUpdateError) {
          console.error('⚠️ Failed to update session status:', sessionUpdateError);
        } else {
          console.log('🚀 Session activated successfully');
        }
      }
    }

    console.log('✅ Invite accepted successfully');
    return {
      sessionId: invite.session_id,
      boardId,
      status: 'accepted'
    };

  } catch (error) {
    console.error('❌ Error accepting invite:', error);
    throw error;
  }
}

// Decline an invite
export async function declineInvite(inviteId: string): Promise<DeclineInviteResponse> {
  console.log('❌ declineInvite called with inviteId:', inviteId);
  
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Update invite status to declined
    const { error: updateError } = await supabase
      .from('collaboration_invites')
      .update({ 
        status: 'declined',
        updated_at: new Date().toISOString()
      })
      .eq('id', inviteId)
      .eq('invited_user_id', user.id)
      .eq('status', 'pending');

    if (updateError) {
      throw new Error(`Failed to decline invite: ${updateError.message}`);
    }

    // Remove the participant record since they declined
    const { error: removeParticipantError } = await supabase
      .from('session_participants')
      .delete()
      .eq('session_id', (await supabase
        .from('collaboration_invites')
        .select('session_id')
        .eq('id', inviteId)
        .single()
      ).data?.session_id)
      .eq('user_id', user.id);

    if (removeParticipantError) {
      console.error('⚠️ Failed to remove participant:', removeParticipantError);
      // Don't fail the decline operation
    }

    console.log('✅ Invite declined successfully');
    return {
      inviteId,
      status: 'declined'
    };

  } catch (error) {
    console.error('❌ Error declining invite:', error);
    throw error;
  }
}

// Revoke an invite (inviter only)
export async function revokeInvite(inviteId: string): Promise<RevokeInviteResponse> {
  console.log('🚫 revokeInvite called with inviteId:', inviteId);
  
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    // Get the invite to verify the user is the inviter
    const { data: invite, error: inviteError } = await supabase
      .from('collaboration_invites')
      .select('session_id, invited_by, invited_user_id')
      .eq('id', inviteId)
      .eq('status', 'pending')
      .single();

    if (inviteError || !invite) {
      throw new Error('Invite not found or already processed');
    }

    if (invite.invited_by !== user.id) {
      throw new Error('Only the inviter can revoke an invite');
    }

    // Update invite status to revoked
    const { error: updateError } = await supabase
      .from('collaboration_invites')
      .update({ 
        status: 'revoked',
        updated_at: new Date().toISOString()
      })
      .eq('id', inviteId)
      .eq('status', 'pending');

    if (updateError) {
      throw new Error(`Failed to revoke invite: ${updateError.message}`);
    }

    // Remove the participant record
    const { error: removeParticipantError } = await supabase
      .from('session_participants')
      .delete()
      .eq('session_id', invite.session_id)
      .eq('user_id', invite.invited_user_id);

    if (removeParticipantError) {
      console.error('⚠️ Failed to remove participant:', removeParticipantError);
      // Don't fail the revoke operation
    }

    console.log('✅ Invite revoked successfully');
    return {
      inviteId,
      status: 'revoked'
    };

  } catch (error) {
    console.error('❌ Error revoking invite:', error);
    throw error;
  }
}

// Get pending invites (for notifications)
export async function getPendingInvites() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('User not authenticated');
  }

  const { data: invites, error } = await supabase
    .from('collaboration_invites')
    .select(`
      *,
      collaboration_sessions(*),
      invited_by_profile:profiles!collaboration_invites_invited_by_fkey(*)
    `)
    .eq('invited_user_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch invites: ${error.message}`);
  }

  return invites || [];
}

// Get sent invites (for management)
export async function getSentInvites() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('User not authenticated');
  }

  const { data: invites, error } = await supabase
    .from('collaboration_invites')
    .select(`
      *,
      collaboration_sessions(*),
      invited_user_profile:profiles!collaboration_invites_invited_user_id_fkey(*)
    `)
    .eq('invited_by', user.id)
    .in('status', ['pending', 'accepted', 'declined', 'revoked'])
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch sent invites: ${error.message}`);
  }

  return invites || [];
}