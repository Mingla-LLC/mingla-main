// #3872 R3 C0 — authenticated, fail-closed TUS upload intent for creator media.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  createCreatorVideo,
  CREATOR_MEDIA_MAX_BYTES,
  CREATOR_MEDIA_MAX_DURATION_S,
  findCreatorVideoByTitle,
  presignCreatorUpload,
  readCreatorMediaCapacity,
} from "../_shared/creatorMedia.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { resolveAlertRecipientValue } from "../_shared/secretBundle.ts";

type Purpose = "showcase" | "delivery" | "local_review" | "dispute_evidence";
type OwnerKind = "creator" | "local";
type Job = {
  id: string;
  owner_id: string;
  client_operation_id: string;
  bunny_video_id: string | null;
  status: string;
  aspect_warning: boolean;
};

type UploadBody = {
  ownerKind: OwnerKind;
  purpose: Purpose;
  contractId: string | null;
  localMonthId: string | null;
  clientOperationId: string;
  sourceBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
};

export type CreatorMediaDeps = {
  actorId(req: Request): Promise<string | null>;
  uploadsEnabled(): Promise<boolean>;
  findJob(ownerId: string, clientOperationId: string): Promise<Job | null>;
  createJob(input: {
    id: string;
    ownerId: string;
    clientOperationId: string;
    ownerKind: OwnerKind;
    purpose: Purpose;
    contractId: string | null;
    localMonthId: string | null;
    sourceBytes: number;
    durationSeconds: number;
    width: number;
    height: number;
    aspectWarning: boolean;
  }): Promise<Job>;
  attachVideo(jobId: string, videoId: string): Promise<Job>;
  readCapacity: typeof readCreatorMediaCapacity;
  findVideo: typeof findCreatorVideoByTitle;
  createVideo: typeof createCreatorVideo;
  presign: typeof presignCreatorUpload;
  alert(
    input: { reason: string; jobId: string | null; actorId: string },
  ): Promise<void>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSES = new Set<Purpose>([
  "showcase",
  "delivery",
  "local_review",
  "dispute_evidence",
]);
const OWNER_KINDS = new Set<OwnerKind>(["creator", "local"]);

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function parseBody(value: unknown): UploadBody | null {
  const body = asObject(value);
  if (body === null) return null;
  const ownerKind = body.ownerKind;
  const purpose = body.purpose;
  const contractId = body.contractId ?? null;
  const localMonthId = body.localMonthId ?? null;
  if (
    typeof ownerKind !== "string" || !OWNER_KINDS.has(ownerKind as OwnerKind) ||
    typeof purpose !== "string" || !PURPOSES.has(purpose as Purpose) ||
    typeof body.clientOperationId !== "string" ||
    !UUID_RE.test(body.clientOperationId) ||
    !Number.isInteger(body.sourceBytes) || Number(body.sourceBytes) <= 0 ||
    Number(body.sourceBytes) > CREATOR_MEDIA_MAX_BYTES ||
    typeof body.durationSeconds !== "number" ||
    !Number.isFinite(body.durationSeconds) ||
    Number(body.durationSeconds) <= 0 ||
    Number(body.durationSeconds) > CREATOR_MEDIA_MAX_DURATION_S ||
    !Number.isInteger(body.width) || Number(body.width) <= 0 ||
    !Number.isInteger(body.height) || Number(body.height) <= 0 ||
    (contractId !== null &&
      (typeof contractId !== "string" || !UUID_RE.test(contractId))) ||
    (localMonthId !== null &&
      (typeof localMonthId !== "string" || !UUID_RE.test(localMonthId)))
  ) return null;
  const purposeShape =
    (ownerKind === "creator" && purpose === "showcase" && contractId === null &&
      localMonthId === null) ||
    (ownerKind === "creator" &&
      (purpose === "delivery" || purpose === "dispute_evidence") &&
      contractId !== null && localMonthId === null) ||
    (ownerKind === "local" && purpose === "local_review" &&
      contractId === null && localMonthId !== null);
  if (!purposeShape) return null;
  return {
    ownerKind: ownerKind as OwnerKind,
    purpose: purpose as Purpose,
    contractId: contractId as string | null,
    localMonthId: localMonthId as string | null,
    clientOperationId: body.clientOperationId,
    sourceBytes: Number(body.sourceBytes),
    durationSeconds: Number(body.durationSeconds),
    width: Number(body.width),
    height: Number(body.height),
  };
}

export function isVerticalEnough(width: number, height: number): boolean {
  const ratio = width / height;
  return ratio >= 0.50 && ratio <= 0.63;
}

export function createCreatorMediaUploadIntentHandler(deps: CreatorMediaDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const actorId = await deps.actorId(req);
    if (!actorId) return response({ error: "unauthorized" }, 401);

    let parsed: UploadBody | null = null;
    try {
      parsed = parseBody(await req.json());
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      return response({
        error: "invalid_media",
        detail: "Use a vertical video up to 90 seconds and 150 MB.",
      }, 400);
    }
    if (!await deps.uploadsEnabled()) {
      return response({
        error: "media_unavailable",
        detail: "Creator uploads are not available yet.",
      }, 409);
    }

    let job = await deps.findJob(actorId, parsed.clientOperationId);
    const capacity = await deps.readCapacity();
    if (capacity.blocked) {
      await deps.alert({
        reason: capacity.reason,
        jobId: job?.id ?? null,
        actorId,
      });
      return response({
        error: "media_capacity",
        detail:
          "Uploads are paused for a few minutes. Your work is saved; try again shortly.",
        retryAfterSeconds: 300,
      }, 503);
    }

    if (job === null) {
      const jobId = crypto.randomUUID();
      const aspectWarning = !isVerticalEnough(parsed.width, parsed.height);
      try {
        job = await deps.createJob({
          id: jobId,
          ownerId: actorId,
          clientOperationId: parsed.clientOperationId,
          ownerKind: parsed.ownerKind,
          purpose: parsed.purpose,
          contractId: parsed.contractId,
          localMonthId: parsed.localMonthId,
          sourceBytes: parsed.sourceBytes,
          durationSeconds: parsed.durationSeconds,
          width: parsed.width,
          height: parsed.height,
          aspectWarning,
        });
      } catch {
        job = await deps.findJob(actorId, parsed.clientOperationId);
        if (job === null) return response({ error: "internal" }, 500);
      }
    }

    if (job.status !== "awaiting_upload") {
      return response(
        { error: "media_job_not_uploadable", status: job.status },
        409,
      );
    }
    let videoId = job.bunny_video_id;
    const title = `creator-media-job:${job.id}`;
    if (videoId === null) {
      const found = await deps.findVideo(title);
      if (!found.ok) {
        return response({ error: "media_provider_unavailable" }, 503);
      }
      videoId = found.videoId;
      if (videoId === null) {
        const created = await deps.createVideo(title);
        if (!created.ok) {
          if (created.ambiguous) {
            const reconciled = await deps.findVideo(title);
            if (reconciled.ok) videoId = reconciled.videoId;
          }
          if (videoId === null) {
            return response({ error: "media_provider_unavailable" }, 503);
          }
        } else {
          videoId = created.videoId;
        }
      }
      job = await deps.attachVideo(job.id, videoId);
    }
    const upload = await deps.presign(videoId);
    return response({
      jobId: job.id,
      status: job.status,
      aspectWarning: job.aspect_warning,
      upload,
    });
  };
}

