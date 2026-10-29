// #3872 R3 C0 — Bunny lifecycle callback for the isolated creator-media lane.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  CREATOR_MEDIA_MAX_BYTES,
  CREATOR_MEDIA_MAX_DURATION_S,
  creatorMediaConfig,
  getCreatorVideo,
} from "../_shared/creatorMedia.ts";
import {
  mapBunnyStatusFromWebhook,
  verifyBunnyWebhookSignature,
} from "../_shared/bunnyStream.ts";

type Job = {
  id: string;
  purpose: "showcase" | "delivery" | "local_review" | "dispute_evidence";
  status: string;
  bunny_video_id: string;
};

type Deps = {
  verify(rawBody: string, req: Request): Promise<boolean>;
  readJob(videoId: string): Promise<Job | null>;
  readProvider: typeof getCreatorVideo;
  updateJob(jobId: string, patch: Record<string, unknown>): Promise<void>;
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });

const retention = (purpose: Job["purpose"], nowMs: number): string | null => {
  const day = 24 * 60 * 60 * 1000;
  if (purpose === "dispute_evidence") {
    return new Date(nowMs + 180 * day).toISOString();
  }
  // Delivery retention starts when the Host approves the actual delivery,
  // not when Bunny happens to finish encoding it. The database lifecycle
  // trigger owns that clock and extends it through posting/payout milestones.
  return null;
};

export const createCreatorMediaWebhookHandler =
  (deps: Deps) => async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const rawBody = await req.text();
    if (!await deps.verify(rawBody, req)) {
      return json({ error: "forbidden" }, 403);
    }

    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
    const videoId = typeof payload?.VideoGuid === "string"
      ? payload.VideoGuid.trim()
      : "";
    const providerStatus = Number(payload?.Status);
    const libraryId = String(payload?.VideoLibraryId ?? "");
    if (!videoId || !Number.isInteger(providerStatus)) {
      return json({ error: "invalid_payload" }, 400);
    }
    const expectedLibrary = creatorMediaConfig().libraryId;
    if (expectedLibrary && libraryId && libraryId !== expectedLibrary) {
      return json({ error: "wrong_library" }, 403);
    }

    const job = await deps.readJob(videoId);
    if (!job) return json({ ok: true, ignored: "unknown_video" });
    if (["ready", "failed", "deleted"].includes(job.status)) {
      return json({ ok: true, ignored: job.status });
    }
    const lifecycle = mapBunnyStatusFromWebhook(providerStatus);
    if (lifecycle === "ignore") return json({ ok: true, ignored: "event" });
    if (lifecycle === "processing") {
      await deps.updateJob(job.id, {
        status: "processing",
        last_provider_at: new Date().toISOString(),
        provider_payload: payload,
      });
      return json({ ok: true, status: "processing" });
    }
    if (lifecycle === "failed") {
      await deps.updateJob(job.id, {
        status: "failed",
        failure_code: "provider_encode_failed",
        last_provider_at: new Date().toISOString(),
        provider_payload: payload,
      });
      return json({ ok: true, status: "failed" });
    }

    const provider = await deps.readProvider(videoId);
    if (!provider.ok) return json({ error: "provider_unreadable" }, 503);
    if (provider.video.lifecycle !== "ready") {
      return json({ ok: true, status: "processing" }, 202);
    }
    const tooLarge = provider.video.sourceBytes !== null &&
      provider.video.sourceBytes > CREATOR_MEDIA_MAX_BYTES;
    const tooLong = provider.video.durationSeconds !== null &&
      provider.video.durationSeconds > CREATOR_MEDIA_MAX_DURATION_S;
    if (tooLarge || tooLong) {
      await deps.updateJob(job.id, {
        status: "failed",
        failure_code: tooLarge ? "source_too_large" : "source_too_long",
        last_provider_at: new Date().toISOString(),
        provider_payload: payload,
      });
      return json({ ok: true, status: "failed" });
    }
    const now = Date.now();
    const width = provider.video.width;
    const height = provider.video.height;
    const aspectWarning = width !== null && height !== null
      ? !(width / height >= 0.50 && width / height <= 0.63)
      : true;
    await deps.updateJob(job.id, {
      status: "ready",
      duration_s: provider.video.durationSeconds,
      bytes_source: provider.video.sourceBytes,
      width,
      height,
      aspect_warning: aspectWarning,
      ready_at: new Date(now).toISOString(),
      source_deleted_at: new Date(now).toISOString(),
      delete_after: retention(job.purpose, now),
      last_provider_at: new Date(now).toISOString(),
      provider_payload: payload,
      failure_code: null,
    });
    return json({ ok: true, status: "ready", aspectWarning });
  };

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createCreatorMediaWebhookHandler({
    verify: async (rawBody, req) => {
      const result = await verifyBunnyWebhookSignature({
        rawBody,
        signatureHeader: req.headers.get("x-bunnystream-signature"),
        signatureVersion: req.headers.get("x-bunnystream-signature-version"),
        signatureAlgorithm: req.headers.get(
          "x-bunnystream-signature-algorithm",
        ),
        secret: creatorMediaConfig().webhookKey,
      });
      return result.ok;
    },
    readJob: async (videoId) => {
      const { data, error } = await supabase.from("creator_media_jobs")
        .select("id,purpose,status,bunny_video_id")
        .eq("bunny_video_id", videoId).maybeSingle();
      if (error) throw error;
      return data as Job | null;
    },
    readProvider: getCreatorVideo,
    updateJob: async (jobId, patch) => {
      const { error } = await supabase.from("creator_media_jobs").update(patch)
        .eq("id", jobId);
      if (error) throw error;
    },
  }));
}
