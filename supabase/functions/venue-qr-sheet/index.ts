// Issue #1789 (#1767 Phase 1) — venue QR print sheet (SPEC #1788 P-27, DESIGN D-5).
//
// POST { brandId, venueId?, spotIds?, layout: "bulk" | "single" } with a
// REQUIRED Bearer, rank >= event_manager for the brand. Renders server-side on
// the shipped ticket-PDF rail (pdf-lib + qrcode via esm.sh, WinAnsi-sanitised so
// a render can never hard-fail), writes into the PRIVATE `venue-qr-sheets`
// bucket, and returns a 60-second signed URL — the `ticket-pdf-fetch` posture.
//
// Client print is REJECTED: no expo-print dependency exists anywhere in the repo
// and one was deliberately avoided before. Bulk (every ACTIVE spot in scope) and
// single-spot re-print run the SAME builder, so a re-print can never drift from
// the sheet it came off.
//
// Inactive spots are never printed. A stay room whose serving venue has not been
// re-pointed lands `is_active = false` with a to-do (P-7c) precisely so a dead
// link cannot reach a laminate.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  buildVenueQrSheetPdf,
  type VenueQrSpotCard,
} from "../_shared/ticketPdf.ts";
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
import { qrSpotUrl } from "./qrSpotUrl.ts";

const MINGLA_LOGO_URL = minglaLogoUrl();
const SIGNED_URL_TTL_SECONDS = 60;
const STORAGE_BUCKET = "venue-qr-sheets";
const RANK_EVENT_MANAGER = 40;
// A single render must stay inside the shared 5 MB PDF cap and inside the edge
// CPU budget. 200 cards is far beyond any real floor plan; beyond it the
// operator is told to filter by venue rather than being handed a timeout.
const MAX_SPOTS_PER_SHEET = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

interface SpotRow {
  id: string;
  label: string;
  kind: string;
  code: string;
  is_active: boolean;
  venue_id: string;
  serving_venue_id: string;
  serving_menu_id: string | null;
  sort_order: number;
}

