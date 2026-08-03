/** Issue #1447 — secure RSVP credential metadata + PDF recovery.
 * Authenticated owners use their JWT. Anonymous link guests use a high-entropy
 * fragment token whose SHA-256 hash is the only persisted value.
 *
 * Representation contract:
 *   Accept: application/json -> authorized canonical credential metadata
 *   default / Accept: application/pdf -> the shared renderer's PDF bytes
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildRsvpPassPdf } from "../_shared/ticketPdf.ts";
import { constantTimeHexEqual, sha256Hex } from "../_shared/rsvpPass.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const ipHits = new Map<string, { count: number; resetAt: number }>();
const rateLimited = (ip: string): boolean => {
  const now = Date.now();
  const current = ipHits.get(ip);
  if (!current || current.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
};
const reply = (status: number, body: Record<string, unknown>): Response =>
  new Response(
    JSON.stringify(body),
    { status, headers: { ...cors, "Content-Type": "application/json" } },
  );
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

interface PassCredential {
  entityType: "primary" | "guest";
  entityId: string;
  displayName: string;
  qrCode: string;
  pdfFetchRef: string;
}

const credential = (
  entityType: "primary" | "guest",
  entityId: string,
  displayName: string,
  qrCode: string,
): PassCredential => ({
  entityType,
  entityId,
  displayName,
  qrCode,
  pdfFetchRef: entityId,
});

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (rateLimited(ip)) {
    console.warn(JSON.stringify({ event: "rsvp_pass_recovery_rate_limited" }));
    return reply(429, { error: "rate_limited" });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply(500, { error: "server_misconfigured" });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const entityId = body.entityId;
  const entityType = body.entityType;
  const recoveryToken = typeof body.recoveryToken === "string"
    ? body.recoveryToken
    : null;
  if (!uuid(entityId) || (entityType !== "primary" && entityType !== "guest")) {
    return reply(400, { error: "entity_required" });
  }
  const wantsMetadata = req.headers.get("accept")?.toLowerCase().includes(
    "application/json",
  ) ?? false;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  let userId: string | null = null;
  const bearer = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (bearer) {
    const { data } = await admin.auth.getUser(bearer);
    userId = data.user?.id ?? null;
  }

  let role: "primary" | "guest" = "primary";
  let ownerUserId: string | null = null;
  let parentOwnerUserId: string | null = null;
  let name = "Guest";
  let qrCode: string | null = null;
  let tokenHash: string | null = null;
  const { data: primary } = await admin.from("event_rsvps")
    .select(
      "id,user_id,guest_name,qr_code,pass_recovery_token_hash,event_id,rsvp_status,approval_status",
    )
    .eq("id", entityId).maybeSingle();
  let state = primary as Record<string, unknown> | null;
  if (primary) {
    if (entityType !== "primary") return reply(404, { error: "not_found" });
    ownerUserId = primary.user_id;
    name = primary.guest_name ?? "Guest";
    qrCode = primary.qr_code;
    tokenHash = primary.pass_recovery_token_hash;
  } else {
    if (entityType !== "guest") return reply(404, { error: "not_found" });
    const { data: guest } = await admin.from("event_rsvp_guests")
      .select(
        "id,rsvp_id,matched_user_id,name,qr_code,pass_recovery_token_hash",
      )
      .eq("id", entityId).maybeSingle();
    if (!guest) return reply(404, { error: "not_found" });
    const { data: parent } = await admin.from("event_rsvps")
      .select("id,user_id,event_id,rsvp_status,approval_status")
      .eq("id", guest.rsvp_id).maybeSingle();
    if (!parent) return reply(404, { error: "not_found" });
    role = "guest";
    ownerUserId = guest.matched_user_id;
    parentOwnerUserId = parent.user_id;
    name = guest.name ?? "Guest";
    qrCode = guest.qr_code;
    tokenHash = guest.pass_recovery_token_hash;
    state = parent as Record<string, unknown>;
  }
  const authenticatedEntityOwner = userId !== null && ownerUserId === userId;
  const authenticatedPartyOwner = userId !== null && parentOwnerUserId === userId;
  let recoveryAuthorized = false;
  if (recoveryToken && tokenHash) {
    recoveryAuthorized = constantTimeHexEqual(
      await sha256Hex(recoveryToken),
      tokenHash,
    );
  }
  if (!authenticatedEntityOwner && !authenticatedPartyOwner && !recoveryAuthorized) {
    console.warn(
      JSON.stringify({ event: "rsvp_pass_recovery_denied", entityType }),
    );
    return reply(403, { error: "not_owner_or_bad_recovery_token" });
  }
  if (
    state?.rsvp_status !== "going" || state?.approval_status !== "approved" ||
    !qrCode
  ) {
    return reply(409, { error: "not_pass_eligible" });
  }
  const eventId = String(state.event_id);
  const { data: event } = await admin.from("events")
    .select("id,title,brand_id,location_text,timezone,status,deleted_at")
    .eq("id", eventId).maybeSingle();
  if (!event || event.deleted_at !== null || event.status === "cancelled") {
    return reply(409, { error: "not_pass_eligible" });
  }

  if (wantsMetadata) {
    // Metadata negotiation is exact-entity only. Explorer's whole-party view
    // uses fetch_user_rsvp_party_passes, whose auth.uid() policy is canonical.
    return reply(200, {
      credentials: [credential(role, entityId, name, qrCode)],
    });
  }

  const { data: brand } = await admin.from("brands").select("name")
    .eq("id", event.brand_id).maybeSingle();
  const { data: date } = await admin.from("event_dates")
    .select("start_at,end_at").eq("event_id", eventId).eq("is_master", true)
    .maybeSingle();
  let dateLine: string | null = null;
  if (date?.start_at) {
    try {
      dateLine = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: event.timezone ?? "UTC",
        timeZoneName: "short",
      }).format(new Date(date.start_at));
    } catch {
      dateLine = null;
    }
  }
  const pdf = await buildRsvpPassPdf({
    eventTitle: event.title ?? "your event",
    dateLine,
    venueLine: event.location_text,
    brandName: brand?.name ?? "Mingla",
    attendeeName: name,
    qrPayload: qrCode,
  });
  const binary = atob(pdf.contentBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const filename = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
