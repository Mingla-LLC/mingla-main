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

const VALID_CATEGORIES = ["bug", "feature_request", "ux_issue", "general"];
const MAX_DURATION_MS = 300_000; // 5 minutes
const MAX_SCREENSHOTS = 10;

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

  // Verify beta tester status
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, is_beta_tester, display_name, email, phone")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return jsonResponse({ error: "Profile not found" }, 404);
  }

  if (!profile.is_beta_tester) {
    return jsonResponse({ error: "Only beta testers can submit feedback" }, 403);
  }

  // Parse and validate request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const {
    category,
    audio_path,
    audio_duration_ms,
    device_os,
    device_os_version,
    device_model,
    app_version,
    screen_before,
    session_duration_ms,
    latitude,
    longitude,
    screenshot_paths,
  } = body as Record<string, unknown>;

  // Validate required fields
  if (!category || !VALID_CATEGORIES.includes(category as string)) {
    return jsonResponse(
      { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
      400,
    );
  }

  if (!audio_path || typeof audio_path !== "string") {
    return jsonResponse({ error: "audio_path is required" }, 400);
  }

  // Verify the audio path belongs to the authenticated user's folder
  if (!(audio_path as string).startsWith(user.id + "/")) {
    return jsonResponse({ error: "audio_path must reference your own upload folder" }, 403);
  }

  if (
    typeof audio_duration_ms !== "number" ||
    audio_duration_ms < 1 ||
    audio_duration_ms > MAX_DURATION_MS
  ) {
    return jsonResponse(
      { error: `audio_duration_ms must be between 1 and ${MAX_DURATION_MS}` },
      400,
    );
  }

  if (!device_os || typeof device_os !== "string") {
    return jsonResponse({ error: "device_os is required" }, 400);
  }

  if (!app_version || typeof app_version !== "string") {
    return jsonResponse({ error: "app_version is required" }, 400);
  }

  // Validate optional screenshot_paths
  let validScreenshotPaths: string[] = [];
  if (screenshot_paths != null) {
    if (!Array.isArray(screenshot_paths)) {
      return jsonResponse({ error: "screenshot_paths must be an array" }, 400);
    }
    if (screenshot_paths.length > MAX_SCREENSHOTS) {
      return jsonResponse(
        { error: `screenshot_paths must contain at most ${MAX_SCREENSHOTS} items` },
        400,
      );
    }
    for (const p of screenshot_paths) {
      if (typeof p !== "string") {
        return jsonResponse({ error: "Each screenshot_path must be a string" }, 400);
      }
      if (!p.startsWith(user.id + "/screenshots/")) {
        return jsonResponse(
          { error: "Each screenshot_path must reference your own screenshots folder" },
          403,
        );
      }
    }
    validScreenshotPaths = screenshot_paths as string[];
  }

  // Generate signed URL for audio playback (1-hour expiry)
  const { data: signedData, error: signedError } = await supabaseAdmin.storage
    .from("beta-feedback")
    .createSignedUrl(audio_path as string, 3600);

  const audioUrl = signedError ? null : signedData?.signedUrl ?? null;

  // Generate signed URLs for screenshots (if any)
  const screenshotUrls: string[] = [];
  for (const path of validScreenshotPaths) {
    const { data: ssData } = await supabaseAdmin.storage
      .from("beta-feedback")
      .createSignedUrl(path, 3600);
    screenshotUrls.push(ssData?.signedUrl ?? "");
  }

  // Insert feedback row with denormalized user snapshot
  const { data: feedback, error: insertError } = await supabaseAdmin
    .from("beta_feedback")
    .insert({
      user_id: user.id,
      category,
      audio_path,
      audio_url: audioUrl,
      audio_duration_ms,
      user_display_name: profile.display_name || null,
      user_email: profile.email || user.email || null,
      user_phone: profile.phone || null,
      device_os,
      device_os_version: device_os_version ?? null,
      device_model: device_model ?? null,
      app_version,
      screen_before: screen_before ?? null,
      session_duration_ms: typeof session_duration_ms === "number" ? session_duration_ms : null,
      latitude: typeof latitude === "number" ? latitude : null,
      longitude: typeof longitude === "number" ? longitude : null,
      screenshot_paths: validScreenshotPaths.length > 0 ? validScreenshotPaths : null,
      screenshot_urls: screenshotUrls.length > 0 ? screenshotUrls : null,
    })
    .select("id")
    .single();

  if (insertError || !feedback) {
    console.error("[submit-feedback] Insert error:", insertError?.message);
    return jsonResponse(
      { error: `Failed to save feedback: ${insertError?.message || "No data returned"}` },
      500,
    );
  }

  return jsonResponse({ success: true, feedback_id: feedback.id });
});
