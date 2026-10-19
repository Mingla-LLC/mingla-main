// Issue #3040 — the ONLY writer of video ad_creatives rows.
//
// A video creative is created from exactly one READY `ad_creative` lane job,
// and every media field comes from that job's own row: the provider asset id,
// the processed MP4 and the poster the webhook verified. This function takes
// no URL or asset id from any caller. It is idempotent per job (the
// ad_creatives.source_job_id unique index) and is driven by
// event-cover-video-apply (client present) and the reaper (client gone).
//
// MINGLA-INVARIANT: I-CREATIVE-FROM-JOB-ONLY | issue #3697 | video creatives are created only from a READY lane job
import {
  CreativeTrustError,
  probeTrustedVideoSources,
} from "./adCreativeTrustedSource.ts";
import { parseAdCreativeOwnerKey } from "./adCreativeLaneAuth.ts";

// deno-lint-ignore no-explicit-any
type Supabase = any;

export type MaterializableJob = {
  id: string;
  target_kind?: string | null;
  status?: string | null;
  brand_id?: string | null;
  requested_by?: string | null;
  draft_owner_key?: string | null;
  source_asset_id?: string | null;
  processed_url?: string | null;
  processed_poster_url?: string | null;
  source_file_name?: string | null;
  created_at?: string | null;
  provider_payload?: unknown;
};

export type MaterializeResult =
  | { ok: true; creativeId: string; created: boolean }
  | {
    ok: false;
    retryable: true;
    code: "creative_materialize_pending";
    reason: string;
  }
  | {
    ok: false;
    retryable: false;
    code: "creative_source_untrusted" | "creative_job_not_materializable";
    reason: string;
  };

export type MaterializeDeps = {
  probeTrustedVideoSources: typeof probeTrustedVideoSources;
};

const defaultDeps: MaterializeDeps = { probeTrustedVideoSources };

const log = (stage: string, fields: Record<string, unknown>): void => {
  console.warn("[ad-creative-materialize]", JSON.stringify({ stage, ...fields }));
};

export function creativeNameFromJob(job: MaterializableJob): string {
  const raw = typeof job.source_file_name === "string"
    ? job.source_file_name.trim()
    : "";
  const withoutExtension = raw.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim();
  if (withoutExtension.length > 0) return withoutExtension.slice(0, 120);
  const day = typeof job.created_at === "string" && job.created_at.length >= 10
    ? job.created_at.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `Video ${day}`;
}

export function creativeSourceForJob(
  job: MaterializableJob,
): "admin_upload" | "host_upload" | "ari_upload" {
  if (job.brand_id === null || job.brand_id === undefined) {
    return "admin_upload";
  }
  return parseAdCreativeOwnerKey(job.draft_owner_key)?.kind === "ari"
    ? "ari_upload"
    : "host_upload";
}

const renditionHeight = (payload: unknown): number | null => {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as { rendition_height?: unknown }).rendition_height;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
};

async function existingCreativeId(
  supabase: Supabase,
  jobId: string,
): Promise<{ id: string | null; error: unknown }> {
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("id")
    .eq("source_job_id", jobId)
    .maybeSingle();
  return { id: typeof data?.id === "string" ? data.id : null, error };
}

export async function materializeAdCreativeFromJob(
  supabase: Supabase,
  job: MaterializableJob,
  deps: MaterializeDeps = defaultDeps,
): Promise<MaterializeResult> {
  if (job.target_kind !== "ad_creative") {
    return {
      ok: false,
      retryable: false,
      code: "creative_job_not_materializable",
      reason: "target_kind",
    };
  }
  // Idempotent: one creative per job, whatever the job's later status.
  const existing = await existingCreativeId(supabase, job.id);
  if (existing.error) {
    return {
      ok: false,
      retryable: true,
      code: "creative_materialize_pending",
      reason: "creative_read_failed",
    };
  }
  if (existing.id !== null) {
    return { ok: true, creativeId: existing.id, created: false };
  }
  const guid = typeof job.source_asset_id === "string"
    ? job.source_asset_id
    : null;
  const mp4 = typeof job.processed_url === "string" ? job.processed_url : null;
  const poster = typeof job.processed_poster_url === "string"
    ? job.processed_poster_url
    : null;
  if (job.status !== "ready" || !guid || !mp4 || !poster) {
    return {
      ok: false,
      retryable: false,
      code: "creative_job_not_materializable",
      reason: job.status !== "ready" ? "job_not_ready" : "job_media_missing",
    };
  }

  let probe: Awaited<ReturnType<typeof probeTrustedVideoSources>>;
  try {
    probe = await deps.probeTrustedVideoSources({
      bunny_video_id: guid,
      mp4_master_url: mp4,
      poster_url: poster,
    });
  } catch (error) {
    if (
      error instanceof CreativeTrustError &&
      error.code === "creative_source_untrusted"
    ) {
      const { data: failed } = await supabase.rpc(
        "cover_video_transition_job",
        {
          p_job_id: job.id,
          p_from_statuses: ["ready"],
          p_to_status: "failed",
          p_provider_status: null,
          p_provider_progress: null,
          p_patch: {
            failure_code: "creative_source_untrusted",
            failure_message: "The processed video could not be verified.",
          },
        },
      );
      log("creative_source_untrusted", {
        jobId: job.id,
        jobStatus: failed?.status ?? null,
      });
      return {
        ok: false,
        retryable: false,
        code: "creative_source_untrusted",
        reason: error.message,
      };
    }
    const reason = error instanceof CreativeTrustError
      ? error.code
      : error instanceof Error
      ? error.name
      : "probe_failed";
    log("creative_materialize_pending", { jobId: job.id, reason });
    return {
      ok: false,
      retryable: true,
      code: "creative_materialize_pending",
      reason,
    };
  }

  const video = probe.videoProbe;
  const row = {
    kind: "video",
    name: creativeNameFromJob(job),
    source_url: mp4,
    bunny_video_id: guid,
    poster_url: poster,
    mp4_master_url: mp4,
    brand_id: job.brand_id ?? null,
    source: creativeSourceForJob(job),
    source_job_id: job.id,
    width: video.width,
    height: video.height,
    aspect_ratio: video.aspectRatio,
    duration_seconds: video.durationSeconds,
    mime_type: video.mimeType,
    byte_size: video.byteSize,
    has_audio: video.hasAudio,
    content_hash: probe.videoHash,
    poster_content_hash: probe.posterHash,
    rendition_height: renditionHeight(job.provider_payload),
    created_by: job.requested_by ?? null,
    ai_generated: false,
    variants: {},
    status: "active",
  };
  const { data: inserted, error: insertError } = await supabase
    .from("ad_creatives")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (!insertError && typeof inserted?.id === "string") {
    return { ok: true, creativeId: inserted.id, created: true };
  }
  // A concurrent materializer won the unique source_job_id: return its row.
  const raced = await existingCreativeId(supabase, job.id);
  if (raced.id !== null) {
    return { ok: true, creativeId: raced.id, created: false };
  }
  log("creative_insert_failed", {
    jobId: job.id,
    code: (insertError as { code?: string } | null)?.code ?? null,
  });
  return {
    ok: false,
    retryable: true,
    code: "creative_materialize_pending",
    reason: "creative_insert_failed",
  };
}
