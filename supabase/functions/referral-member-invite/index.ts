// Issue #3872 — invite up to 50 promoters with single-use, hashed-at-rest tokens.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { escapeHtml } from "../_shared/email/escape.ts";
import {
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type RpcResult = { data: unknown; error: { message: string } | null };
export interface InviteInput {
  email: string;
  displayName?: string;
  code?: string;
}
export interface InviteContext {
  brandName: string;
  offerName: string;
  rewardLine: string;
}
export interface ReferralInviteDeps {
  actorId(req: Request): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  context(offerId: string): Promise<InviteContext | null>;
  send(
    input: { to: string; subject: string; html: string },
  ): Promise<{ ok: boolean; error?: string }>;
  randomBytes(size: number): Uint8Array;
  origin: string;
}

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...ticketCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const token = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export async function sha256(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
export function buildReferralInviteEmail(
  input: InviteContext & { acceptUrl: string; displayName: string },
) {
  const name = escapeHtml(input.displayName || "there");
  const brandHtml = escapeHtml(input.brandName);
  const offer = escapeHtml(input.offerName);
  const reward = escapeHtml(input.rewardLine);
  const url = escapeHtml(input.acceptUrl);
  return {
    subject: `${input.brandName} invited you to earn with Mingla`,
    html:
      `<p>Hi ${name},</p><p><strong>${brandHtml}</strong> invited you to <strong>${offer}</strong>.</p><p>${reward}</p><p><a href="${url}">See and accept your invite</a></p><p>This private link expires in 14 days.</p>`,
  };
}

export function createReferralInviteHandler(deps: ReferralInviteDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const actor = await deps.actorId(req);
    if (!actor) return response({ error: "unauthorized" }, 401);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return response({ error: "invalid_json" }, 400);
    }
    if (
      !isObject(body) || typeof body.offerId !== "string" ||
      !Array.isArray(body.members) ||
      body.members.length < 1 || body.members.length > 50 ||
      !body.members.every(isObject)
    ) {
      return response({ error: "invalid_request" }, 400);
    }
    const offerId = body.offerId;
    const offerContext = await deps.context(offerId);
    if (!offerContext) return response({ error: "offer_not_found" }, 404);
    const members: Array<
      InviteInput & { token: string; tokenHash: string; linkSlug: string }
    > = [];
    for (const raw of body.members) {
      const email = String(raw.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return response({ error: "invite_invalid" }, 400);
      }
      const rawToken = token(deps.randomBytes(32));
      members.push({
        email,
        displayName: typeof raw.displayName === "string"
          ? raw.displayName.trim()
          : undefined,
        code: typeof raw.code === "string"
          ? raw.code.trim().toUpperCase()
          : undefined,
        token: rawToken,
        tokenHash: await sha256(rawToken),
        linkSlug: hex(deps.randomBytes(4)),
      });
    }
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString();
    const result = await deps.rpc("issue_3872_referral_member_invite", {
      p_actor: actor,
      p_offer_id: offerId,
      p_members: members.map((
        { email, displayName, code, tokenHash, linkSlug },
      ) => ({
        email,
        displayName,
        code,
        tokenHash,
        linkSlug,
      })),
      p_expires_at: expiresAt,
    });
    if (result.error) {
      const detail = result.error.message.trim();
      if (detail === "insufficient_permission") {
        return response({ error: "forbidden", detail }, 403);
      }
      if (detail === "offer_not_found") {
        return response({ error: "offer_not_found", detail }, 404);
      }
      if (
        [
          "offer_not_invitable",
          "referrals_disabled",
          "invite_batch_invalid",
          "invite_invalid",
          "member_already_joined",
        ].includes(detail)
      ) {
        return response({ error: "invite_failed", detail }, 409);
      }
      return response({ error: "internal", detail: "internal" }, 500);
    }
    const origin = deps.origin.replace(/\/+$/, "");
    const delivery = [];
    for (const member of members) {
      const email = buildReferralInviteEmail({
        ...offerContext,
        displayName: member.displayName || member.email.split("@")[0],
        acceptUrl: `${origin}/join/referral/${
          encodeURIComponent(member.token)
        }`,
      });
      const sent = await deps.send({ to: member.email, ...email });
      delivery.push({
        email: member.email,
        sent: sent.ok,
        error: sent.ok ? null : "delivery_failed",
      });
    }
    return response(
      { members: result.data, delivery, expiresAt },
      delivery.every((item) => item.sent) ? 200 : 207,
    );
  };
}

if (import.meta.main) {
  const client = serviceClient();
  serve(createReferralInviteHandler({
    actorId: userIdFromAuthHeader,
    rpc: async (name, args) => (await client.rpc(name, args)) as RpcResult,
    context: async (offerId) => {
      const { data } = await client.from("referral_offers")
        .select("name,reward_kind,share_bps,perk_text,brand:brands(name)")
        .eq("id", offerId).maybeSingle();
      if (!data) return null;
      const brand = data.brand as unknown as { name?: string } | null;
      const rewardLine = data.reward_kind === "cash"
        ? `Earn ${
          Number(data.share_bps ?? 0) / 100
        }% of eligible sales you refer.`
        : data.reward_kind === "perk"
        ? String(data.perk_text ?? "Unlock a host reward.")
        : "Earn a host-funded voucher when your referrals qualify.";
      return {
        brandName: brand?.name ?? "A Mingla host",
        offerName: String(data.name),
        rewardLine,
      };
    },
    send: async ({ to, subject, html }) => {
      const key = Deno.env.get("RESEND_API_KEY") ?? "";
      if (!key) return { ok: false, error: "provider_unavailable" };
      // no-attachment: referral invitations are secure link-only transactional emails.
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_INVITE_FROM") ??
            Deno.env.get("RESEND_MARKETING_FROM") ??
            "Mingla <noreply@usemingla.com>",
          to: [to],
          subject,
          html,
        }),
      });
      return res.ok
        ? { ok: true }
        : { ok: false, error: `resend_${res.status}` };
    },
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    origin: Deno.env.get("BUSINESS_WEB_ORIGIN") ??
      Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
      "https://host.usemingla.com",
  }));
}
