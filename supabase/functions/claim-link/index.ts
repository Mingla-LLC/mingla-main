// Issue #4063 — public claim-pointer resolver and one-tap email proof.
// A code identifies a subject for display; it never grants ownership.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  qrTokenPepper,
  serviceClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  hashTicketLinkIp,
  requestClientIp,
  resolveOfferingInviteTokenPepper,
} from "../_shared/ticketLinkToken.ts";
import type { OfferingInvitePepper } from "../_shared/offeringInviteToken.ts";
import { maskContactForClaim } from "../_shared/attendanceClaim.ts";
import { emailAdapter } from "../_shared/adapters/emailAdapter.ts";
import { renderContactCodeEmail } from "../_shared/email/contactCodeEmail.ts";
import { EMAIL_SENDERS } from "../_shared/email/senders.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";
import {
  checkVerification,
  startVerification,
} from "../_shared/twilioVerify.ts";
import { runPurchaseClaimSweep } from "../_shared/purchaseClaimSweep.ts";
import { buildRsvpGuestOneLink } from "../_shared/friendInviteLink.ts";

export {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";
import { isLocalSupabaseUrl } from "../_shared/localSupabaseUrl.ts";

const CODE = /^[0-9A-Za-z]{10}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP = /^\d{6}$/;
const MAX_BODY_BYTES = 8_192;
const CLAIM_BASE = "https://usemingla.com/c/";
const ALLOWED_WEB_ORIGINS = new Set([
  "https://usemingla.com",
  "https://host.usemingla.com",
]);

// #4490 Explorer W1: a loopback buyer web (127.0.0.1 / localhost) may call
// this function ONLY while the function itself runs on a local Supabase
// stack (the same rule venueOfferVisitLink.ts applies to return links). A
// deployed function never sees a local SUPABASE_URL, so production keeps the
// two origins above and nothing else.
const LOOPBACK_WEB_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export function webOriginAllowed(
  origin: string,
  supabaseUrl: string,
): boolean {
  if (ALLOWED_WEB_ORIGINS.has(origin)) return true;
  return isLocalSupabaseUrl(supabaseUrl) && LOOPBACK_WEB_ORIGIN.test(origin);
}

const supabaseUrlNow = (): string => {
  try {
    return Deno.env.get("SUPABASE_URL") ?? "";
  } catch {
    return "";
  }
};

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export interface ClaimLinkDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  pepper(): Promise<OfferingInvitePepper>;
  userId(req: Request): Promise<string | null>;
  sendEmail(
    target: string,
    code: string,
    challengeId: string,
  ): Promise<boolean>;
  createEmailUser(email: string): Promise<boolean>;
  magicLinkToken(email: string): Promise<string | null>;
  // #4473 "Is this your ticket?": a signed-in account proves the contact on
  // the purchase behind the link. Optional so older callers keep compiling;
  // a missing dependency answers `unavailable`.
  qrPepper?(): string;
  startPhone?(phone: string): Promise<
    | { ok: true }
    | { ok: false; error: "rate_limited" | "unavailable" | "invalid" }
  >;
  checkPhone?(
    phone: string,
    code: string,
  ): Promise<
    | { ok: true; approved: boolean }
    | { ok: false; error: "expired" | "unavailable" | "invalid" }
  >;
  // #4508 1.18 — tell the inviter, in-app, that their guest said "This isn't
  // me". Optional so older callers keep compiling; best-effort.
  notifyGuestReleased?(input: {
    inviterUserId: string;
    eventId: string;
    eventTitle: string | null;
    phoneLast4: string | null;
    code: string;
  }): Promise<void>;
}

