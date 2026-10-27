// #3872 R3 C1 — public social-handle proof. Blocked providers route to review.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type Platform = "instagram" | "tiktok" | "youtube" | "x" | "snapchat";
type HandleRow = {
  id: string;
  creator_account_id: string;
  platform: Platform;
  handle: string;
  verify_code: string;
  verify_started_at: string;
  verify_expires_at: string;
  verified_at: string | null;
};

type PublicFetch = { ok: boolean; blocked: boolean; body: string };
export type VerifyDecision = {
  status: "verified" | "pending" | "review" | "expired";
  followerBand: string | null;
  followerSource: "provider" | "self_reported";
  reason: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const PLATFORM_URL: Record<Platform, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`,
  tiktok: (h) => `https://www.tiktok.com/@${encodeURIComponent(h)}`,
  youtube: (h) => `https://www.youtube.com/@${encodeURIComponent(h)}`,
  x: (h) => `https://x.com/${encodeURIComponent(h)}`,
  snapchat: (h) => `https://www.snapchat.com/add/${encodeURIComponent(h)}`,
};

export function followerBand(count: number): string {
  if (count < 1_000) return "lt1k";
  if (count < 10_000) return "1k_10k";
  if (count < 50_000) return "10k_50k";
  if (count < 250_000) return "50k_250k";
  if (count < 1_000_000) return "250k_1m";
  return "gt1m";
}

function providerFollowerCount(body: string): number | null {
  const patterns = [
    /"(?:followerCount|followers_count|followers)"\s*:\s*(\d{1,12})/i,
    /"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d{1,12})/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function decideHandleVerification(
  row: Pick<HandleRow, "verify_code" | "verify_expires_at">,
  fetched: PublicFetch,
  now = new Date(),
): VerifyDecision {
  if (now.getTime() >= new Date(row.verify_expires_at).getTime()) {
    return {
      status: "expired",
      followerBand: null,
      followerSource: "self_reported",
      reason: "verification_code_expired",
    };
  }
  if (fetched.blocked || !fetched.ok) {
    return {
      status: "review",
      followerBand: null,
      followerSource: "self_reported",
      reason: "provider_fetch_blocked",
    };
  }
  const count = providerFollowerCount(fetched.body);
  const found = fetched.body.toUpperCase().includes(
    row.verify_code.toUpperCase(),
  );
  return {
    status: found ? "verified" : "pending",
    followerBand: count === null ? null : followerBand(count),
    followerSource: count === null ? "self_reported" : "provider",
    reason: found ? null : "verification_code_not_found",
  };
}

export type HandleVerifyDeps = {
  actorId(req: Request): Promise<string | null>;
  load(actorId: string, handleId: string): Promise<HandleRow | null>;
  fetchPublic(platform: Platform, handle: string): Promise<PublicFetch>;
  save(handleId: string, decision: VerifyDecision): Promise<void>;
  recompute(actorId: string, conflict: boolean): Promise<unknown>;
};

export function createHandleVerifyHandler(deps: HandleVerifyDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const actorId = await deps.actorId(req);
    if (!actorId) return json({ error: "unauthorized" }, 401);
    let handleId = "";
    try {
      const body = await req.json() as { handleId?: unknown };
      handleId = typeof body.handleId === "string" ? body.handleId : "";
    } catch { /* invalid below */ }
    if (!/^[0-9a-f-]{36}$/i.test(handleId)) {
      return json({ error: "invalid_handle" }, 400);
    }
    const row = await deps.load(actorId, handleId);
    if (!row) return json({ error: "handle_not_found" }, 404);
    const fetched = await deps.fetchPublic(row.platform, row.handle);
    const decision = decideHandleVerification(row, fetched);
    await deps.save(row.id, decision);
    const verification = await deps.recompute(
      actorId,
      decision.status === "review",
    );
    return json({ ...decision, verification });
  };
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createHandleVerifyHandler({
    actorId: userIdFromAuthHeader,
    load: async (actorId, handleId) => {
      const { data, error } = await supabase.from("creator_handles").select(
        "id,creator_account_id,platform,handle,verify_code,verify_started_at,verify_expires_at,verified_at",
      ).eq("id", handleId).eq("creator_account_id", actorId).maybeSingle();
      if (error) throw error;
      return data as HandleRow | null;
    },
    fetchPublic: async (platform, handle) => {
      try {
        const response = await fetch(PLATFORM_URL[platform](handle), {
          headers: {
            "User-Agent": "MinglaHandleVerifier/1.0 (+https://usemingla.com)",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        const blocked = response.status === 401 || response.status === 403 ||
          response.status === 429;
        return {
          ok: response.ok,
          blocked,
          body: response.ok ? await response.text() : "",
        };
      } catch {
        return { ok: false, blocked: true, body: "" };
      }
    },
    save: async (handleId, decision) => {
      const update = {
        last_checked_at: new Date().toISOString(),
        verified_at: decision.status === "verified"
          ? new Date().toISOString()
          : null,
        review_required: decision.status === "review",
        review_reason: decision.reason,
        ...(decision.followerBand
          ? {
            follower_band: decision.followerBand,
            follower_source: decision.followerSource,
          }
          : {}),
      };
      const { error } = await supabase.from("creator_handles").update(update)
        .eq("id", handleId);
      if (error) throw error;
    },
    recompute: async (actorId, conflict) => {
      const { data, error } = await supabase.rpc(
        "issue_3872_recompute_creator_verification",
        {
          p_creator_account_id: actorId,
          p_signal_conflict: conflict,
        },
      );
      if (error) throw error;
      return data;
    },
  }));
}
