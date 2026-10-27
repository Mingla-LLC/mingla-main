// #3872 R3/R4 — public playback only for explicitly public Creator/Local media.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { creatorPlaybackUrl } from "../_shared/creatorMedia.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

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

type MediaRow = {
  id: string;
  owner_id: string;
  purpose: "showcase" | "local_review" | string;
  status: string;
  bunny_video_id: string | null;
  deleted_at: string | null;
};

export type PublicMediaDeps = {
  media: (jobId: string) => Promise<MediaRow | null>;
  creatorIsPublic: (ownerId: string) => Promise<boolean>;
  localReviewIsPublic: (jobId: string) => Promise<boolean>;
  playback: (
    videoId: string,
  ) => Promise<{ url: string; expiresAt: string } | null>;
};

export function createPublicCreatorMediaHandler(deps: PublicMediaDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    let jobId = "";
    try {
      const body = await req.json();
      jobId = typeof body?.jobId === "string" ? body.jobId : "";
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!UUID_RE.test(jobId)) return json({ error: "invalid_job" }, 400);
    const media = await deps.media(jobId);
    if (
      !media || media.status !== "ready" || media.deleted_at ||
      !media.bunny_video_id
    ) {
      return json({ error: "not_found" }, 404);
    }
    const allowed = media.purpose === "showcase"
      ? await deps.creatorIsPublic(media.owner_id)
      : media.purpose === "local_review"
      ? await deps.localReviewIsPublic(media.id)
      : false;
    if (!allowed) return json({ error: "not_found" }, 404);
    const playback = await deps.playback(media.bunny_video_id);
    if (!playback) return json({ error: "playback_unavailable" }, 503);
    return json({ jobId: media.id, playback });
  };
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createPublicCreatorMediaHandler({
    media: async (jobId) => {
      const { data, error } = await supabase.from("creator_media_jobs")
        .select("id,owner_id,purpose,status,bunny_video_id,deleted_at")
        .eq("id", jobId).maybeSingle();
      if (error) throw error;
      return data as MediaRow | null;
    },
    creatorIsPublic: async (ownerId) => {
      const { data, error } = await supabase.from("creator_profiles")
        .select("creator_account_id").eq("creator_account_id", ownerId)
        .eq("mode_enabled", true).eq("verification", "verified").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    localReviewIsPublic: async (jobId) => {
      const { data, error } = await supabase.from("local_reviews")
        .select("local_months!inner(status)").contains("media_job_ids", [jobId])
        .in("local_months.status", ["published", "paid"]).limit(1)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    playback: creatorPlaybackUrl,
  }));
}
