// #3872 R3 C1 — public social-handle proof.
// #4402 — Seth, 12 Nov 2026: a person at Mingla verifies every handle. This
// check never verifies anything and never sets an audience band: it reads the
// public profile, records what it saw (code seen, code not seen, unreadable,
// expired) as evidence for the admin, and keeps the handle in Admin review.
// A handle an admin rejected stays rejected (no fetch, no write) until an
// admin reopens it. Every outcome is a 200 with a CHECK-valid row, never a 500
// (creator_handles_review_shape: the handle stays flagged, so a reason is legal).
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
  last_check_status?: string | null;
};

type PublicFetch = {
  ok: boolean;
  blocked: boolean;
  body: string;
  /** Where the request ended after redirects (a login page means unreadable). */
  finalUrl?: string | null;
};
/** What the check saw. Evidence for the admin; never a verdict. */
export type CheckStatus =
  | "code_seen"
  | "code_not_seen"
  | "unreadable"
  | "expired";
export type VerifyDecision = {
  check: CheckStatus;
  reason:
    | "code_seen"
    | "verification_code_not_found"
    | "provider_unreadable"
    | "provider_fetch_blocked"
    | "verification_code_expired";
};
export type FollowerSource = "self_reported" | "provider" | "admin";
export type SaveResult = {
  saved: boolean;
  last_check_status: string | null;
  verified: boolean;
  follower_band: string | null;
  follower_source: string | null;
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
    return { check: "expired", reason: "verification_code_expired" };
  }
  if (fetched.blocked || !fetched.ok) {
    return { check: "unreadable", reason: "provider_fetch_blocked" };
  }
  if (isLoginPage(fetched.finalUrl)) {
    return { check: "unreadable", reason: "provider_unreadable" };
  }
  if (fetched.body.toUpperCase().includes(row.verify_code.toUpperCase())) {
    return { check: "code_seen", reason: "code_seen" };
  }
  if (pageShowsProfile(row.platform ?? "instagram", fetched.body)) {
    return { check: "code_not_seen", reason: "verification_code_not_found" };
  }
  return { check: "unreadable", reason: "provider_unreadable" };
}

/**
 * The row update for one check. Pure, so the constraint shape is tested. The
 * handle stays with a person (review_required), so the reason is legal under
 * creator_handles_review_shape; verified_at and the audience are never touched.
 */
export function handleUpdateFor(
  decision: VerifyDecision,
  nowIso = new Date().toISOString(),
): Record<string, unknown> {
  return {
    last_checked_at: nowIso,
    last_check_status: decision.check,
    review_required: true,
    review_reason: decision.reason,
  };
}

function followerSource(value: string | null | undefined): FollowerSource {
  return value === "admin" || value === "provider" ? value : "self_reported";
}

export type HandleVerifyDeps = {
  actorId(req: Request): Promise<string | null>;
  load(actorId: string, handleId: string): Promise<HandleRow | null>;
  fetchPublic(platform: Platform, handle: string): Promise<PublicFetch>;
  /**
   * Compare-and-set: saves only while the handle still waits for an admin with
   * the code this check read. Returns the row's current state either way, or
   * null when the handle is gone.
   */
  save(
    row: Pick<HandleRow, "id" | "creator_account_id" | "verify_code">,
    decision: VerifyDecision,
  ): Promise<SaveResult | null>;
  recompute(actorId: string): Promise<unknown>;
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
      const band = row.follower_band ?? null;
      const source = followerSource(row.follower_source);
      // A rejection sticks until an admin reopens it: nothing fetched, nothing
      // written. (A new code is refused by creator_handle_upsert too.)
      if (row.last_check_status === "rejected") {
        return json({
          status: "rejected",
          check: null,
          followerBand: band,
          followerSource: source,
          reason: "handle_rejected",
          verification: null,
        });
      }
      // Approved by an admin: nothing to check.
      if (row.verified_at && !row.review_required) {
        return json({
          status: "verified",
          check: null,
          followerBand: band,
          followerSource: source,
          reason: null,
          verification: null,
        });
      }
      const fetched = await deps.fetchPublic(row.platform, row.handle);
      const decision = decideHandleVerification(row, fetched);
      const result = await deps.save(row, decision);
      if (!result) return json({ error: "handle_not_found" }, 404);
      if (!result.saved) {
        // An admin decided (or a new code was issued) while the profile was
        // being fetched: nothing was written; report what the row says now.
        const now = result.last_check_status === "rejected"
          ? "rejected"
          : result.verified
          ? "verified"
          : "review";
        return json({
          status: now,
          check: null,
          followerBand: result.follower_band ?? null,
          followerSource: followerSource(result.follower_source),
          reason: now === "rejected" ? "handle_rejected" : "superseded",
          verification: null,
        });
      }
      const verification = await deps.recompute(actorId);
      return json({
        status: decision.check === "expired" ? "expired" : "review",
        check: decision.check,
        followerBand: band,
        followerSource: source,
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
        "id,creator_account_id,platform,handle,verify_code,verify_started_at,verify_expires_at,verified_at,review_required,follower_band,follower_source,last_check_status",
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
    save: async (row, decision) => {
      // I-4402-CHECK-NEVER-UNDOES-ADMIN: the only write path is the
      // compare-and-set RPC (handleUpdateFor documents the same fields).
      const { data, error } = await supabase.rpc(
        "issue_4402_record_handle_check",
        {
          p_handle_id: row.id,
          p_creator_account_id: row.creator_account_id,
          p_verify_code: row.verify_code,
          p_check: decision.check,
          p_reason: decision.reason,
        },
      );
      if (error) throw error;
      const out = data as (SaveResult & { found?: boolean }) | null;
      return out && out.found !== false ? out : null;
    },
    recompute: async (actorId) => {
      const { data, error } = await supabase.rpc(
        "issue_3872_recompute_creator_verification",
        {
          p_creator_account_id: actorId,
          p_signal_conflict: false,
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
