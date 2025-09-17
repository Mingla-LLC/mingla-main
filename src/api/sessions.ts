import { supabase } from '@/integrations/supabase/client';

export type CreateSessionPayload = {
  name: string;
  participantIds: string[]; // inviter not required; server adds automatically
};

export type CreateSessionResponse = {
  session: { id: string; name: string; status: 'pending' | 'active' | 'cancelled' };
  invitations: Array<{ id: string; inviteeId: string; status: 'pending' | 'accepted' | 'declined' | 'revoked' }>;
};

export async function createSession(payload: CreateSessionPayload): Promise<CreateSessionResponse> {
  console.log('=== CREATE SESSION CALLED ===');
  console.log('Payload:', payload);
  
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    console.error('Auth error:', userError);
    throw new Error('User not authenticated');
  }
  
  console.log('Authenticated user:', user.id);

  try {
    console.log('Creating session...');
    // Create the session (no board yet - only created when all accept)
    const { data: sessionData, error: sessionError } = await supabase
      .from('collaboration_sessions')
      .insert({
        name: payload.name,
        created_by: user.id,
        status: 'pending',
        board_id: null
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Error creating session:', sessionError);
      throw new Error(sessionError.message || 'Failed to create session');
    }
    
    console.log('Session created:', sessionData);

    console.log('Adding creator as participant...');
    // Add creator as participant (auto-accepted)
    const { error: creatorParticipantError } = await supabase
      .from('session_participants')
      .insert({
        session_id: sessionData.id,
        user_id: user.id,
        has_accepted: true,
        joined_at: new Date().toISOString()
      });

    if (creatorParticipantError) {
      console.error('Error adding creator as participant:', creatorParticipantError);
      throw new Error('Failed to add creator to session');
    }

    // Process participants and create invitations
    const invitations = [];
    
    console.log('Processing participants:', payload.participantIds);
    for (const username of payload.participantIds) {
      console.log(`Finding user: ${username}`);
      // Find user by username
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .single();

      if (userError || !userData) {
        console.error(`User not found: ${username}`, userError);
        throw new Error(`User not found: ${username}`);
      }

      // Skip if trying to invite themselves
      if (userData.id === user.id) {
        console.log(`Skipping self-invite for: ${username}`);
        continue;
      }

      console.log(`Adding participant: ${username} (${userData.id})`);
      // Add as participant (not accepted yet)
      const { error: participantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: userData.id,
          has_accepted: false,
          joined_at: null
        });

      if (participantError) {
        console.error('Error adding participant:', participantError);
        throw new Error(`Failed to add participant: ${username}`);
      }

      console.log(`Creating invite for: ${username}`);
      // Create invitation
      const { data: inviteData, error: inviteError } = await supabase
        .from('collaboration_invites')
        .insert({
          session_id: sessionData.id,
          invited_user_id: userData.id,
          invited_by: user.id,
          status: 'pending',
          message: `${user.email} invited you to collaborate on "${payload.name}"`
        })
        .select()
        .single();

      if (inviteError) {
        console.error('Error creating invite:', inviteError);
        throw new Error(`Failed to create invitation for: ${username}`);
      }

      invitations.push({
        id: inviteData.id,
        inviteeId: userData.id,
        status: 'pending' as const
      });
    }

    const result = {
      session: {
        id: sessionData.id,
        name: sessionData.name,
        status: sessionData.status as 'pending' | 'active' | 'cancelled'
      },
      invitations
    };

    console.log('=== SESSION CREATION COMPLETE ===');
    console.log('Result:', result);

    // MUST return parsed data so callers resolve
    return result;
  } catch (error) {
    console.error('=== SESSION CREATION FAILED ===');
    console.error('Error:', error);
    throw error;
  }
}