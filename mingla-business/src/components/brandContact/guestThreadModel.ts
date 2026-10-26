/**
 * #4111 — what the signed-out guest's thread page (/m/{token}) shows, decided
 * from the server's answer. PURE (no React) so every state is unit-tested:
 *
 *   loading   first fetch in flight
 *   error     the request failed (network / server) → Try again
 *   invalid   unknown token (404)
 *   expired   token past its 90 days (410) → "Email me a new link"
 *   thread    the conversation: resolved banner when resolved, the
 *             "Get replies instantly" app card, the pinned composer
 */
import type { GuestThread, GuestThreadResult } from "../../services/publicEnquiryService";

export type GuestThreadLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | GuestThreadResult;

export interface GuestThreadBubble {
  key: string;
  mine: boolean;
  /** "You · Sun" / "Ayo at Ctrl · 6:32" */
  meta: string;
  body: string;
  system: boolean;
}

export type GuestThreadModel =
  | { view: "loading" }
  | { view: "error"; title: string; body: string }
  | { view: "invalid"; title: string; body: string }
  | { view: "expired"; title: string; body: string }
  | {
      view: "thread";
      brandName: string;
      brandSlug: string | null;
      logoUrl: string | null;
      accent: string | null;
      subtitle: string | null;
      bubbles: GuestThreadBubble[];
      resolvedBanner: string | null;
      appCard: { title: string; body: string; cta: string };
      composerPlaceholder: string;
    };

export const RESOLVED_BANNER = (brandName: string): string =>
  `${brandName} marked this as resolved. Write again to reopen it.`;

/** "6:32pm" today, "Sun" this week, "12 Oct" before that. */
export const guestTimeLabel = (iso: string | null, nowMs: number = Date.now()): string => {
  if (iso === null) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const now = new Date(nowMs);
  try {
    if (date.toDateString() === now.toDateString()) {
      return date
        .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/\s/g, "")
        .toLowerCase();
    }
    if (nowMs - ms < 6 * 24 * 60 * 60 * 1000 && ms <= nowMs) {
      return date.toLocaleDateString("en-GB", { weekday: "short" });
    }
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
};

const bubblesFor = (thread: GuestThread, nowMs: number): GuestThreadBubble[] =>
  thread.messages
    .filter((m) => m.body.trim().length > 0)
    .map((m, index) => {
      const when = guestTimeLabel(m.at, nowMs);
      const who = m.who === "guest" ? "You" : m.display.trim().length > 0 ? m.display : thread.brand.name;
      return {
        key: `${m.at ?? "na"}-${index}`,
        mine: m.who === "guest",
        meta: when.length > 0 ? `${who} · ${when}` : who,
        body: m.body,
        system: m.who === "system",
      };
    });

export const guestThreadModel = (load: GuestThreadLoad, nowMs: number = Date.now()): GuestThreadModel => {
  switch (load.kind) {
    case "loading":
      return { view: "loading" };
    case "error":
      return {
        view: "error",
        title: "Couldn't load this conversation",
        body: "Check your connection and try again.",
      };
    case "invalid":
      return {
        view: "invalid",
        title: "This link isn't valid",
        body: "Open the newest email about this conversation, or message the brand again from their page.",
      };
    case "expired":
      return {
        view: "expired",
        title: "This link has expired",
        body: "Links stay open for 90 days after the last message. We can email you a new one.",
      };
    case "ok": {
      const { thread } = load;
      return {
        view: "thread",
        brandName: thread.brand.name,
        brandSlug: thread.brand.slug,
        logoUrl: thread.brand.logoUrl,
        accent: thread.brand.accent,
        subtitle: thread.topicLabel,
        bubbles: bubblesFor(thread, nowMs),
        resolvedBanner: thread.status === "resolved" ? RESOLVED_BANNER(thread.brand.name) : null,
        appCard: {
          title: "Get replies instantly",
          body: "Continue in the Mingla app.",
          cta: "Get the app",
        },
        composerPlaceholder: "Write a reply…",
      };
    }
    default: {
      const never: never = load;
      return never;
    }
  }
};

/** A guest token as the server issues them (32 random bytes, base64url). */
export const isGuestThreadToken = (raw: unknown): raw is string =>
  typeof raw === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(raw);
