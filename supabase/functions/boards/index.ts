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

    // GET /boards?scope=mine - Get boards for sessions user belongs to
    if (method === 'GET' && path === '/boards') {
      const scope = url.searchParams.get('scope')
      
      if (scope === 'mine') {
        const { data: boards, error } = await supabase
          .from('collaboration_boards')
          .select(`
            id,
            session_id,
            created_at,
            collaboration_sessions!inner (
              id,
              name,
              status,
              created_by,
              created_at,
              session_members!inner (
                user_id,
                role,
                profiles!session_members_user_id_fkey (
                  id,
                  username,
                  first_name,
                  last_name,
                  avatar_url
                )
              )
            )
          `)
          .eq('collaboration_sessions.session_members.user_id', user.id)
          .order('created_at', { ascending: false })

        if (error) {
          console.error('Error fetching boards:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to fetch boards' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Transform the data to a cleaner format
        const transformedBoards = boards.map(board => ({
          id: board.id,
          session_id: board.session_id,
          created_at: board.created_at,
          session: {
            id: board.collaboration_sessions.id,
            name: board.collaboration_sessions.name,
            status: board.collaboration_sessions.status,
            created_by: board.collaboration_sessions.created_by,
            created_at: board.collaboration_sessions.created_at,
            // Get all members for this session
            members: board.collaboration_sessions.session_members
          }
        }))

        return new Response(
          JSON.stringify({ boards: transformedBoards }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
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