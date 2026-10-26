// #3872 R3 C0 — owner-scoped creator media state and 1-hour playback grant.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { creatorPlaybackUrl } from "../_shared/creatorMedia.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

if (import.meta.main) {
  const supabase = serviceClient();
  serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actorId = await userIdFromAuthHeader(req);
    if (!actorId) return json({ error: "unauthorized" }, 401);
    let jobId = "";
    try {
      const body = await req.json();
      jobId = typeof body?.jobId === "string" ? body.jobId : "";
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!UUID_RE.test(jobId)) return json({ error: "invalid_job" }, 400);
    const { data, error } = await supabase.from("creator_media_jobs")
      .select(
        "id,owner_id,purpose,status,bunny_video_id,aspect_warning,failure_code,ready_at",
      )
      .eq("id", jobId).eq("owner_id", actorId).maybeSingle();
    if (error) return json({ error: "internal" }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    const playback = data.status === "ready" && data.bunny_video_id
      ? await creatorPlaybackUrl(data.bunny_video_id)
      : null;
    return json({
      jobId: data.id,
      purpose: data.purpose,
      status: data.status,
      aspectWarning: data.aspect_warning,
      failureCode: data.failure_code,
      readyAt: data.ready_at,
      playback,
    });
  });
}
