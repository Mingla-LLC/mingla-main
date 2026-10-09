/**
 * #3682 Wave 2.5 — HS256 tokens for web follow-by-email (n1 confirm / n4 invite).
 * Packs into marketingTokens unsubscribe shape (stable HMAC helper).
 */
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./marketingTokens.ts";

export type WebFollowEmailKind = "confirm" | "invite";

export interface WebFollowEmailTokenPayload {
  kind: WebFollowEmailKind;
  brand_id: string;
  /** Normalized email for invite; auth user id for confirm. */
  subject: string;
  exp: number;
}

const CONFIRM_TTL_SECONDS = 60 * 60 * 24; // 24h
const INVITE_TTL_SECONDS = 60 * 60 * 24 * 3; // 72h
const SECRET_ENV = "BRAND_FOLLOW_TOKEN_SECRET";
const FALLBACK_SECRET_ENV = "UNSUBSCRIBE_TOKEN_SECRET";

function secretEnvKey(): string {
  const dedicated = Deno.env.get(SECRET_ENV);
  if (dedicated !== undefined && dedicated.trim().length >= 32) {
    return SECRET_ENV;
  }
  return FALLBACK_SECRET_ENV;
}

export async function signWebFollowEmailToken(
  payload: Omit<WebFollowEmailTokenPayload, "exp"> & { exp?: number },
): Promise<string> {
  if (payload.kind !== "confirm" && payload.kind !== "invite") {
    throw new Error("web_follow_email_kind_invalid");
  }
  if (payload.brand_id.trim().length === 0 || payload.subject.trim().length === 0) {
    throw new Error("web_follow_email_args_required");
  }
  const ttl = payload.kind === "confirm"
    ? CONFIRM_TTL_SECONDS
    : INVITE_TTL_SECONDS;
  return await signUnsubscribeToken(
    {
      campaign_id: `web_follow:${payload.kind}`,
      recipient_email: payload.subject.trim().toLowerCase(),
      brand_id: payload.brand_id.trim(),
      exp: payload.exp,
    },
    { secretEnvKey: secretEnvKey(), ttlSeconds: ttl },
  );
}

export async function verifyWebFollowEmailToken(
  token: string,
  options: { nowSeconds?: number } = {},
): Promise<WebFollowEmailTokenPayload> {
  const raw = await verifyUnsubscribeToken(token, {
    secretEnvKey: secretEnvKey(),
    nowSeconds: options.nowSeconds,
  });
  const match = /^web_follow:(confirm|invite)$/.exec(raw.campaign_id);
  if (match === null) {
    throw new Error("web_follow_email_payload_invalid");
  }
  return {
    kind: match[1] as WebFollowEmailKind,
    brand_id: raw.brand_id,
    subject: raw.recipient_email.trim().toLowerCase(),
    exp: raw.exp,
  };
}

export async function hashWebFollowToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Confirm link → brand-follow-action style public edge URL. */
export function webFollowConfirmPublicUrl(token: string): string {
  const override = Deno.env.get("MINGLA_BRAND_FOLLOW_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return `${override.trim().replace(/\/$/, "")}/confirm/${token}`;
  }
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (supabaseUrl.length > 0) {
    return `${supabaseUrl}/functions/v1/public-follow-confirm/${token}`;
  }
  return `https://usemingla.com/follow-confirm/${token}`;
}

/** Invite OneLink — AppsFlyer template with follow_invite payload. */
export function webFollowInviteOneLinkUrl(token: string): string {
  const base = (Deno.env.get("GUEST_FUNNEL_ONELINK_URL") ??
    "https://go.usemingla.com/w36m").replace(/\/$/, "");
  const params = new URLSearchParams({
    deep_link_value: "follow_invite",
    deep_link_sub1: token,
  });
  return `${base}?${params.toString()}`;
}

export { CONFIRM_TTL_SECONDS, INVITE_TTL_SECONDS };
