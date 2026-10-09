/**
 * #3682 Wave 2.4 — HS256 tokens for one-tap follow / unfollow from order emails.
 * Same primitive as marketing unsubscribe tokens; separate payload + secret env.
 */
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./marketingTokens.ts";

export type BrandFollowAction = "follow" | "unfollow";

export interface BrandFollowTokenPayload {
  action: BrandFollowAction;
  brand_id: string;
  /** Signed-in buyer; required for unfollow of brand_follows rows. */
  user_id: string;
  /** Unix seconds. */
  exp: number;
}

const FOLLOW_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const SECRET_ENV = "BRAND_FOLLOW_TOKEN_SECRET";
/** Dev/test fallback: reuse unsubscribe secret when follow secret is unset. */
const FALLBACK_SECRET_ENV = "UNSUBSCRIBE_TOKEN_SECRET";

function secretEnvKey(): string {
  const dedicated = Deno.env.get(SECRET_ENV);
  if (dedicated !== undefined && dedicated.trim().length >= 32) {
    return SECRET_ENV;
  }
  return FALLBACK_SECRET_ENV;
}

/**
 * Encode follow-action claims into the unsubscribe token shape by packing
 * action+user into campaign_id / recipient_email slots (stable HS256 helper).
 * campaign_id := `follow:<action>`
 * recipient_email := user_id (UUID)
 */
export async function signBrandFollowToken(
  payload: Omit<BrandFollowTokenPayload, "exp"> & { exp?: number },
  options: { ttlSeconds?: number } = {},
): Promise<string> {
  if (payload.action !== "follow" && payload.action !== "unfollow") {
    throw new Error("brand_follow_token_action_invalid");
  }
  if (payload.brand_id.trim().length === 0 || payload.user_id.trim().length === 0) {
    throw new Error("brand_follow_token_args_required");
  }
  return await signUnsubscribeToken(
    {
      campaign_id: `follow:${payload.action}`,
      recipient_email: payload.user_id.trim(),
      brand_id: payload.brand_id.trim(),
      exp: payload.exp,
    },
    {
      secretEnvKey: secretEnvKey(),
      ttlSeconds: options.ttlSeconds ?? FOLLOW_TOKEN_TTL_SECONDS,
    },
  );
}

export async function verifyBrandFollowToken(
  token: string,
  options: { nowSeconds?: number } = {},
): Promise<BrandFollowTokenPayload> {
  const raw = await verifyUnsubscribeToken(token, {
    secretEnvKey: secretEnvKey(),
    nowSeconds: options.nowSeconds,
  });
  const match = /^follow:(follow|unfollow)$/.exec(raw.campaign_id);
  if (match === null) {
    throw new Error("brand_follow_token_payload_invalid");
  }
  const action = match[1] as BrandFollowAction;
  if (raw.recipient_email.trim().length === 0) {
    throw new Error("brand_follow_token_payload_invalid");
  }
  return {
    action,
    brand_id: raw.brand_id,
    user_id: raw.recipient_email.trim(),
    exp: raw.exp,
  };
}

export function brandFollowActionPublicUrl(token: string): string {
  const override = Deno.env.get("MINGLA_BRAND_FOLLOW_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return `${override.trim().replace(/\/$/, "")}/${token}`;
  }
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (supabaseUrl.length > 0) {
    return `${supabaseUrl}/functions/v1/brand-follow-action/${token}`;
  }
  return `https://usemingla.com/follow-action/${token}`;
}
