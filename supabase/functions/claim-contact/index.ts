// Issue #4063 — authenticated verification of extra claim-only contacts.
// This function never writes profiles, GoTrue users, or the phone identity ledger.

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
import {
  contactCodeHash,
  generateContactCode,
} from "../_shared/contactCode.ts";
import {
  checkVerification,
  startVerification,
} from "../_shared/twilioVerify.ts";
import { emailAdapter } from "../_shared/adapters/emailAdapter.ts";
import { renderContactCodeEmail } from "../_shared/email/contactCodeEmail.ts";
import { EMAIL_SENDERS } from "../_shared/email/senders.ts";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9][0-9]{1,14}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP = /^\d{6}$/;
const MAX_BODY_BYTES = 8_192;

export const SUPPORTED_PHONE_COUNTRIES = [
  "CA",
  "GB",
  "GH",
  "KE",
  "NG",
  "US",
  "ZA",
] as const;
const SUPPORTED_COUNTRY_SET = new Set<string>(SUPPORTED_PHONE_COUNTRIES);
const DIAL_CODE: Readonly<Record<string, string>> = {
  CA: "1",
  GB: "44",
  GH: "233",
  KE: "254",
  NG: "234",
  US: "1",
  ZA: "27",
};

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export interface ClaimContactDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  pepper(): Promise<OfferingInvitePepper>;
  userId(req: Request): Promise<string | null>;
  sendEmail(
    target: string,
    code: string,
    challengeId: string,
  ): Promise<boolean>;
  startPhone(phone: string): Promise<
    { ok: true } | {
      ok: false;
      error: "rate_limited" | "unavailable" | "invalid";
    }
  >;
  checkPhone(phone: string, code: string): Promise<
    | { ok: true; approved: boolean }
    | { ok: false; error: "expired" | "unavailable" | "invalid" }
  >;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function parseClaimContactBody(
  value: unknown,
): Record<string, unknown> | null {
  if (!isObject(value) || typeof value.op !== "string") return null;
  if (value.op === "send") {
    return only(value, ["op", "channel", "value"]) &&
        (value.channel === "email" || value.channel === "phone") &&
        typeof value.value === "string"
      ? value
      : null;
  }
  if (value.op === "verify") {
    return only(value, ["op", "challengeId", "code"]) &&
        typeof value.challengeId === "string" && UUID.test(value.challengeId) &&
        typeof value.code === "string"
      ? value
      : null;
  }
  return null;
}

function objectResult(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  return isObject(value) ? value : {};
}

