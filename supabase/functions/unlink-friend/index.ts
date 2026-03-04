import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── UUID validation ──────────────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse body
    const { linkId } = await req.json();

    // Validate linkId
    if (!linkId || typeof linkId !== "string" || !UUID_REGEX.test(linkId)) {
      return new Response(
        JSON.stringify({ error: "Invalid link ID" }),
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

    // Service-role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch the link — must be accepted
    const { data: link, error: linkError } = await supabaseAdmin
      .from("friend_links")
      .select("id, requester_id, target_id, status, requester_person_id, target_person_id")
      .eq("id", linkId)
      .maybeSingle();

    if (linkError || !link) {
      return new Response(
        JSON.stringify({ error: "Link not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (link.status !== "accepted") {
      return new Response(
        JSON.stringify({ error: "Link is not currently active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Current user must be part of the link
    if (link.requester_id !== currentUserId && link.target_id !== currentUserId) {
      return new Response(
        JSON.stringify({ error: "Not authorized to unlink" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Delete saved_people entry on requester's side
    if (link.requester_person_id) {
      const { error: delReqError } = await supabaseAdmin
        .from("saved_people")
        .delete()
        .eq("id", link.requester_person_id);

      if (delReqError) {
        console.warn("Delete requester saved_people error:", delReqError.message);
      }
    }

    // Delete saved_people entry on target's side
    if (link.target_person_id) {
      const { error: delTgtError } = await supabaseAdmin
        .from("saved_people")
        .delete()
        .eq("id", link.target_person_id);

      if (delTgtError) {
        console.warn("Delete target saved_people error:", delTgtError.message);
      }
    }

    // Update friend_links to unlinked
    const { error: updateError } = await supabaseAdmin
      .from("friend_links")
      .update({
        status: "unlinked",
        unlinked_at: new Date().toISOString(),
        unlinked_by: currentUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", linkId);

    if (updateError) {
      console.error("Unlink update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to unlink" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ status: "unlinked" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("unlink-friend error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