// Countries the SMS code path serves; the same list claim-contact accepts.
const SUPPORTED_PHONE_COUNTRIES = new Set([
  "CA",
  "GB",
  "GH",
  "KE",
  "NG",
  "US",
  "ZA",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin !== null && webOriginAllowed(origin, supabaseUrlNow())
        ? origin
        : "https://usemingla.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || webOriginAllowed(origin, supabaseUrlNow());
}

export function parseClaimLinkBody(
  value: unknown,
): Record<string, unknown> | null {
  if (!isObject(value) || typeof value.op !== "string") return null;
  // #4508 — the RSVP guest link: resolve, "This isn't me", claim.
  if (value.op === "rsvp_guest_resolve" || value.op === "rsvp_guest_release") {
    return only(value, ["op", "code"]) && typeof value.code === "string"
      ? value
      : null;
  }
  if (value.op === "rsvp_guest_claim") {
    return only(value, ["op", "code", "name"]) &&
        typeof value.code === "string" &&
        (value.name === undefined || value.name === null ||
          (typeof value.name === "string" && value.name.trim().length <= 120))
      ? value
      : null;
  }
  if (["resolve", "handoff", "prefill", "email_code_send"].includes(value.op)) {
    return only(value, ["op", "code"]) && typeof value.code === "string"
      ? value
      : null;
  }
  if (value.op === "contact_code_send") {
    return only(value, ["op", "code", "channel"]) &&
      typeof value.code === "string" &&
      (value.channel === "email" || value.channel === "phone")
      ? value
      : null;
  }
  if (value.op === "email_code_verify" || value.op === "contact_code_verify") {
    return only(value, ["op", "challengeId", "otp"]) &&
      typeof value.challengeId === "string" &&
      UUID.test(value.challengeId) &&
      typeof value.otp === "string"
      ? value
      : null;
  }
  return null;
}

async function limited(
  deps: ClaimLinkDeps,
  scope: string,
  limit: number,
): Promise<"allow" | "limited" | "unavailable"> {
  const { data, error } = await deps.rpc("pg_venue_order_rate_limit_hit", {
    p_scope_key: scope,
    p_limit: limit,
  });
  if (error) return "unavailable";
  return isObject(data) && data.allowed === false ? "limited" : "allow";
}

function objectResult(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  return isObject(value) ? value : {};
}

function codeValue(body: Record<string, unknown>): string | null {
  const value = String(body.code ?? "").trim();
  return CODE.test(value) ? value.toUpperCase() : null;
}

function appLink(code: string, noun: unknown): Record<string, string> {
  const campaign =
    typeof noun === "string" && noun.length > 0 ? noun : "ticket";
  return {
    // The live AppsFlyer AASA claims `/w36m/*`, not the bare `/w36m`
    // template root. Keep claim links under a real child path so iOS treats
    // them as Universal Links instead of falling through to the App Store.
    oneLink: `https://go.usemingla.com/w36m/claim?deep_link_value=claim&deep_link_sub1=${code}&pid=claim_link&c=${encodeURIComponent(
      campaign,
    )}`,
    appScheme: `com.mingla.app.v2://c/${code}`,
  };
}

function mapChallengeFailure(
  req: Request,
  outcome: unknown,
  data: Record<string, unknown>,
): Response {
  if (outcome === "rate_limited" || outcome === "locked") {
    return json(req, { ok: false, error: outcome }, 429);
  }
  if (outcome === "expired") {
    return json(req, { ok: false, error: "expired" }, 410);
  }
  if (outcome === "bad_code") {
    return json(
      req,
      {
        ok: false,
        error: "bad_code",
        attemptsLeft: data.attemptsLeft,
      },
      400,
    );
  }
  return json(req, { ok: false, error: "invalid" }, 400);
}

function gateResponse(
  req: Request,
  gate: "allow" | "limited" | "unavailable",
): Response | null {
  if (gate === "allow") return null;
  return json(
    req,
    { ok: false, error: gate === "limited" ? "rate_limited" : "unavailable" },
    gate === "limited" ? 429 : 503,
  );
}

async function sweepFor(
  req: Request,
  deps: ClaimLinkDeps,
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  if (!deps.qrPepper) return json(req, { ok: false, error: "unavailable" }, 503);
  let pepper: string;
  try {
    pepper = deps.qrPepper();
  } catch {
    return json(req, { ok: false, error: "unavailable" }, 503);
  }
  const claim = await runPurchaseClaimSweep(
    (name, args) => deps.rpc(name, args),
    userId,
    pepper,
  );
  if (claim.limited) return json(req, { ok: false, error: "rate_limited" }, 429);
  if (claim.result === null) {
    return json(req, { ok: false, error: "unavailable" }, 503);
  }
  return json(req, { ok: true, ...extra, claimed: claim.result });
}

// #4473 "Is this your ticket?" — a signed-in account asks for a code at the
// email or phone stored on the purchase behind a claim link. The value is
// looked up on the server and only ever shown masked. Proving it records a
// claim-only contact on this account, then the sweeps run.
async function contactProof(
  req: Request,
  deps: ClaimLinkDeps,
  op: string,
  body: Record<string, unknown>,
  code: string | null,
  pepper: OfferingInvitePepper,
  ipHash: string,
): Promise<Response> {
  const userId = await deps.userId(req);
  if (userId === null) {
    return json(req, { ok: false, error: "unauthorized" }, 401);
  }

  if (op === "contact_code_send") {
    const channel = String(body.channel);
    const limitedResponse = gateResponse(
      req,
      await limited(deps, `cl_contact_send:${userId}`, 5),
    );
    if (limitedResponse) return limitedResponse;
    if (channel === "phone" && !deps.startPhone) {
      return json(req, { ok: false, error: "unavailable" }, 503);
    }
    const challengeId = crypto.randomUUID();
    const otp = channel === "email" ? generateContactCode() : "";
    const digest = channel === "email"
      ? await contactCodeHash(pepper.bytes, challengeId, otp)
      : null;
    const { data, error } = await deps.rpc(
      "issue_4473_begin_claim_link_contact_challenge",
      {
        p_challenge_id: challengeId,
        p_user_id: userId,
        p_claim_code: code,
        p_channel: channel,
        p_code_hash: digest,
        p_ip_hash: ipHash,
      },
    );
    if (error) return json(req, { ok: false, error: "unavailable" }, 503);
    const result = objectResult(data);
    if (result.outcome === "already_on_this_account") {
      return await sweepFor(req, deps, userId, { alreadyConfirmed: true });
    }
    if (result.outcome === "no_email" || result.outcome === "no_phone") {
      return json(req, { ok: false, error: result.outcome });
    }
    if (result.outcome === "limit_reached") {
      return json(req, { ok: false, error: "limit_reached" }, 409);
    }
    if (result.outcome !== "started" || typeof result.target !== "string") {
      return mapChallengeFailure(req, result.outcome, result);
    }
    if (channel === "email") {
      if (!(await deps.sendEmail(result.target, otp, challengeId))) {
        return json(req, { ok: false, error: "send_failed" }, 502);
      }
    } else {
      const country = await deps.rpc("mingla_e164_country", {
        p_contact: result.target,
      });
      if (
        country.error ||
        typeof country.data !== "string" ||
        !SUPPORTED_PHONE_COUNTRIES.has(country.data)
      ) {
        return json(req, { ok: false, error: "unsupported_phone" }, 400);
      }
      const sent = await deps.startPhone!(result.target);
      if (!sent.ok) {
        return json(
          req,
          { ok: false, error: sent.error },
          sent.error === "rate_limited" ? 429 : 502,
        );
      }
    }
    return json(req, {
      ok: true,
      challengeId,
      channel,
      sentTo: maskContactForClaim(
        result.target,
        channel === "phone" ? "phone" : "email",
      ),
    });
  }

  const challengeId = String(body.challengeId);
  const otp = String(body.otp).trim();
  if (!OTP.test(otp)) return json(req, { ok: false, error: "invalid" }, 400);
  const limitedResponse = gateResponse(
    req,
    await limited(deps, `cl_contact_verify:${userId}`, 5),
  );
  if (limitedResponse) return limitedResponse;
  const pending = await deps.rpc("issue_4473_claim_link_challenge_for_user", {
    p_challenge_id: challengeId,
    p_user_id: userId,
  });
  if (pending.error) return json(req, { ok: false, error: "unavailable" }, 503);
  const challenge = objectResult(pending.data);
  if (
    challenge.outcome !== "ok" ||
    (challenge.channel !== "email" && challenge.channel !== "phone") ||
    typeof challenge.value !== "string"
  ) {
    return json(req, { ok: false, error: "invalid" }, 400);
  }
  let providerApproved = false;
  let digest: string | null = null;
  if (challenge.channel === "phone") {
    if (!deps.checkPhone) {
      return json(req, { ok: false, error: "unavailable" }, 503);
    }
    const checked = await deps.checkPhone(challenge.value, otp);
    if (!checked.ok) {
      return json(
        req,
        { ok: false, error: checked.error },
        checked.error === "expired" ? 410 : 502,
      );
    }
    providerApproved = checked.approved;
  } else {
    digest = await contactCodeHash(pepper.bytes, challengeId, otp);
  }
  const settled = await deps.rpc("issue_4063_settle_contact_challenge", {
    p_challenge_id: challengeId,
    p_code_hash: digest,
    p_provider_approved: providerApproved,
  });
  if (settled.error) return json(req, { ok: false, error: "unavailable" }, 503);
  const settledResult = objectResult(settled.data);
  if (settledResult.outcome !== "ok") {
    return mapChallengeFailure(req, settledResult.outcome, settledResult);
  }
  if (
    settledResult.userId !== userId ||
    settledResult.purpose !== "claim_add_contact"
  ) {
    return json(req, { ok: false, error: "invalid" }, 400);
  }
  const recorded = await deps.rpc("issue_4063_record_claim_contact", {
    p_user_id: userId,
    p_channel: settledResult.channel,
    p_value: settledResult.value,
  });
  if (recorded.error) return json(req, { ok: false, error: "unavailable" }, 503);
  const recordResult = objectResult(recorded.data).result;
  if (recordResult === "limit_reached") {
    return json(req, { ok: false, error: "limit_reached" }, 409);
  }
  if (recordResult === "retry") {
    return json(req, { ok: false, error: "unavailable" }, 503);
  }
  if (
    recordResult !== "recorded" &&
    recordResult !== "already_on_this_account"
  ) {
    return json(req, { ok: false, error: "invalid" }, 400);
  }
  return await sweepFor(req, deps, userId);
}

// #4508 1.16-1.20 — the RSVP guest link. The code is the guest's claim link
// (subject rsvp_guest): it identifies the guest for display, never grants the
// pass. Claiming needs an account that has proved the invited number; a code
// proved for another number is refused (phone_unproved).
async function rsvpGuestLink(
  req: Request,
  deps: ClaimLinkDeps,
  op: string,
  body: Record<string, unknown>,
  code: string,
  ipHash: string,
): Promise<Response> {
  if (op === "rsvp_guest_resolve") {
    const limitedResponse = gateResponse(
      req,
      await limited(deps, `cl_rsvp_guest_resolve:${ipHash}`, 30),
    );
    if (limitedResponse) return limitedResponse;
    const viewer = await deps.userId(req);
    const { data, error } = await deps.rpc("rsvp_guest_resolve", {
      p_code: code,
      p_viewer: viewer,
    });
    if (error) return json(req, { ok: false, error: "unavailable" }, 503);
    const result = objectResult(data);
    return json(req, {
      ok: true,
      ...result,
      ...(result.status !== "not_found" && result.status !== "released"
        ? {
          appLink: {
            oneLink: buildRsvpGuestOneLink({ code }),
            appScheme: `com.mingla.app.v2://c/${code}`,
          },
        }
        : {}),
    });
  }

  if (op === "rsvp_guest_release") {
    const limitedResponse = gateResponse(
      req,
      await limited(deps, `cl_rsvp_guest_release:${ipHash}`, 5),
    );
    if (limitedResponse) return limitedResponse;
    const { data, error } = await deps.rpc("rsvp_guest_release", {
      p_code: code,
    });
    if (error) return json(req, { ok: false, error: "unavailable" }, 503);
    const result = objectResult(data);
    if (
      result.outcome === "released" &&
      typeof result.inviterUserId === "string" &&
      typeof result.eventId === "string" && deps.notifyGuestReleased
    ) {
      try {
        await deps.notifyGuestReleased({
          inviterUserId: result.inviterUserId,
          eventId: result.eventId,
          eventTitle: typeof result.eventTitle === "string"
            ? result.eventTitle
            : null,
          phoneLast4: typeof result.phoneLast4 === "string"
            ? result.phoneLast4
            : null,
          code,
        });
      } catch (err) {
        // The release is committed; only the courtesy note failed.
        console.error(
          "[claim-link] rsvp guest release note failed",
          err instanceof Error ? err.message : "unknown",
        );
      }
    }
    return json(req, {
      ok: result.outcome === "released" || result.outcome === "already_released",
      outcome: result.outcome ?? "not_found",
    });
  }

  const userId = await deps.userId(req);
  if (userId === null) {
    return json(req, { ok: false, error: "unauthorized" }, 401);
  }
  const limitedResponse = gateResponse(
    req,
    await limited(deps, `cl_rsvp_guest_claim:${userId}`, 10),
  );
  if (limitedResponse) return limitedResponse;
  const name = typeof body.name === "string" && body.name.trim().length > 0
    ? body.name.trim()
    : null;
  const { data, error } = await deps.rpc("rsvp_guest_claim", {
    p_user_id: userId,
    p_code: code,
    p_name: name,
  });
  if (error) {
    return (error.message ?? "").includes("conflict_rsvp_guest_claim")
      ? json(req, { ok: false, error: "conflict" }, 409)
      : json(req, { ok: false, error: "unavailable" }, 503);
  }
  const result = objectResult(data);
  return json(req, {
    ...result,
    ok: result.outcome === "claimed" || result.outcome === "already_claimed",
    outcome: result.outcome ?? "not_found",
  });
}

export function createClaimLinkHandler(
  deps: ClaimLinkDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") {
      return allowedOrigin(req)
        ? new Response("ok", { headers: cors(req) })
        : json(req, { ok: false, error: "origin_denied" }, 403);
    }
    if (!allowedOrigin(req)) {
      return json(req, { ok: false, error: "origin_denied" }, 403);
    }
    if (req.method !== "POST") {
      return json(req, { ok: false, error: "method_not_allowed" }, 405);
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json(req, { ok: false, error: "invalid" }, 413);
    }
    let body: Record<string, unknown> | null;
    try {
      body = parseClaimLinkBody(JSON.parse(raw));
    } catch {
      body = null;
    }
    if (body === null) return json(req, { ok: false, error: "invalid" }, 400);

    const op = String(body.op);
    const verifyOp = op === "email_code_verify" ||
      op === "contact_code_verify";
    const code = verifyOp ? null : codeValue(body);
    if (code === null && (op === "resolve" || op === "rsvp_guest_resolve")) {
      return json(req, { ok: true, status: "not_found" });
    }
    if (code === null && !verifyOp) {
      return json(req, { ok: false, error: "invalid" }, 400);
    }

    let pepper: OfferingInvitePepper;
    try {
      pepper = await deps.pepper();
    } catch {
      return json(req, { ok: false, error: "unavailable" }, 503);
    }
    const ipHash = await hashTicketLinkIp(requestClientIp(req), pepper.bytes);

    if (op === "resolve") {
      const gate = await limited(deps, `cl_resolve:${ipHash}`, 30);
      if (gate !== "allow") {
        return json(
          req,
          {
            ok: false,
            error: gate === "limited" ? "rate_limited" : "unavailable",
          },
          gate === "limited" ? 429 : 503,
        );
      }
      const { data, error } = await deps.rpc("resolve_claim_link", {
        p_code: code,
      });
      if (error) return json(req, { ok: false, error: "unavailable" }, 503);
      const result = objectResult(data);
      const response = { ok: true, ...result };
      if ((result.status === "active" || result.status === "expired") && code) {
        return json(req, { ...response, appLink: appLink(code, result.noun) });
      }
      return json(req, response);
    }

    if (
      op === "rsvp_guest_resolve" || op === "rsvp_guest_release" ||
      op === "rsvp_guest_claim"
    ) {
      return await rsvpGuestLink(req, deps, op, body, code as string, ipHash);
    }

    if (op === "handoff") {
      const gate = await limited(deps, `cl_handoff:${ipHash}`, 10);
      if (gate !== "allow") {
        return json(
          req,
          {
            ok: false,
            error: gate === "limited" ? "rate_limited" : "unavailable",
          },
          gate === "limited" ? 429 : 503,
        );
      }
      const { data, error } = await deps.rpc("mint_claim_link_handoff", {
        p_code: code,
        p_ip_hash: ipHash,
      });
      if (error) return json(req, { ok: false, error: "unavailable" }, 503);
      const result = objectResult(data);
      if (result.outcome === "rate_limited") {
        return json(req, { ok: false, error: "rate_limited" }, 429);
      }
      if (result.outcome !== "ok" || typeof result.code !== "string") {
        return json(req, { ok: false, error: "invalid" }, 400);
      }
      return json(req, {
        ok: true,
        handoffUrl: `${CLAIM_BASE}${result.code}`,
        expiresAt: result.expiresAt,
      });
    }

    if (op === "prefill") {
      const userId = await deps.userId(req);
      if (userId === null) {
        return json(req, { ok: false, error: "unauthorized" }, 401);
      }
      const { data, error } = await deps.rpc("issue_4063_claim_prefill", {
        p_code: code,
        p_user_id: userId,
      });
      if (error) return json(req, { ok: false, error: "unavailable" }, 503);
      const result = objectResult(data);
      return result.outcome === "ok"
        ? json(req, {
            ok: true,
            firstName: result.firstName ?? null,
            lastName: result.lastName ?? null,
            phoneE164: result.phoneE164 ?? null,
          })
        : json(req, { ok: true, reason: "not_proven" });
    }

    if (op === "email_code_send") {
      const gate = await limited(deps, `cl_code_send:${ipHash}`, 3);
      if (gate !== "allow") {
        return json(
          req,
          {
            ok: false,
            error: gate === "limited" ? "rate_limited" : "unavailable",
          },
          gate === "limited" ? 429 : 503,
        );
      }
      const challengeId = crypto.randomUUID();
      const otp = generateContactCode();
      const digest = await contactCodeHash(pepper.bytes, challengeId, otp);
      const { data, error } = await deps.rpc(
        "issue_4063_begin_contact_challenge",
        {
          p_challenge_id: challengeId,
          p_purpose: "claim_sign_in",
          p_channel: "email",
          p_user_id: null,
          p_claim_code: code,
          p_value: null,
          p_code_hash: digest,
          p_ip_hash: ipHash,
        },
      );
      if (error) return json(req, { ok: false, error: "unavailable" }, 503);
      const result = objectResult(data);
      if (result.outcome === "no_email") {
        return json(req, { ok: false, error: "no_email" });
      }
      if (result.outcome !== "started" || typeof result.target !== "string") {
        return mapChallengeFailure(req, result.outcome, result);
      }
      if (!(await deps.sendEmail(result.target, otp, challengeId))) {
        return json(req, { ok: false, error: "send_failed" }, 502);
      }
      return json(req, {
        ok: true,
        challengeId,
        sentTo: maskContactForClaim(result.target, "email"),
      });
    }

    if (op === "contact_code_send" || op === "contact_code_verify") {
      return await contactProof(req, deps, op, body, code, pepper, ipHash);
    }

    const challengeId = String(body.challengeId);
    const otp = String(body.otp).trim();
    if (!OTP.test(otp)) return json(req, { ok: false, error: "invalid" }, 400);
    const gate = await limited(deps, `cl_code_verify:${ipHash}`, 5);
    if (gate !== "allow") {
      return json(
        req,
        {
          ok: false,
          error: gate === "limited" ? "rate_limited" : "unavailable",
        },
        gate === "limited" ? 429 : 503,
      );
    }
    const digest = await contactCodeHash(pepper.bytes, challengeId, otp);
    const { data, error } = await deps.rpc(
      "issue_4063_settle_contact_challenge",
      {
        p_challenge_id: challengeId,
        p_code_hash: digest,
        p_provider_approved: false,
      },
    );
    if (error) return json(req, { ok: false, error: "unavailable" }, 503);
    const result = objectResult(data);
    if (result.outcome !== "ok" || typeof result.value !== "string") {
      return mapChallengeFailure(req, result.outcome, result);
    }
    // #4473: only a sign-in challenge may mint a sign-in. A code proved for
    // another purpose (adding a contact to a signed-in account) never does.
    if (result.purpose !== "claim_sign_in") {
      return json(req, { ok: false, error: "invalid" }, 400);
    }
    const email = result.value;
    const { data: userData, error: userError } = await deps.rpc(
      "issue_4063_auth_user_for_email",
      { p_email: email },
    );
    if (userError) {
      return json(req, { ok: false, error: "auth_unavailable" }, 502);
    }
    const userId = typeof userData === "string" ? userData : null;
    if (userId === null && !(await deps.createEmailUser(email))) {
      return json(req, { ok: false, error: "auth_unavailable" }, 502);
    }
    const tokenHash = await deps.magicLinkToken(email);
    if (tokenHash === null) {
      return json(req, { ok: false, error: "auth_unavailable" }, 502);
    }
    return json(req, {
      ok: true,
      tokenHash,
      verificationType: "magiclink",
    });
  };
}

