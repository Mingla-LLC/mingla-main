import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse body
    const { query } = await req.json();

    // Validate query
    if (!query || typeof query !== "string" || query.length < 2) {
      return new Response(
        JSON.stringify({ error: "Search query must be at least 2 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auth — create user-scoped client
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const currentUserId = user.id;

    // Sanitize the query for ILIKE — escape special characters
    const sanitizedQuery = query.replace(/[%_\\]/g, "\\$&");

    // Query profiles table
    // We use two separate queries to implement the ORDER BY CASE priority
    // since Supabase JS doesn't support CASE in order.

    // First: prefix matches (username starts with query)
    const { data: prefixMatches, error: prefixError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .neq("id", currentUserId)
      .eq("has_completed_onboarding", true)
      .or(`username.ilike.${sanitizedQuery}%,phone.like.%${sanitizedQuery}%`)
      .order("username", { ascending: true })
      .limit(20);

    if (prefixError) {
      console.error("Search prefix query error:", prefixError);
      return new Response(
        JSON.stringify({ error: "Search failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Second: contains matches (username contains query but doesn't start with it)
    const { data: containsMatches, error: containsError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .neq("id", currentUserId)
      .eq("has_completed_onboarding", true)
      .ilike("username", `%${sanitizedQuery}%`)
      .not("username", "ilike", `${sanitizedQuery}%`)
      .order("username", { ascending: true })
      .limit(20);

    if (containsError) {
      console.error("Search contains query error:", containsError);
      return new Response(
        JSON.stringify({ error: "Search failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Merge results: prefix matches first, then contains matches, dedup by id
    const seenIds = new Set<string>();
    const users: Array<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }> = [];

    for (const match of [...(prefixMatches || []), ...(containsMatches || [])]) {
      if (!seenIds.has(match.id) && users.length < 20) {
        seenIds.add(match.id);
        users.push({
          id: match.id,
          username: match.username || "",
          display_name: match.display_name || "",
          avatar_url: match.avatar_url || null,
        });
      }
    }

    return new Response(
      JSON.stringify({ users }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("search-users error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