serve(wrapEdgeHandler("venue-qr-sheet", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // Bearer REQUIRED in-code. verify_jwt stays false at the gateway so the
  // 401 body is ours, but an anonymous caller never reaches a spot code.
  const callerUserId = await userIdFromAuthHeader(req);
  if (callerUserId === null) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const brandId = (body as Record<string, unknown>).brandId;
  const venueId = (body as Record<string, unknown>).venueId;
  const spotIds = (body as Record<string, unknown>).spotIds;
  const layout = (body as Record<string, unknown>).layout;

  if (!isUuid(brandId)) {
    return jsonResponse({ error: "bad_request", field: "brandId" }, 400);
  }
  if (layout !== "bulk" && layout !== "single") {
    return jsonResponse({ error: "bad_request", field: "layout" }, 400);
  }
  if (venueId !== undefined && venueId !== null && !isUuid(venueId)) {
    return jsonResponse({ error: "bad_request", field: "venueId" }, 400);
  }
  let requestedSpotIds: string[] | null = null;
  if (spotIds !== undefined && spotIds !== null) {
    if (!Array.isArray(spotIds) || !spotIds.every(isUuid)) {
      return jsonResponse({ error: "bad_request", field: "spotIds" }, 400);
    }
    requestedSpotIds = spotIds as string[];
  }
  if (layout === "single" && (requestedSpotIds === null || requestedSpotIds.length !== 1)) {
    return jsonResponse({ error: "bad_request", field: "spotIds" }, 400);
  }

  const supabase = serviceClient();

  // Manager-plus for THIS brand, before a single spot code is read.
  const { data: rankRow, error: rankError } = await supabase.rpc(
    "biz_brand_effective_rank",
    { p_brand_id: brandId, p_user_id: callerUserId },
  );
  if (rankError) {
    console.error("[venue-qr-sheet] rank lookup failed:", rankError.message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (Number(rankRow ?? 0) < RANK_EVENT_MANAGER) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }

  const { data: brandRow, error: brandError } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandError) {
    console.error("[venue-qr-sheet] brand lookup failed:", brandError.message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (brandRow === null) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  // ACTIVE spots only. Never print a dead link.
  let spotQuery = supabase
    .from("qr_spots")
    .select(
      "id, label, kind, code, is_active, venue_id, serving_venue_id, serving_menu_id, sort_order",
    )
    .eq("brand_id", brandId)
    .eq("is_active", true);
  if (isUuid(venueId)) {
    spotQuery = spotQuery.eq("venue_id", venueId);
  }
  if (requestedSpotIds !== null) {
    spotQuery = spotQuery.in("id", requestedSpotIds);
  }
  const { data: spotRows, error: spotError } = await spotQuery
    .order("venue_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (spotError) {
    console.error("[venue-qr-sheet] spot lookup failed:", spotError.message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  const spots = (spotRows ?? []) as SpotRow[];
  if (spots.length === 0) {
    return jsonResponse({ error: "no_printable_spots" }, 409);
  }
  if (spots.length > MAX_SPOTS_PER_SHEET) {
    return jsonResponse(
      { error: "too_many_spots", limit: MAX_SPOTS_PER_SHEET },
      409,
    );
  }

  // Venue names + slugs for both the physical home and the serving venue.
  const venueIds = Array.from(
    new Set(spots.flatMap((s) => [s.venue_id, s.serving_venue_id])),
  );
  const { data: venueRows, error: venueError } = await supabase
    .from("venue_listings")
    .select("id, name, slug, brand_id")
    .in("id", venueIds)
    .eq("brand_id", brandId);
  if (venueError) {
    console.error("[venue-qr-sheet] venue lookup failed:", venueError.message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  const venuesById = new Map<string, { name: string | null; slug: string }>();
  for (const v of (venueRows ?? []) as Array<
    { id: string; name: string | null; slug: string }
  >) {
    venuesById.set(v.id, { name: v.name, slug: v.slug });
  }

  const menuIds = Array.from(
    new Set(
      spots.map((s) => s.serving_menu_id).filter((v): v is string => v !== null),
    ),
  );
  const menuNameById = new Map<string, string>();
  if (menuIds.length > 0) {
    const { data: menuRows } = await supabase
      .from("menus")
      .select("id, name")
      .in("id", menuIds)
      .eq("brand_id", brandId);
    for (const m of (menuRows ?? []) as Array<{ id: string; name: string }>) {
      menuNameById.set(m.id, m.name);
    }
  }

  const cards: VenueQrSpotCard[] = [];
  for (const spot of spots) {
    const home = venuesById.get(spot.venue_id);
    const serving = venuesById.get(spot.serving_venue_id);
    if (serving === undefined) {
      // A serving venue outside the brand is impossible (the P-8 trigger), so
      // this can only be a deleted row. Skip rather than print a dead card.
      continue;
    }
    const servingParts: string[] = [];
    if (spot.serving_venue_id !== spot.venue_id) {
      servingParts.push(`Serving: ${serving.name ?? "the kitchen"}`);
    }
    const menuName = spot.serving_menu_id === null
      ? null
      : menuNameById.get(spot.serving_menu_id) ?? null;
    if (menuName !== null) servingParts.push(menuName);
    cards.push({
      venueName: home?.name ?? serving.name ?? brandRow.name ?? "",
      spotLabel: spot.label,
      servingLine: servingParts.length > 0 ? servingParts.join(" · ") : null,
      url: qrSpotUrl({
        brandSlug: brandRow.slug,
        servingVenueSlug: serving.slug,
        code: spot.code,
      }),
    });
  }
  if (cards.length === 0) {
    return jsonResponse({ error: "no_printable_spots" }, 409);
  }

  let pdf;
  try {
    pdf = await buildVenueQrSheetPdf({
      brandName: brandRow.name ?? "",
      spots: cards,
      logoUrl: MINGLA_LOGO_URL ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[venue-qr-sheet] render failed brand=${brandId}: ${message}`);
    return jsonResponse({ error: "pdf_render_failed" }, 502);
  }

  const pdfBytes = Uint8Array.from(
    atob(pdf.contentBase64),
    (c) => c.charCodeAt(0),
  );
  const objectPath = `venue-qr/${brandId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    console.error("[venue-qr-sheet] upload failed:", uploadError.message);
    return jsonResponse({ error: "pdf_render_failed" }, 502);
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signedData?.signedUrl) {
    console.error(
      "[venue-qr-sheet] sign failed:",
      signError?.message ?? "no_signed_url",
    );
    return jsonResponse({ error: "pdf_render_failed" }, 502);
  }

  // Print state is a fact about the spot, so it is recorded on the spot.
  const printedIds = spots.map((s) => s.id);
  const { error: stampError } = await supabase
    .from("qr_spots")
    .update({ last_printed_at: new Date().toISOString() })
    .in("id", printedIds);
  if (stampError) {
    // The sheet EXISTS and is downloadable; only the bookkeeping failed. Never
    // withhold a rendered sheet over a stamp.
    console.warn(
      `[venue-qr-sheet] last_printed_at stamp failed brand=${brandId}: ${stampError.message}`,
    );
  }

  return jsonResponse({
    signedUrl: signedData.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000)
      .toISOString(),
    filename: pdf.filename,
    spotCount: pdf.pageCount,
  });
}));
