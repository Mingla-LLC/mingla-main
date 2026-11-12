// #3872 R3 C1 — public social-handle proof. Blocked providers route to review.
// #4402 — every outcome is a 200 with a state, never a 500: a review reason is
// saved only on a handle flagged for a person (creator_handles_review_shape),
// a page that does not show the profile (Instagram serves our server a page
// without the bio) goes to a person instead of "code not seen", a verified
// handle is never downgraded by a re-check, and Instagram's public follower
// line ("2,337 Followers") sets the audience band.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";

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
  review_required?: boolean | null;
  follower_band?: string | null;
  follower_source?: string | null;
};

type PublicFetch = {
  ok: boolean;
  blocked: boolean;
  body: string;
  /** Where the request ended after redirects (a login page means unreadable). */
  finalUrl?: string | null;
};
export type VerifyDecision = {
  status: "verified" | "pending" | "review" | "expired";
  followerBand: string | null;
  followerSource: "provider" | "self_reported";
  reason: string | null;
};
export type CheckStatus = "verified" | "pending" | "unreadable" | "expired";

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

/** The content of a <meta> tag by property or name, in either attribute order. */
function metaContent(body: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** "2,337" -> 2337, "12.5K" -> 12500, "1.2M" -> 1200000. */
export function parseFollowerText(text: string): number | null {
  const match = text.match(/(\d[\d.,]*)\s*([KkMm])?\s+Followers/);
  if (!match) return null;
  const suffix = match[2]?.toLowerCase();
  if (suffix) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    return Math.round(value * (suffix === "m" ? 1_000_000 : 1_000));
  }
  const value = Number(match[1].replace(/[.,]/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function providerFollowerCount(body: string): number | null {
  const patterns = [
    /"(?:followerCount|followers_count|followers)"\s*:\s*(\d{1,12})/i,
    /"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d{1,12})/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return Number(match[1]);
  }
  for (const key of ["og:description", "description"]) {
    const content = metaContent(body, key);
    const count = content ? parseFollowerText(content) : null;
    if (count !== null) return count;
  }
  return null;
}

/** True only when the body carries that platform's public profile marker. */
export function pageShowsProfile(platform: Platform, body: string): boolean {
  const og = metaContent(body, "og:description");
  switch (platform) {
    case "instagram":
      return og !== null && /Followers/i.test(og);
    case "youtube":
      return og !== null || body.includes('"channelMetadataRenderer"');
    case "tiktok":
      return body.includes('"userInfo"');
    case "snapchat":
      return og !== null;
    case "x":
      return false;
    default: {
      const never: never = platform;
      return never;
    }
  }
}

function isLoginPage(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\/accounts\/login|\/login(?:[/?#]|$)|\/signin|\/challenge/i.test(url);
}

export function decideHandleVerification(
  row: Pick<HandleRow, "verify_code" | "verify_expires_at"> & {
    platform?: Platform;
  },
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
  if (isLoginPage(fetched.finalUrl)) {
    return {
      status: "review",
      followerBand: null,
      followerSource: "self_reported",
      reason: "provider_unreadable",
    };
  }
  const count = providerFollowerCount(fetched.body);
  const band = count === null ? null : followerBand(count);
  const source = count === null ? "self_reported" : "provider";
  const found = fetched.body.toUpperCase().includes(
    row.verify_code.toUpperCase(),
  );
  if (found) {
    return {
      status: "verified",
      followerBand: band,
      followerSource: source,
      reason: null,
    };
  }
  if (pageShowsProfile(row.platform ?? "instagram", fetched.body)) {
    return {
      status: "pending",
      followerBand: band,
      followerSource: source,
      reason: "verification_code_not_found",
    };
  }
  return {
    status: "review",
    followerBand: null,
    followerSource: "self_reported",
    reason: "provider_unreadable",
  };
}

const CHECK_STATUS: Record<VerifyDecision["status"], CheckStatus> = {
  verified: "verified",
  pending: "pending",
  review: "unreadable",
  expired: "expired",
};

/** The row update for one outcome. Pure, so the constraint shape is tested. */
export function handleUpdateFor(
  decision: VerifyDecision,
  followerCount: number | null,
  nowIso = new Date().toISOString(),
): Record<string, unknown> {
  return {
    last_checked_at: nowIso,
    last_check_status: CHECK_STATUS[decision.status],
    review_required: decision.status === "review",
    // creator_handles_review_shape: a reason only on a flagged handle.
    review_reason: decision.status === "review" ? decision.reason : null,
    // Set on success; never cleared by a check (no downgrade).
    ...(decision.status === "verified" ? { verified_at: nowIso } : {}),
    ...(decision.followerBand
      ? {
        follower_band: decision.followerBand,
        follower_source: decision.followerSource,
        provider_follower_count: followerCount,
      }
      : {}),
  };
}

export type HandleVerifyDeps = {
  actorId(req: Request): Promise<string | null>;
  load(actorId: string, handleId: string): Promise<HandleRow | null>;
  fetchPublic(platform: Platform, handle: string): Promise<PublicFetch>;
  save(
    handleId: string,
    decision: VerifyDecision,
    followerCount: number | null,
  ): Promise<void>;
  recompute(actorId: string, conflict: boolean): Promise<unknown>;
  report?(error: unknown): void;
};

export function createHandleVerifyHandler(deps: HandleVerifyDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    try {
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
      if (row.verified_at && !row.review_required) {
        return json({
          status: "verified",
          followerBand: row.follower_band ?? null,
          followerSource: row.follower_source === "provider"
            ? "provider"
            : "self_reported",
          reason: null,
          verification: null,
        });
      }
      const fetched = await deps.fetchPublic(row.platform, row.handle);
      const decision = decideHandleVerification(row, fetched);
      const count = decision.followerBand
        ? providerFollowerCount(fetched.body)
        : null;
      await deps.save(row.id, decision, count);
      const verification = await deps.recompute(
        actorId,
        decision.status === "review",
      );
      return json({
        status: decision.status,
        followerBand: decision.followerBand,
        followerSource: decision.followerSource,
        reason: decision.reason,
        verification,
      });
    } catch (error) {
      (deps.report ?? (() => {}))(error);
      return json({ error: "internal" }, 500);
    }
  };
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(createHandleVerifyHandler({
    actorId: userIdFromAuthHeader,
    load: async (actorId, handleId) => {
      const { data, error } = await supabase.from("creator_handles").select(
        "id,creator_account_id,platform,handle,verify_code,verify_started_at,verify_expires_at,verified_at,review_required,follower_band,follower_source",
      ).eq("id", handleId).eq("creator_account_id", actorId).maybeSingle();
      if (error) throw error;
      return data as HandleRow | null;
    },
    fetchPublic: async (platform, handle) => {
      try {
        // A plain GET with our own User-Agent. A desktop browser UA gets a
        // script shell with no profile meta at all (#4402 probe), so it would
        // make the result worse, not better.
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
          finalUrl: response.url || null,
        };
      } catch {
        return { ok: false, blocked: true, body: "", finalUrl: null };
      }
    },
    save: async (handleId, decision, followerCount) => {
      const { error } = await supabase.from("creator_handles")
        .update(handleUpdateFor(decision, followerCount))
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
    report: (error) =>
      captureEdgeException(error, {
        fn: "creator-handle-verify",
        tags: { issue: "4402", code: "internal" },
      }),
  }));
}
