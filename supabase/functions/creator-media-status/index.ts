// #3872 R3 C0 — creator media state and 1-hour playback grant.
// The owner always sees their own media. A gig delivery (and dispute evidence)
// is also visible to the contract's host team and to Mingla admins, so a host
// can watch the video it is asked to approve. Nobody else gets a playback URL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  creatorDownloadUrl,
  creatorPlaybackUrl,
} from "../_shared/creatorMedia.ts";

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

export type MediaStatusRow = {
  id: string;
  owner_id: string;
  purpose: string;
  status: string;
  contract_id: string | null;
  bunny_video_id: string | null;
  aspect_warning: boolean | null;
  failure_code: string | null;
  ready_at: string | null;
  width: number | null;
  height: number | null;
  delete_after: string | null;
};

export type MediaStatusDeps = {
  actorId: (req: Request) => Promise<string | null>;
  media: (jobId: string) => Promise<MediaStatusRow | null>;
  /** True when the actor may read this contract as its host team. */
  isContractHost: (contractId: string, actorId: string) => Promise<boolean>;
  isAdmin: (actorId: string) => Promise<boolean>;
  isApprovedDelivery: (jobId: string, contractId: string) => Promise<boolean>;
  playback: (videoId: string) => Promise<unknown>;
  download: (
    videoId: string,
    width: number | null,
    height: number | null,
  ) => Promise<unknown>;
};

const SHARED_WITH_CONTRACT = new Set(["delivery", "dispute_evidence"]);

export function createCreatorMediaStatusHandler(deps: MediaStatusDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actorId = await deps.actorId(req);
    if (!actorId) return json({ error: "unauthorized" }, 401);
    let jobId = "";
    try {
      const body = await req.json();
      jobId = typeof body?.jobId === "string" ? body.jobId : "";
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!UUID_RE.test(jobId)) return json({ error: "invalid_job" }, 400);
    let data: MediaStatusRow | null;
    try {
      data = await deps.media(jobId);
    } catch {
      return json({ error: "internal" }, 500);
    }
    if (!data) return json({ error: "not_found" }, 404);
    const ownsMedia = data.owner_id === actorId;
    let allowed = ownsMedia;
    let contractHost = false;
    let admin = false;
    if (
      !allowed && SHARED_WITH_CONTRACT.has(data.purpose) && data.contract_id
    ) {
      contractHost = await deps.isContractHost(data.contract_id, actorId);
      admin = contractHost ? false : await deps.isAdmin(actorId);
      allowed = contractHost || admin;
    }
    if (!allowed && data.purpose === "local_review") {
      admin = await deps.isAdmin(actorId);
      allowed = admin;
    }
    // Same answer for "missing" and "not yours", so ids can't be probed.
    if (!allowed) return json({ error: "not_found" }, 404);
    const playback = data.status === "ready" && data.bunny_video_id
      ? await deps.playback(data.bunny_video_id)
      : null;
    const approvedDelivery = contractHost && data.purpose === "delivery" &&
      data.contract_id !== null &&
      await deps.isApprovedDelivery(data.id, data.contract_id);
    const download = approvedDelivery && data.status === "ready" &&
        data.bunny_video_id
      ? await deps.download(data.bunny_video_id, data.width, data.height)
      : null;
    return json({
      jobId: data.id,
      purpose: data.purpose,
      status: data.status,
      aspectWarning: data.aspect_warning,
      failureCode: data.failure_code,
      readyAt: data.ready_at,
      playback,
      download,
      availableUntil: approvedDelivery ? data.delete_after : null,
    });
  };
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createCreatorMediaStatusHandler({
    actorId: userIdFromAuthHeader,
    media: async (jobId) => {
      const { data, error } = await supabase.from("creator_media_jobs")
        .select(
          "id,owner_id,purpose,status,contract_id,bunny_video_id,aspect_warning,failure_code,ready_at,width,height,delete_after",
        )
        .eq("id", jobId).maybeSingle();
      if (error) throw error;
      return data as MediaStatusRow | null;
    },
    isContractHost: async (contractId, actorId) => {
      const { data: contract } = await supabase.from("gig_contracts")
        .select("brand_id").eq("id", contractId).maybeSingle();
      if (!contract?.brand_id) return false;
      const { data, error } = await supabase.rpc(
        "biz_is_brand_member_for_read",
        { p_brand_id: contract.brand_id, p_user_id: actorId },
      );
      return !error && data === true;
    },
    isAdmin: async (actorId) => {
      const { data: user } = await supabase.auth.admin.getUserById(actorId);
      const email = user?.user?.email;
      if (!email) return false;
      const { data } = await supabase.from("admin_users").select("id")
        .eq("email", email).eq("status", "active").maybeSingle();
      return Boolean(data);
    },
    isApprovedDelivery: async (jobId, contractId) => {
      const { data, error } = await supabase.from("gig_deliveries")
        .select("id").eq("media_job_id", jobId).eq("contract_id", contractId)
        .in("decision", ["approved", "auto_approved"]).maybeSingle();
      return !error && Boolean(data);
    },
    playback: creatorPlaybackUrl,
    download: creatorDownloadUrl,
  }));
}