const alertRecipients = () => {
  const value = resolveAlertRecipientValue(
    "stripe_disputes",
    "STRIPE_DISPUTE_ALERT_EMAILS",
  );
  if (Array.isArray(value)) {
    const emails = value.map((item) => String(item).trim()).filter(Boolean);
    if (emails.length > 0) return emails;
  }
  return String(value ?? "seth@usemingla.com")
    .split(",").map((item) => item.trim()).filter(Boolean);
};

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createCreatorMediaUploadIntentHandler({
    actorId: userIdFromAuthHeader,
    uploadsEnabled: async () => {
      const { data, error } = await supabase.from("feature_flags").select(
        "is_enabled",
      )
        .eq("flag_key", "creator_media_uploads_enabled").maybeSingle();
      return error === null && data?.is_enabled === true;
    },
    findJob: async (ownerId, clientOperationId) => {
      const { data, error } = await supabase.from("creator_media_jobs").select(
        "id,owner_id,client_operation_id,bunny_video_id,status,aspect_warning",
      ).eq("owner_id", ownerId).eq("client_operation_id", clientOperationId)
        .maybeSingle();
      if (error) throw error;
      return data as Job | null;
    },
    createJob: async (input) => {
      const { data, error } = await supabase.from("creator_media_jobs").insert({
        id: input.id,
        owner_id: input.ownerId,
        client_operation_id: input.clientOperationId,
        owner_kind: input.ownerKind,
        purpose: input.purpose,
        contract_id: input.contractId,
        local_month_id: input.localMonthId,
        bytes_source: input.sourceBytes,
        duration_s: input.durationSeconds,
        width: input.width,
        height: input.height,
        aspect_warning: input.aspectWarning,
      }).select(
        "id,owner_id,client_operation_id,bunny_video_id,status,aspect_warning",
      ).single();
      if (error) throw error;
      return data as Job;
    },
    attachVideo: async (jobId, videoId) => {
      const { data, error } = await supabase.from("creator_media_jobs")
        .update({ bunny_video_id: videoId }).eq("id", jobId)
        .select(
          "id,owner_id,client_operation_id,bunny_video_id,status,aspect_warning",
        ).single();
      if (error) throw error;
      return data as Job;
    },
    readCapacity: readCreatorMediaCapacity,
    findVideo: findCreatorVideoByTitle,
    createVideo: createCreatorVideo,
    presign: presignCreatorUpload,
    alert: async ({ reason, jobId, actorId }) => {
      try {
        await sendOpsAlertEmail({
          subject: "Creator media uploads paused",
          paragraphs: [
            `Reason: ${reason}`,
            `Actor: ${actorId}`,
            `Job: ${jobId ?? "not created"}`,
            "The fail-closed creator-media capacity breaker refused the upload.",
          ],
          recipients: alertRecipients(),
          idempotencyKey: `creator-media-capacity:${reason}:${
            jobId ?? actorId
          }`,
        });
      } catch (error) {
        console.error("[creator-media-upload-intent] ops alert failed", {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }));
}
