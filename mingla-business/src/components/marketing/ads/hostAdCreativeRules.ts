/**
 * #4238 media-buyer — the button, each app's text limits and the link tags,
 * as the Host builder shows them. Mirrors supabase/functions/_shared/
 * adHostCreative.ts (the server refuses the same). Pure.
 */
import { platformName } from "./hostAdCopy";

export const HOST_AD_CTA_OPTIONS = [
  { id: "tickets", label: "Get tickets" },
  { id: "book", label: "Book now" },
  { id: "signup", label: "Sign up" },
  { id: "learn", label: "Learn more" },
] as const;
export type HostAdCtaId = (typeof HOST_AD_CTA_OPTIONS)[number]["id"];

/** What each app's button says (Google ads have no button). */
export const HOST_AD_CTA_LABELS: Record<string, Record<HostAdCtaId, string>> = {
  meta: { tickets: "Buy tickets", book: "Book now", signup: "Sign up", learn: "Learn more" },
  tiktok: { tickets: "Get tickets now", book: "Book now", signup: "Sign up", learn: "Learn more" },
  snapchat: { tickets: "Buy Tickets", book: "Book Now", signup: "Sign Up", learn: "More" },
  reddit: { tickets: "Buy Tickets", book: "Book Now", signup: "Sign Up", learn: "Learn More" },
};

/** The default for a page: tickets for events, book for trips/experiences. */
export function hostAdDefaultCta(pageType: string | null | undefined): HostAdCtaId {
  if (pageType === "event" || pageType === "rsvp") return "tickets";
  if (pageType === "trip" || pageType === "experience") return "book";
  return "learn";
}

export function isHostAdCtaId(value: unknown): value is HostAdCtaId {
  return HOST_AD_CTA_OPTIONS.some((option) => option.id === value);
}

type Field = "primary" | "headline";

/** Hard limits (the server refuses over these) and soft ones (shown only). */
export const HOST_AD_TEXT_RULES: readonly {
  platform: string;
  field: Field;
  max: number;
  hard: boolean;
  what: string;
}[] = [
  { platform: "meta", field: "primary", max: 125, hard: false, what: "main text before “See more”" },
  { platform: "meta", field: "headline", max: 40, hard: false, what: "headline before it's cut short" },
  { platform: "tiktok", field: "primary", max: 100, hard: true, what: "ad text" },
  { platform: "snapchat", field: "headline", max: 34, hard: true, what: "headline" },
  { platform: "google", field: "headline", max: 40, hard: true, what: "headline" },
  { platform: "google", field: "primary", max: 90, hard: true, what: "description" },
  { platform: "reddit", field: "primary", max: 300, hard: true, what: "headline" },
];

const length = (text: string): number => [...text].length;

export type HostAdTextCount = {
  platform: string;
  field: Field;
  max: number;
  count: number;
  hard: boolean;
  over: boolean;
  line: string;
};

/** Per-app counters for the apps that are on. Never cuts anything. */
export function hostAdTextCounts(
  apps: readonly string[],
  copy: { primary: string; headline: string },
): HostAdTextCount[] {
  return HOST_AD_TEXT_RULES.filter((rule) => apps.includes(rule.platform)).map((rule) => {
    const count = length(copy[rule.field]);
    const over = count > rule.max;
    const app = platformName(rule.platform);
    return {
      ...rule,
      count,
      over,
      line: over
        ? rule.hard
          ? `${app}: ${count}/${rule.max}. Shorten the ${rule.what} to ${rule.max} characters, or turn ${app} off.`
          : `${app}: ${count}/${rule.max}. People see the first ${rule.max} characters, then “See more”.`
        : `${app}: ${count}/${rule.max} (${rule.what})`,
    };
  });
}

/** The first hard limit the words break, as the step's plain error. */
export function hostAdCopyError(
  apps: readonly string[],
  copy: { primary: string; headline: string },
): string | null {
  const over = hostAdTextCounts(apps, copy).find((row) => row.over && row.hard);
  return over ? over.line : null;
}

/** TikTok drops emoji from the ad text; say so instead of doing it silently. */
export function hostAdTikTokEmojiNote(apps: readonly string[], primary: string): string | null {
  return apps.includes("tiktok") && /\p{Extended_Pictographic}/u.test(primary)
    ? "TikTok doesn't show emoji in the ad text, so they are left out there."
    : null;
}

const UTM_SOURCES: Record<string, string> = {
  meta: "facebook",
  tiktok: "tiktok",
  snapchat: "snapchat",
  google: "google",
  reddit: "reddit",
};

/** Same slug rule as the server (adHostCreative.hostAdUtmSlug). */
export function hostAdUtmSlug(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "");
  return slug || "mingla-ad";
}

/** The read-only tracking tags each app's link carries. */
export function hostAdUtmLines(apps: readonly string[], adName: string): string[] {
  const slug = hostAdUtmSlug(adName);
  return apps.map(
    (app) => `${platformName(app)}: utm_source=${UTM_SOURCES[app] ?? app}&utm_medium=paid_social&utm_campaign=${slug}`,
  );
}