async function limited(
  deps: ClaimContactDeps,
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

async function sweep(
  deps: ClaimContactDeps,
  userId: string,
): Promise<{ result: Record<string, unknown> | null; limited: boolean }> {
  const attempt = await deps.rpc("begin_attendance_claim_attempt", {
    p_user_id: userId,
    p_kind: "identity",
  });
  const budget = objectResult(attempt.data);
  if (attempt.error || budget.allowed !== true) {
    return { result: null, limited: budget.allowed === false };
  }
  const claimed = await deps.rpc("claim_attendance_by_verified_identity", {
    p_user_id: userId,
  });
  return {
    result: claimed.error ? null : objectResult(claimed.data),
    limited: false,
  };
}

function normalize(channel: string, value: string): string | null {
  const normalized = channel === "email"
    ? value.trim().toLowerCase()
    : value.trim();
  if (channel === "email") return EMAIL.test(normalized) ? normalized : null;
  return E164.test(normalized) ? normalized : null;
}

function maskedPhone(country: string, phone: string): string {
  const dial = DIAL_CODE[country] ?? "";
  return `+${dial || "••••"} •••• ${phone.slice(-4)}`;
}

function conflictResponse(result: Record<string, unknown>): Response {
  const outcome = result.outcome;
  if (outcome === "already_other_account" || outcome === "limit_reached") {
    return json({ ok: false, error: outcome }, 409);
  }
  if (outcome === "rate_limited") {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  return json({ ok: false, error: "invalid_value" }, 400);
}

function settleFailure(result: Record<string, unknown>): Response {
  if (result.outcome === "bad_code") {
    return json({
      ok: false,
      error: "bad_code",
      attemptsLeft: result.attemptsLeft,
    }, 400);
  }
  if (result.outcome === "expired") {
    return json({ ok: false, error: "expired" }, 410);
  }
  if (result.outcome === "locked" || result.outcome === "rate_limited") {
    return json({ ok: false, error: result.outcome }, 429);
  }
  return json({ ok: false, error: "invalid" }, 400);
}

export function createClaimContactHandler(
  deps: ClaimContactDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }
    const userId = await deps.userId(req);
    if (userId === null) return json({ ok: false, error: "unauthorized" }, 401);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "invalid" }, 413);
    }
    let body: Record<string, unknown> | null;
    try {
      body = parseClaimContactBody(JSON.parse(raw));
    } catch {
      body = null;
    }
    if (body === null) return json({ ok: false, error: "invalid" }, 400);

    let pepper: OfferingInvitePepper;
    try {
      pepper = await deps.pepper();
    } catch {
      return json({ ok: false, error: "unavailable" }, 503);
    }
    const ipHash = await hashTicketLinkIp(requestClientIp(req), pepper.bytes);

    if (body.op === "send") {
      const channel = String(body.channel);
      const value = normalize(channel, String(body.value));
      if (value === null) {
        return json({ ok: false, error: "invalid_value" }, 400);
      }
      const gate = await limited(deps, `cc_send:${ipHash}`, 5);
      if (gate !== "allow") {
        return json({
          ok: false,
          error: gate === "limited" ? "rate_limited" : "unavailable",
        }, gate === "limited" ? 429 : 503);
      }

      let country = "";
      if (channel === "phone") {
        const countryResult = await deps.rpc("mingla_e164_country", {
          p_contact: value,
        });
        country = typeof countryResult.data === "string"
          ? countryResult.data
          : "";
        if (countryResult.error || !SUPPORTED_COUNTRY_SET.has(country)) {
          return json({ ok: false, error: "invalid_value" }, 400);
        }
      }

      const challengeId = crypto.randomUUID();
      const code = channel === "email" ? generateContactCode() : "";
      const digest = channel === "email"
        ? await contactCodeHash(pepper.bytes, challengeId, code)
        : null;
      const { data, error } = await deps.rpc(
        "issue_4063_begin_contact_challenge",
        {
          p_challenge_id: challengeId,
          p_purpose: "add_contact",
          p_channel: channel,
          p_user_id: userId,
          p_claim_code: null,
          p_value: value,
          p_code_hash: digest,
          p_ip_hash: ipHash,
        },
      );
      if (error) return json({ ok: false, error: "unavailable" }, 503);
      const result = objectResult(data);
      if (result.outcome === "already_on_this_account") {
        const claim = await sweep(deps, userId);
        if (claim.limited) {
          return json({ ok: false, error: "rate_limited" }, 429);
        }
        if (claim.result === null) {
          return json({ ok: false, error: "unavailable" }, 503);
        }
        return json({
          ok: true,
          alreadyConfirmed: true,
          claimed: claim.result,
        });
      }
      if (result.outcome !== "started") return conflictResponse(result);

      if (channel === "email") {
        if (!await deps.sendEmail(value, code, challengeId)) {
          return json({ ok: false, error: "send_failed" }, 502);
        }
      } else {
        const sent = await deps.startPhone(value);
        if (!sent.ok) {
          return json(
            { ok: false, error: sent.error },
            sent.error === "rate_limited" ? 429 : 502,
          );
        }
      }
      return json({
        ok: true,
        challengeId,
        sentTo: channel === "email" ? value : maskedPhone(country, value),
      });
    }

    const challengeId = String(body.challengeId);
    const code = String(body.code).trim();
    if (!OTP.test(code)) return json({ ok: false, error: "invalid" }, 400);
    const gate = await limited(deps, `cc_verify:${userId}`, 5);
    if (gate !== "allow") {
      return json({
        ok: false,
        error: gate === "limited" ? "rate_limited" : "unavailable",
      }, gate === "limited" ? 429 : 503);
    }
    const challengeResult = await deps.rpc(
      "issue_4063_contact_challenge_for_user",
      { p_challenge_id: challengeId, p_user_id: userId },
    );
    if (challengeResult.error) {
      return json({ ok: false, error: "unavailable" }, 503);
    }
    const challenge = objectResult(challengeResult.data);
    if (
      challenge.outcome !== "ok" || typeof challenge.channel !== "string" ||
      typeof challenge.value !== "string"
    ) {
      return json({ ok: false, error: "invalid" }, 400);
    }

    let providerApproved = false;
    let digest: string | null = null;
    if (challenge.channel === "phone") {
      const checked = await deps.checkPhone(challenge.value, code);
      if (!checked.ok) {
        return json(
          { ok: false, error: checked.error },
          checked.error === "expired" ? 410 : 502,
        );
      }
      providerApproved = checked.approved;
    } else {
      digest = await contactCodeHash(pepper.bytes, challengeId, code);
    }

    const settled = await deps.rpc("issue_4063_settle_contact_challenge", {
      p_challenge_id: challengeId,
      p_code_hash: digest,
      p_provider_approved: providerApproved,
    });
    if (settled.error) return json({ ok: false, error: "unavailable" }, 503);
    const settledResult = objectResult(settled.data);
    if (settledResult.outcome !== "ok" || settledResult.userId !== userId) {
      return settleFailure(settledResult);
    }
    const recorded = await deps.rpc("issue_4063_record_claim_contact", {
      p_user_id: userId,
      p_channel: settledResult.channel,
      p_value: settledResult.value,
    });
    if (recorded.error) return json({ ok: false, error: "unavailable" }, 503);
    const recordResult = objectResult(recorded.data).result;
    if (
      recordResult === "already_other_account" ||
      recordResult === "limit_reached"
    ) {
      return json({ ok: false, error: recordResult }, 409);
    }
    if (recordResult === "retry") {
      return json({ ok: false, error: "unavailable" }, 503);
    }
    if (
      recordResult !== "recorded" && recordResult !== "already_on_this_account"
    ) {
      return json({ ok: false, error: "invalid" }, 400);
    }
    const claimed = await sweep(deps, userId);
    if (claimed.limited) return json({ ok: false, error: "rate_limited" }, 429);
    if (claimed.result === null) {
      return json({ ok: false, error: "unavailable" }, 503);
    }
    return json({ ok: true, claimed: claimed.result });
  };
}

function productionDeps(): ClaimContactDeps {
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
        idempotencyKey: `claim-contact:${challengeId}`,
        rendered,
      });
      return result.ok;
    },
    startPhone: async (phone) => {
      const result = await startVerification(phone);
      return result.ok ? { ok: true } : result;
    },
    checkPhone: async (phone, code) => {
      const result = await checkVerification(phone, code);
      return result.ok ? { ok: true, approved: result.approved } : result;
    },
  };
}

export const handler = createClaimContactHandler(productionDeps());
if (import.meta.main) serve(handler);
