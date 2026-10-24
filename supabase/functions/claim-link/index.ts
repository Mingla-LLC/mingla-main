// Issue #4063 — public claim-pointer resolver and one-tap email proof.
// A code identifies a subject for display; it never grants ownership.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
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
import {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";

export {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";

const CODE = /^[0-9A-Za-z]{10}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP = /^\d{6}$/;
const MAX_BODY_BYTES = 8_192;
const CLAIM_BASE = "https://usemingla.com/c/";

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
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === "https://usemingla.com"
      ? origin
      : "https://usemingla.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
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
  return origin === null || origin === "https://usemingla.com";
}

export function parseClaimLinkBody(
  value: unknown,
): Record<string, unknown> | null {
  if (!isObject(value) || typeof value.op !== "string") return null;
  if (["resolve", "handoff", "prefill", "email_code_send"].includes(value.op)) {
    return only(value, ["op", "code"]) && typeof value.code === "string"
      ? value
      : null;
  }
  if (value.op === "email_code_verify") {
    return only(value, ["op", "challengeId", "otp"]) &&
        typeof value.challengeId === "string" && UUID.test(value.challengeId) &&
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
  const campaign = typeof noun === "string" && noun.length > 0
    ? noun
    : "ticket";
  return {
    oneLink:
      `https://go.usemingla.com/w36m?deep_link_value=claim&deep_link_sub1=${code}&pid=claim_link&c=${
        encodeURIComponent(campaign)
      }`,
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
    return json(req, {
      ok: false,
      error: "bad_code",
      attemptsLeft: data.attemptsLeft,
    }, 400);
  }
  return json(req, { ok: false, error: "invalid" }, 400);
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
    const code = op === "email_code_verify" ? null : codeValue(body);
    if (code === null && op === "resolve") {
      return json(req, { ok: true, status: "not_found" });
    }
    if (code === null && op !== "email_code_verify") {
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
        return json(req, {
          ok: false,
          error: gate === "limited" ? "rate_limited" : "unavailable",
        }, gate === "limited" ? 429 : 503);
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

    if (op === "handoff") {
      const gate = await limited(deps, `cl_handoff:${ipHash}`, 10);
      if (gate !== "allow") {
        return json(req, {
          ok: false,
          error: gate === "limited" ? "rate_limited" : "unavailable",
        }, gate === "limited" ? 429 : 503);
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
        return json(req, {
          ok: false,
          error: gate === "limited" ? "rate_limited" : "unavailable",
        }, gate === "limited" ? 429 : 503);
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
      if (!await deps.sendEmail(result.target, otp, challengeId)) {
        return json(req, { ok: false, error: "send_failed" }, 502);
      }
      return json(req, {
        ok: true,
        challengeId,
        sentTo: maskContactForClaim(result.target, "email"),
      });
    }

    const challengeId = String(body.challengeId);
    const otp = String(body.otp).trim();
    if (!OTP.test(otp)) return json(req, { ok: false, error: "invalid" }, 400);
    const gate = await limited(deps, `cl_code_verify:${ipHash}`, 5);
    if (gate !== "allow") {
      return json(req, {
        ok: false,
        error: gate === "limited" ? "rate_limited" : "unavailable",
      }, gate === "limited" ? 429 : 503);
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
    const email = result.value;
    const { data: userData, error: userError } = await deps.rpc(
      "issue_4063_auth_user_for_email",
      { p_email: email },
    );
    if (userError) {
      return json(req, { ok: false, error: "auth_unavailable" }, 502);
    }
    const userId = typeof userData === "string" ? userData : null;
    if (userId === null && !await deps.createEmailUser(email)) {
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
    sendEmail: async (target, code, challengeId) => {
      const rendered = renderContactCodeEmail({
        code,
        supportEmail: "support@usemingla.com",
        logoUrl: "https://usemingla.com/logo.png",
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
