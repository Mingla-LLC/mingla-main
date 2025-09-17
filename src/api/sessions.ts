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
  
  try {
    console.log('Getting user session...');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('Auth response:', { user: user?.id, error: userError });
    
    if (userError) {
      console.error('Auth error:', userError);
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    if (!user) {
      console.error('No user found');
      throw new Error('User not authenticated');
    }
    
    console.log('Authenticated user:', user.id, user.email);

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

    console.log('Session creation response:', { data: sessionData, error: sessionError });

    if (sessionError) {
      console.error('Error creating session:', sessionError);
      throw new Error(`Failed to create session: ${sessionError.message}`);
    }
    
    if (!sessionData) {
      console.error('No session data returned');
      throw new Error('Failed to create session: No data returned');
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

    console.log('Creator participant response:', { error: creatorParticipantError });

    if (creatorParticipantError) {
      console.error('Error adding creator as participant:', creatorParticipantError);
      throw new Error(`Failed to add creator to session: ${creatorParticipantError.message}`);
    }

    // Process participants and create invitations
    const invitations = [];
    
    console.log('Processing participants:', payload.participantIds);
    for (const username of payload.participantIds) {
      console.log(`Finding user: ${username}`);
      // Find user by username
      const { data: userData, error: userFindError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .single();

      console.log(`User lookup for ${username}:`, { data: userData, error: userFindError });

      if (userFindError) {
        console.error(`User lookup error for ${username}:`, userFindError);
        throw new Error(`User not found: ${username}`);
      }
      
      if (!userData) {
        console.error(`No user data for: ${username}`);
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

      console.log(`Participant creation for ${username}:`, { error: participantError });

      if (participantError) {
        console.error('Error adding participant:', participantError);
        throw new Error(`Failed to add participant ${username}: ${participantError.message}`);
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

      console.log(`Invite creation for ${username}:`, { data: inviteData, error: inviteError });

      if (inviteError) {
        console.error('Error creating invite:', inviteError);
        throw new Error(`Failed to create invitation for ${username}: ${inviteError.message}`);
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

    return result;
  } catch (error) {
    console.error('=== SESSION CREATION FAILED ===');
    console.error('Error details:', error);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}