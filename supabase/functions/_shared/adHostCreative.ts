/**
 * #4238 media-buyer — the Host's button, text limits and link tags, one
 * owner for ad-plan (checks before money), admin-ad-create-campaign (what each
 * app receives) and Ari. Pure.
 *
 * MINGLA-INVARIANT: I-4238-NO-SILENT-COPY-CUT | issue #4238 | A Host plan whose words are longer than an app allows is refused before any money is set aside (copy_too_long:<app>:<field>); Host payloads never cut text to fit. Enforced by supabase/functions/_shared/__tests__/issue_4238_mb_creative.test.ts.
 */

import type { Platform } from "./adChannelCore.ts";
import { REDDIT_CTA_ENUM } from "./reddit.ts";
import { SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST } from "./snapchat.ts";

/** Seth's decision: four buttons every app (but Google Search) has. */
export const HOST_AD_CTAS = ["tickets", "book", "signup", "learn"] as const;
export type HostAdCta = (typeof HOST_AD_CTAS)[number];

/**
 * Each app's own value. Snapchat and Reddit values are in their pinned
 * allowlists; Meta and TikTok follow the repo's proven maps (BOOK_NOW on Meta
 * and the TikTok strings are not verified against a live create).
 * Google search/demand-gen ads have no button.
 */
export const HOST_AD_CTA_BY_PLATFORM: Record<
  Exclude<Platform, "google">,
  Record<HostAdCta, string>
> = {
  meta: {
    tickets: "BUY_TICKETS",
    book: "BOOK_NOW",
    signup: "SIGN_UP",
    learn: "LEARN_MORE",
  },
  tiktok: {
    tickets: "Get ticket now",
    book: "Book now",
    signup: "Sign up",
    learn: "Learn more",
  },
  snapchat: {
    tickets: "BUY_TICKETS",
    book: "BOOK_NOW",
    signup: "SIGN_UP",
    learn: "MORE",
  },
  reddit: {
    tickets: "Buy Tickets",
    book: "Book Now",
    signup: "Sign Up",
    learn: "Learn More",
  },
};

export function isHostAdCta(value: unknown): value is HostAdCta {
  return typeof value === "string" &&
    (HOST_AD_CTAS as readonly string[]).includes(value);
}

/** The app's own button value, or null for Google (no button). */
export function hostCtaForPlatform(
  platform: Platform,
  cta: HostAdCta,
): string | null {
  if (platform === "google") return null;
  return HOST_AD_CTA_BY_PLATFORM[platform][cta];
}

/** Every mapped value is one the app's own allowlist accepts (where pinned). */
export function hostCtaAllowlisted(): boolean {
  return HOST_AD_CTAS.every((cta) =>
    SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST.includes(
      HOST_AD_CTA_BY_PLATFORM.snapchat[cta],
    ) &&
    REDDIT_CTA_ENUM.includes(HOST_AD_CTA_BY_PLATFORM.reddit[cta])
  );
}

/**
 * Hard limits per app and field (characters). Soft limits (Meta's 125
 * before "See more", 40 headline) are shown in the builder, not refused.
 * Google Host ads are Demand Gen video: headline 40, long headline and
 * description 90.
 */
export const HOST_AD_TEXT_LIMITS: Record<
  Platform,
  Partial<Record<"primary" | "headline", number>>
> = {
  meta: { headline: 255 },
  tiktok: { primary: 100 },
  snapchat: { headline: 34 },
  google: { headline: 40, primary: 90 },
  reddit: { primary: 300 },
};

/** The first app/field over its hard limit, or null. */
export function hostCopyTooLong(
  platforms: readonly Platform[],
  copy: { primary?: unknown; headline?: unknown },
): { platform: Platform; field: "primary" | "headline"; max: number } | null {
  for (const platform of platforms) {
    const limits = HOST_AD_TEXT_LIMITS[platform];
    for (const field of ["primary", "headline"] as const) {
      const max = limits[field];
      const text = typeof copy[field] === "string" ? String(copy[field]) : "";
      if (max !== undefined && [...text].length > max) {
        return { platform, field, max };
      }
    }
  }
  return null;
}

/** "Sunday Rooftop Sessions!" → "sunday-rooftop-sessions" (max 60). */
export function hostAdUtmSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "");
  return slug || "mingla-ad";
}

/** utm_source per app (the names analytics tools already know). */
export const HOST_AD_UTM_SOURCES: Record<Platform, string> = {
  meta: "facebook",
  tiktok: "tiktok",
  snapchat: "snapchat",
  google: "google",
  reddit: "reddit",
};

/**
 * Seth's decision: standard tags on every Host landing link, read-only.
 * Mingla's own click ids (mc_id and the like) stay alongside, so Mingla's
 * results keep matching sales to the ad.
 */
export function hostAdUtmTags(
  platform: Platform,
  adName: string,
): { utm_source: string; utm_medium: "paid_social"; utm_campaign: string } {
  return {
    utm_source: HOST_AD_UTM_SOURCES[platform],
    utm_medium: "paid_social",
    utm_campaign: hostAdUtmSlug(adName),
  };
}

/** The tags as a query string (no leading "?"). */
export function hostAdUtmQuery(platform: Platform, adName: string): string {
  const tags = hostAdUtmTags(platform, adName);
  return `utm_source=${tags.utm_source}&utm_medium=${tags.utm_medium}&utm_campaign=${
    encodeURIComponent(tags.utm_campaign)
  }`;
}
