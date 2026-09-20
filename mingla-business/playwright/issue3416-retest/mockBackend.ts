/**
 * PR #3416 independent retest — a fully local Supabase stand-in for the
 * exported business web app (EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399).
 * Every request that is not to the local static server or this mock is
 * ABORTED and recorded, so the run cannot touch production.
 */
import type { BrowserContext, Route } from "@playwright/test";

export const APP = "http://127.0.0.1:8416";
export const API = "http://127.0.0.1:54399";
export const BRAND_SLUG = "lantern";

const DAY = 24 * 60 * 60 * 1000;

export const eventRow = (id: string, slug: string, title: string, startInMs = 11 * DAY + 3 * 60 * 60 * 1000) => {
  const start = new Date(Date.now() + startInMs).toISOString();
  const end = new Date(Date.now() + startInMs + 3 * 60 * 60 * 1000).toISOString();
  return {
    id, brand_id: "brand-3416", brand_slug: BRAND_SLUG, brand_name: "Lantern Room",
    brand_description: null, brand_profile_photo_url: null, brand_display_attendee_count: true,
    brand_address: null, brand_cover_media_url: null, brand_theme_color: null, brand_theme_font: null, brand_theme_animation: null,
    title, description: "A free night for the block. ".repeat(160).trim(), slug, event_type: "rsvp",
    rsvp_discoverable: true, rsvp_capacity: 80, rsvp_allow_plus_ones: false, rsvp_plus_ones_max: 0,
    rsvp_waitlist_enabled: true, rsvp_approval_mode: "auto", rsvp_going_count: 0,
    rsvp_contribution_enabled: true, rsvp_contribution_suggested_cents: 1000, rsvp_contribution_min_cents: 500,
    party_types: [], vibe_tags: [], music_genres: [], city_geo: null,
    location_text: "61 Wythe Avenue, Brooklyn, NY, United States", location_geo: null,
    online_url: null, is_online: false, is_recurring: false, is_multi_date: false, recurrence_rules: null,
    cover_media_url: null, cover_media_type: null, cover_media_gallery: [], cover_media_provider: null,
    cover_media_source_url: null, cover_media_credit: null, cover_media_credit_url: null, cover_media_alt: null,
    currency: "USD", visibility: "public", show_on_discover: true, status: "scheduled",
    published_at: new Date(Date.now() - DAY).toISOString(), timezone: "America/New_York",
    created_at: new Date(Date.now() - 2 * DAY).toISOString(), updated_at: new Date(Date.now() - DAY).toISOString(),
    public_theme: null, theme_color_override: null, theme_font_override: null, theme_animation_override: null,
    master_start_at: start, master_end_at: end, master_timezone: "America/New_York", master_event_date_id: `${id}-date`,
    display_price_cents: null, pricing_currency: null,
  };
};

export type PassMode =
  | { kind: "ok" }
  | { kind: "status"; status: number; delayMs?: number }
  | { kind: "network" }
  | { kind: "hang" };

export interface Backend {
  events: Record<string, ReturnType<typeof eventRow>>;
  passMode: PassMode;
  /** QR/recovery the next accepted Going reply returns. */
  nextQr: string;
  signedIn: boolean;
  calls: { url: string; method: string; body: string | null; at: number }[];
  passAnsweredAt: number[];
  blocked: string[];
}

export const createBackend = (): Backend => ({
  events: {
    "night-a": eventRow("00000000-0000-4000-8000-00000000000a", "night-a", "Neighbors Night A"),
    "night-b": eventRow("00000000-0000-4000-8000-00000000000b", "night-b", "Different Night B"),
  },
  passMode: { kind: "ok" },
  nextQr: "mingla:v1:rsvp:retest-qr-1",
  signedIn: false,
  calls: [],
  passAnsweredAt: [],
  blocked: [],
});

const cors = {
  "Access-Control-Allow-Origin": APP,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Expose-Headers": "*",
};
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const session = (userId: string) => ({
  access_token: `local-${userId}`, token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${userId}`,
  user: { id: userId, aud: "authenticated", role: "authenticated", email: `${userId}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
});

