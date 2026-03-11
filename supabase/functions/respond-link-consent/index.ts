import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── UUID validation ──────────────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Generate initials from display name ──────────────────────────────────────
function generateInitials(displayName: string): string {
  if (!displayName) return "??";
  const words = displayName.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Parse and validate request body
    const { linkId, action } = await req.json();

    if (!linkId || typeof linkId !== "string" || !UUID_REGEX.test(linkId)) {
      return new Response(
        JSON.stringify({ error: "linkId is required and must be a valid UUID" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!["accept", "decline"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "action must be 'accept' or 'decline'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Create user-scoped Supabase client
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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userId = user.id;

    // 3. Create admin client for operations that need elevated access
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 4. Fetch the friend_links row
    const { data: link, error: linkError } = await adminClient
      .from("friend_links")
      .select("*")
      .eq("id", linkId)
      .single();

    if (linkError || !link) {
      return new Response(
        JSON.stringify({ error: "Link not found" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 5. Validate link state
    if (link.status !== "accepted" || link.link_status !== "pending_consent") {
      return new Response(
        JSON.stringify({ error: "Link consent not available" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 6. Determine which side the user is on
    const isRequester = userId === link.requester_id;
    const isTarget = userId === link.target_id;

    if (!isRequester && !isTarget) {
      return new Response(
        JSON.stringify({ error: "You are not part of this link" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7. Check user hasn't already responded
    const alreadyResponded = isRequester
      ? link.requester_link_consent
      : link.target_link_consent;

    if (alreadyResponded) {
      return new Response(
        JSON.stringify({ error: "You have already responded" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 8. Handle DECLINE
    if (action === "decline") {
      await adminClient
        .from("friend_links")
        .update({
          link_status: "declined",
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkId);

      return new Response(
        JSON.stringify({
          status: "declined",
          linkStatus: "declined",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 9. Handle ACCEPT — atomically set this user's consent flag AND return the
    //    fresh row in a single operation. This eliminates the race condition where
    //    a separate re-fetch could see stale data from the other user's concurrent
    //    update. UPDATE ... RETURNING reads its own write plus any committed writes.
    const consentColumn = isRequester ? "requester_link_consent" : "target_link_consent";

    const { data: rpcRows, error: updateError } = await adminClient.rpc(
      "set_link_consent_and_return",
      {
        p_link_id: linkId,
        p_column: consentColumn,
      }
    );

    // RPC returns TABLE → Supabase JS returns an array; take the first row
    const freshLink = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

    if (updateError || !freshLink) {
      console.error("Consent update+fetch failed:", updateError);
      return new Response(
        JSON.stringify({
          error: "Consent update failed",
          details: updateError?.message || "Unknown error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const bothConsented =
      freshLink.requester_link_consent && freshLink.target_link_consent;

    if (!bothConsented) {
      return new Response(
        JSON.stringify({
          status: "pending",
          linkStatus: "pending_consent",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 11. BOTH consented — create linked saved_people entries
    const { data: requesterProfile } = await adminClient
      .from("profiles")
      .select("display_name, username, birthday, gender, avatar_url")
      .eq("id", link.requester_id)
      .single();

    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("display_name, username, birthday, gender, avatar_url")
      .eq("id", link.target_id)
      .single();

    const requesterName =
      requesterProfile?.display_name ||
      requesterProfile?.username ||
      "Friend";
    const targetName =
      targetProfile?.display_name || targetProfile?.username || "Friend";

    // Create saved_people entry for requester on TARGET's side
    const { data: targetPersonEntry } = await adminClient
      .from("saved_people")
      .upsert(
        {
          user_id: link.target_id,
          linked_user_id: link.requester_id,
          link_id: linkId,
          name: requesterName,
          initials: generateInitials(requesterName),
          birthday: requesterProfile?.birthday || null,
          gender: requesterProfile?.gender || null,
          avatar_url: requesterProfile?.avatar_url || null,
          is_linked: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,linked_user_id",
        }
      )
      .select("id")
      .single();

    // Create saved_people entry for target on REQUESTER's side
    const { data: requesterPersonEntry } = await adminClient
      .from("saved_people")
      .upsert(
        {
          user_id: link.requester_id,
          linked_user_id: link.target_id,
          link_id: linkId,
          name: targetName,
          initials: generateInitials(targetName),
          birthday: targetProfile?.birthday || null,
          gender: targetProfile?.gender || null,
          avatar_url: targetProfile?.avatar_url || null,
          is_linked: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,linked_user_id",
        }
      )
      .select("id")
      .single();

    // 12. Update friend_links to consented with person IDs
    await adminClient
      .from("friend_links")
      .update({
        link_status: "consented",
        linked_at: new Date().toISOString(),
        requester_person_id: requesterPersonEntry?.id || null,
        target_person_id: targetPersonEntry?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", linkId);

    // 13. Send confirmation push to BOTH users
    const { data: requesterToken } = await adminClient
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", link.requester_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: targetToken } = await adminClient
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", link.target_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (requesterToken?.push_token) {
      sendPush(supabaseUrl, supabaseServiceKey, {
        to: requesterToken.push_token,
        sound: "default",
        title: `You and ${targetName} are now linked!`,
        body: "You can now see each other's details in For You.",
        data: { type: "link_consent_completed", linkId },
      }).catch((err) => console.warn("Push notification send failed:", err));
    }

    if (targetToken?.push_token) {
      sendPush(supabaseUrl, supabaseServiceKey, {
        to: targetToken.push_token,
        sound: "default",
        title: `You and ${requesterName} are now linked!`,
        body: "You can now see each other's details in For You.",
        data: { type: "link_consent_completed", linkId },
      }).catch((err) => console.warn("Push notification send failed:", err));
    }

    // 14. Return success
    return new Response(
      JSON.stringify({
        status: "consented",
        linkStatus: "consented",
        personId: isRequester
          ? requesterPersonEntry?.id
          : targetPersonEntry?.id,
        linkedPersonId: isRequester
          ? targetPersonEntry?.id
          : requesterPersonEntry?.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("respond-link-consent error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
