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
    const method = req.method
    
  console.log(`🔍 Sessions API called: ${method} ${url.pathname}, search: ${url.search}`)

  // GET / - Get sessions where user is a member (default endpoint)
  if (method === 'GET') {
      const scope = url.searchParams.get('scope') || 'mine' // Default to 'mine' if no scope provided
      
      if (scope === 'mine') {
        const { data: sessions, error } = await supabase
          .from('collaboration_sessions')
          .select(`
            id,
            name,
            status,
            board_id,
            created_by,
            created_at,
            updated_at,
            session_members!inner (
              user_id,
              role,
              joined_at,
              profiles!session_members_user_id_fkey (
                id,
                username,
                first_name,
                last_name,
                avatar_url
              )
            )
          `)
          .eq('session_members.user_id', user.id)
          .order('created_at', { ascending: false })

        if (error) {
          console.error('Error fetching sessions:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to fetch sessions' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Transform data to include all members for each session
        const enrichedSessions = await Promise.all(sessions.map(async (session) => {
          const { data: allMembers, error: membersError } = await supabase
            .from('session_members')
            .select(`
              user_id,
              role,
              joined_at,
              profiles!session_members_user_id_fkey (
                id,
                username,
                first_name,
                last_name,
                avatar_url
              )
            `)
            .eq('session_id', session.id)

          if (membersError) {
            console.error('Error fetching session members:', membersError)
            return session
          }

          return {
            ...session,
            members: allMembers.map(member => ({
              user_id: member.user_id,
              role: member.role,
              joined_at: member.joined_at,
              profile: member.profiles
            }))
          }
        }))

        return new Response(
          JSON.stringify({ sessions: enrichedSessions }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Default response for GET requests without valid scope
      return new Response(
        JSON.stringify({ sessions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /sessions or POST / - Create new session
    if (method === 'POST') {
      const body = await req.json()
      const { name, participants = [] } = body

      if (!name) {
        return new Response(
          JSON.stringify({ error: 'Session name is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check idempotency
      const idempotencyKey = req.headers.get('Idempotency-Key')
      if (idempotencyKey) {
        // In a real implementation, you'd store and check idempotency keys
        // For now, we'll just proceed
      }

      // Start transaction by creating session
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name,
          created_by: user.id,
          status: 'pending'
        })
        .select()
        .single()

      if (sessionError) {
        console.error('Error creating session:', sessionError)
        return new Response(
          JSON.stringify({ error: 'Failed to create session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Add creator as owner in session_members
      const { error: ownerError } = await supabase
        .from('session_members')
        .insert({
          session_id: session.id,
          user_id: user.id,
          role: 'owner'
        })

      if (ownerError) {
        console.error('Error adding owner:', ownerError)
        // Cleanup: delete session
        await supabase.from('collaboration_sessions').delete().eq('id', session.id)
        return new Response(
          JSON.stringify({ error: 'Failed to create session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Session created: ${session.id} by ${user.id}`)

      return new Response(
        JSON.stringify({ id: session.id }),
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // DELETE /?sessionId=xxx - Delete session (owner only)  
    if (method === 'DELETE') {
      const sessionId = url.searchParams.get('sessionId')
      
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Session ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if user can delete (owner only)
      const { data: canDelete, error: checkError } = await supabase
        .rpc('can_delete_session', {
          session_id: sessionId,
          user_id: user.id
        })

      if (checkError) {
        console.error('Error checking delete permission:', checkError)
        return new Response(
          JSON.stringify({ error: 'Permission check failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!canDelete) {
        return new Response(
          JSON.stringify({ error: 'Only session owners can delete sessions' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Delete session (cascades to members, boards, invites, notifications)
      const { error: deleteError } = await supabase
        .from('collaboration_sessions')
        .delete()
        .eq('id', sessionId)

      if (deleteError) {
        console.error('Error deleting session:', deleteError)
        return new Response(
          JSON.stringify({ error: 'Failed to delete session' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Session deleted: ${sessionId} by ${user.id}`)

      return new Response(null, { 
        status: 204, 
        headers: corsHeaders 
      })
    }

    // Return 404 for unhandled routes
    return new Response(
      JSON.stringify({ 
        error: 'Route not found',
        available_routes: {
          'GET /': 'Get user sessions (add ?scope=mine)',
          'POST /': 'Create new session',
          'DELETE /': 'Delete session (add ?sessionId=xxx)'
        }
      }),
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