export const install = async (context: BrowserContext, backend: Backend): Promise<void> => {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP) return route.fallback();
    if (url.origin !== API) {
      backend.blocked.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = request.postData();
    backend.calls.push({ url: url.pathname + url.search, method: request.method(), body, at: Date.now() });
    const p = url.pathname;

    if (p.startsWith("/auth/v1/user")) {
      const auth = request.headers()["authorization"] ?? "";
      const id = auth.replace("Bearer local-", "");
      return auth.startsWith("Bearer local-") ? json(route, 200, session(id).user) : json(route, 401, { msg: "no" });
    }
    if (p.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, headers: cors });
    if (p.startsWith("/auth/v1/")) return json(route, 400, { error: "unsupported_in_retest" });

    if (p === "/rest/v1/rpc/pg_direct_event_checkout_bundle") return json(route, 200, null);
    if (p === "/rest/v1/business_public_events_view") {
      const slug = url.searchParams.get("slug")?.replace(/^eq\./, "") ?? "";
      const row = backend.events[slug] ?? null;
      const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      if (single) return row === null ? json(route, 406, { code: "PGRST116" }) : json(route, 200, row);
      return json(route, 200, row === null ? [] : [row]);
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(route, 200, null);
    if (p.startsWith("/rest/v1/")) return json(route, 200, []);

    if (p === "/functions/v1/public-submit-rsvp") {
      const input = JSON.parse(body ?? "{}") as { eventId: string; rsvpStatus: string; guestName?: string };
      const rsvpId = `rsvp-${backend.nextQr.split(":").pop()}`;
      const going = input.rsvpStatus === "going";
      return json(route, 200, {
        status: input.rsvpStatus, approvalStatus: "approved", rsvpId, confirmationToken: null,
        acknowledgement: going ? "accepted" : input.rsvpStatus,
        credentials: going ? [{ entityType: "primary", entityId: rsvpId, displayName: input.guestName ?? "Signed-in guest", qrCode: backend.nextQr, pdfFetchRef: rsvpId }] : [],
        // Mirrors public-submit-rsvp: recovery tokens only for anonymous callers.
        anonymousRecovery: going && !backend.signedIn ? [{ entityType: "primary", entityId: rsvpId, recoveryToken: `token-${rsvpId}`, recoveryUrl: null }] : [],
      });
    }
    if (p === "/functions/v1/rsvp-pass-fetch") {
      const mode = backend.passMode;
      if (mode.kind === "hang") return; // never answers
      if (mode.kind === "network") return route.abort("internetdisconnected");
      if (mode.kind === "status") {
        if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
        backend.passAnsweredAt.push(Date.now());
        return json(route, mode.status, { error: mode.status === 409 ? "not_pass_eligible" : "not_owner_or_bad_recovery_token" });
      }
      const input = JSON.parse(body ?? "{}") as { entityType: string; entityId: string };
      return json(route, 200, { credentials: [{ entityType: input.entityType, entityId: input.entityId, displayName: "Guest", qrCode: backend.nextQr, pdfFetchRef: input.entityId }] });
    }
    if (p === "/functions/v1/rsvp-contribution-create") {
      const slug = Object.values(backend.events).find((e) => body?.includes(e.id))?.slug ?? "night-a";
      return json(route, 200, {
        kind: "requires_web_redirect", contributionId: "contrib-3416",
        hostedCheckoutUrl: `${APP}/__fake-stripe?next=${encodeURIComponent(`/e/${BRAND_SLUG}/${slug}?contribution=paid`)}`,
        amountCents: 1000, buyerTotalCents: 1000, currency: "USD",
      });
    }
    if (p.startsWith("/functions/v1/")) return json(route, 404, { error: "not_mocked" });
    return json(route, 404, { error: "not_mocked" });
  });
};

export const passFetchCalls = (backend: Backend) => backend.calls.filter((c) => c.url.startsWith("/functions/v1/rsvp-pass-fetch"));
export const submitCalls = (backend: Backend) => backend.calls.filter((c) => c.url.startsWith("/functions/v1/public-submit-rsvp"));
