import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // POST /sessions/:id/invites - Send invite
    if (method === 'POST' && path.includes('/sessions/') && path.endsWith('/invites')) {
      const sessionId = path.split('/')[2]
      const body = await req.json()
      const { to, message } = body

      if (!to) {
        return new Response(
          JSON.stringify({ error: 'Invite recipient is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Find recipient by username
      const { data: recipient, error: recipientError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', to)
        .single()

      if (recipientError || !recipient) {
        return new Response(
          JSON.stringify({ error: 'Recipient not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if invite already exists
      const { data: existingInvite } = await supabase
        .from('collaboration_invites')
        .select('id')
        .eq('session_id', sessionId)
        .eq('invited_user_id', recipient.id)
        .eq('status', 'pending')
        .single()

      if (existingInvite) {
        return new Response(
          JSON.stringify({ error: 'Invite already sent' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Create invite
      const { data: invite, error: inviteError } = await supabase
        .from('collaboration_invites')
        .insert({
          session_id: sessionId,
          invited_user_id: recipient.id,
          invited_by: user.id,
          message: message || '',
          status: 'pending'
        })
        .select()
        .single()

      if (inviteError) {
        console.error('Error creating invite:', inviteError)
        return new Response(
          JSON.stringify({ error: 'Failed to create invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ inviteId: invite.id, status: 'pending' }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /invites/:id/accept - Accept invite with transaction
    if (method === 'POST' && path.includes('/invites/') && path.endsWith('/accept')) {
      const inviteId = path.split('/')[2]

      // Get invite details
      const { data: invite, error: inviteError } = await supabase
        .from('collaboration_invites')
        .select('*')
        .eq('id', inviteId)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')
        .single()

      if (inviteError || !invite) {
        return new Response(
          JSON.stringify({ error: 'Invite not found or already processed' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      try {
        // Start transaction: Update invite status
        const { error: updateInviteError } = await supabase
          .from('collaboration_invites')
          .update({ 
            status: 'accepted',
            updated_at: new Date().toISOString()
          })
          .eq('id', inviteId)
          .eq('status', 'pending')

        if (updateInviteError) {
          throw new Error(`Failed to accept invite: ${updateInviteError.message}`)
        }

        // Add user to session_members as participant
        const { error: memberError } = await supabase
          .from('session_members')
          .insert({
            session_id: invite.session_id,
            user_id: user.id,
            role: 'participant'
          })

        if (memberError && !memberError.message.includes('duplicate key')) {
          throw new Error(`Failed to add member: ${memberError.message}`)
        }

        // Check if all participants have joined
        const { data: allMembers, error: membersError } = await supabase
          .from('session_members')
          .select('user_id')
          .eq('session_id', invite.session_id)

        if (membersError) {
          throw new Error(`Failed to check members: ${membersError.message}`)
        }

        // Get total expected participants (invites + creator)
        const { data: allInvites, error: invitesError } = await supabase
          .from('collaboration_invites')
          .select('invited_user_id')
          .eq('session_id', invite.session_id)
          .eq('status', 'accepted')

        if (invitesError) {
          throw new Error(`Failed to check invites: ${invitesError.message}`)
        }

        let boardId = null

        // If we have enough members (creator + at least one participant), create/ensure board exists
        if (allMembers.length >= 2) {
          // Try to create board (will be ignored if already exists due to UNIQUE constraint)
          const { data: board, error: boardError } = await supabase
            .from('collaboration_boards')
            .insert({ session_id: invite.session_id })
            .select()
            .single()

          if (boardError && !boardError.message.includes('duplicate key')) {
            console.warn('Board creation failed, checking if exists:', boardError)
            // Board might already exist, try to get it
            const { data: existingBoard } = await supabase
              .from('collaboration_boards')
              .select('id')
              .eq('session_id', invite.session_id)
              .single()
            
            boardId = existingBoard?.id
          } else if (board) {
            boardId = board.id
          }

          // Update session to active status and link board
          if (boardId) {
            const { error: sessionUpdateError } = await supabase
              .from('collaboration_sessions')
              .update({ 
                status: 'active',
                board_id: boardId,
                updated_at: new Date().toISOString()
              })
              .eq('id', invite.session_id)

            if (sessionUpdateError) {
              console.warn('Failed to update session status:', sessionUpdateError)
            }
          }
        }

        console.log(`Invite accepted: ${inviteId} by ${user.id}, session: ${invite.session_id}`)

        return new Response(
          JSON.stringify({ 
            sessionId: invite.session_id, 
            boardId,
            status: 'accepted' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      } catch (error) {
        console.error('Transaction failed:', error)
        // Rollback invite status
        await supabase
          .from('collaboration_invites')
          .update({ status: 'pending' })
          .eq('id', inviteId)

        return new Response(
          JSON.stringify({ error: 'Failed to accept invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // POST /invites/:id/decline - Decline invite
    if (method === 'POST' && path.includes('/invites/') && path.endsWith('/decline')) {
      const inviteId = path.split('/')[2]

      const { error: declineError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'declined',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending')

      if (declineError) {
        return new Response(
          JSON.stringify({ error: 'Failed to decline invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ status: 'declined' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /invites/:id/revoke - Revoke invite (inviter only)
    if (method === 'POST' && path.includes('/invites/') && path.endsWith('/revoke')) {
      const inviteId = path.split('/')[2]

      const { error: revokeError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'revoked',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invited_by', user.id)
        .eq('status', 'pending')

      if (revokeError) {
        return new Response(
          JSON.stringify({ error: 'Failed to revoke invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ status: 'revoked' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})