function productionDeps(): ClaimLinkDeps {
  let client: ReturnType<typeof serviceClient> | null = null;
  const admin = () => (client ??= serviceClient());
  return {
    rpc: async (name, args) => {
      const { data, error } = await admin().rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    },
    pepper: resolveOfferingInviteTokenPepper,
    userId: userIdFromAuthHeader,
    qrPepper: qrTokenPepper,
    startPhone: async (phone) => {
      const result = await startVerification(phone);
      return result.ok ? { ok: true } : result;
    },
    checkPhone: async (phone, code) => {
      const result = await checkVerification(phone, code);
      return result.ok ? { ok: true, approved: result.approved } : result;
    },
    sendEmail: async (target, code, challengeId) => {
      const rendered = renderContactCodeEmail({
        code,
        supportEmail: "support@usemingla.com",
        logoUrl: minglaLogoUrl(),
        footerAddress: "Mingla · support@usemingla.com",
        sender: EMAIL_SENDERS.noreply,
      });
      const result = await emailAdapter.send({
        to: target,
        title: rendered.subject,
        body: rendered.text,
        idempotencyKey: `claim-code:${challengeId}`,
        rendered,
      });
      return result.ok;
    },
    createEmailUser: async (email) => {
      const { error } = await admin().auth.admin.createUser({
        email,
        email_confirm: true,
      });
      return error === null;
    },
    notifyGuestReleased: async (input) => {
      const { error } = await admin().functions.invoke("notify-dispatch", {
        body: {
          userId: input.inviterUserId,
          type: "rsvp_guest_released",
          title: "Your guest's spot is free",
          body: `The number ending ${
            input.phoneLast4 ?? "...."
          } said it isn't them${
            input.eventTitle ? ` for ${input.eventTitle}` : ""
          }. We won't text it again.`,
          data: { eventId: input.eventId },
          relatedId: input.eventId,
          relatedType: "event",
          skipPush: true,
          idempotencyKey: `rsvp_guest_released:${input.code}`,
        },
      });
      if (error) throw new Error(error.message);
    },
    magicLinkToken: async (email) => {
      const { data, error } = await admin().auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      return error === null && typeof data.properties?.hashed_token === "string"
        ? data.properties.hashed_token
        : null;
    },
  };
}

export const handler = createClaimLinkHandler(productionDeps());
if (import.meta.main) serve(handler);
