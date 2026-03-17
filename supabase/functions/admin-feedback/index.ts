import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_STATUSES = ["new", "reviewed", "actioned", "dismissed"];
const VALID_ACTIONS = ["list", "get", "update_status", "add_note", "get_audio_url"];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Authenticate caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }

  // Verify admin status
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, is_admin")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !profile.is_admin) {
    return jsonResponse({ error: "Forbidden — admin access required" }, 403);
  }

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { action } = body;

  if (!action || !VALID_ACTIONS.includes(action as string)) {
    return jsonResponse(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` },
      400,
    );
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  if (action === "list") {
    const page = Math.max(1, Number(body.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(body.page_size) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    let query = supabaseAdmin
      .from("beta_feedback")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (body.status_filter && VALID_STATUSES.includes(body.status_filter as string)) {
      query = query.eq("status", body.status_filter);
    }

    if (body.category_filter && typeof body.category_filter === "string") {
      query = query.eq("category", body.category_filter);
    }

    const { data, count, error } = await query;

    if (error) {
      return jsonResponse({ error: `Failed to list feedback: ${error.message}` }, 500);
    }

    return jsonResponse({
      data: data ?? [],
      total: count ?? 0,
      page,
      page_size: pageSize,
    });
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (action === "get") {
    const feedbackId = body.feedback_id;
    if (!feedbackId || typeof feedbackId !== "string") {
      return jsonResponse({ error: "feedback_id is required" }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from("beta_feedback")
      .select("*")
      .eq("id", feedbackId)
      .single();

    if (error || !data) {
      return jsonResponse({ error: "Feedback not found" }, 404);
    }

    return jsonResponse({ data });
  }

  // ── UPDATE_STATUS ────────────────────────────────────────────────────────
  if (action === "update_status") {
    const feedbackId = body.feedback_id;
    const status = body.status;

    if (!feedbackId || typeof feedbackId !== "string") {
      return jsonResponse({ error: "feedback_id is required" }, 400);
    }

    if (!status || !VALID_STATUSES.includes(status as string)) {
      return jsonResponse(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        400,
      );
    }

    const { error } = await supabaseAdmin
      .from("beta_feedback")
      .update({ status })
      .eq("id", feedbackId);

    if (error) {
      return jsonResponse({ error: `Failed to update status: ${error.message}` }, 500);
    }

    return jsonResponse({ success: true });
  }

  // ── ADD_NOTE ─────────────────────────────────────────────────────────────
  if (action === "add_note") {
    const feedbackId = body.feedback_id;
    const adminNotes = body.admin_notes;

    if (!feedbackId || typeof feedbackId !== "string") {
      return jsonResponse({ error: "feedback_id is required" }, 400);
    }

    if (typeof adminNotes !== "string") {
      return jsonResponse({ error: "admin_notes must be a string" }, 400);
    }

    const { error } = await supabaseAdmin
      .from("beta_feedback")
      .update({ admin_notes: adminNotes })
      .eq("id", feedbackId);

    if (error) {
      return jsonResponse({ error: `Failed to add note: ${error.message}` }, 500);
    }

    return jsonResponse({ success: true });
  }

  // ── GET_AUDIO_URL ────────────────────────────────────────────────────────
  if (action === "get_audio_url") {
    const feedbackId = body.feedback_id;

    if (!feedbackId || typeof feedbackId !== "string") {
      return jsonResponse({ error: "feedback_id is required" }, 400);
    }

    const { data: feedback, error: fetchError } = await supabaseAdmin
      .from("beta_feedback")
      .select("audio_path")
      .eq("id", feedbackId)
      .single();

    if (fetchError || !feedback) {
      return jsonResponse({ error: "Feedback not found" }, 404);
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from("beta-feedback")
      .createSignedUrl(feedback.audio_path, 3600);

    if (signedError || !signedData?.signedUrl) {
      return jsonResponse(
        { error: `Failed to generate audio URL: ${signedError?.message || "Unknown error"}` },
        500,
      );
    }

    return jsonResponse({ url: signedData.signedUrl, expires_in: 3600 });
  }

  return jsonResponse({ error: "Unhandled action" }, 400);
});
