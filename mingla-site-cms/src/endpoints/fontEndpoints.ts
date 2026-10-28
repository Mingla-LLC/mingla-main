import type { Endpoint, PayloadRequest } from "payload";
import { searchCatalogFonts, findCatalogFont, type FontCategory } from "../contracts/generated/fontCatalog.ts";
import { isFontFamilyName, isFontWeight, nearestWeight } from "../contracts/generated/fontSlots.ts";
import { facesForSlot, ttfPreviewFace } from "../lib/fontAssets";
import { payloadFontPipeline, payloadTtfPipeline, readFontFile } from "../lib/fontAssetStore";
import { sitesJsonResponse } from "../lib/http";
import { observeCmsEndpoint } from "../lib/observability";
import { requireAuthenticatedStudioRequest } from "../lib/studioRequestAuth";

/*
 * #2829 AD-3 / S-10 — Studio's font picker: search the catalogue and preview
 * a family. Both need a Studio session (rank ≥ 20, enforced by the session
 * strategy) and previews are rate limited per user, so this is never an open
 * proxy to Google: a preview serves only a file the pipeline itself fetched,
 * validated and stored under its digest.
 */

const PREVIEW_LIMIT_PER_MINUTE = 60;
const previewHits = new Map<string, number[]>();
const CATEGORIES = new Set(["sans-serif", "serif", "display", "handwriting", "monospace"]);

export function allowPreview(userId: string, now = Date.now()): boolean {
  const recent = (previewHits.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= PREVIEW_LIMIT_PER_MINUTE) {
    previewHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  previewHits.set(userId, recent);
  return true;
}

function failure(code: string, status: number) {
  return sitesJsonResponse({ ok: false, error: { code } }, status);
}

async function search(req: PayloadRequest): Promise<Response> {
  try {
    await requireAuthenticatedStudioRequest(req);
    const url = new URL(req.url || "http://local");
    const query = (url.searchParams.get("q") ?? "").slice(0, 64);
    const categoryParam = url.searchParams.get("category");
    const category = categoryParam && CATEGORIES.has(categoryParam) ? (categoryParam as FontCategory) : undefined;
    const fonts = searchCatalogFonts(query, { category, limit: 40 });
    return sitesJsonResponse({
      ok: true,
      data: fonts.map((font) => ({ family: font.family, category: font.category, weights: font.weights })),
    });
  } catch (error) {
    return failure(error instanceof Error && error.message === "SESSION_EXPIRED" ? "SESSION_EXPIRED" : "FORBIDDEN", 403);
  }
}

async function preview(req: PayloadRequest): Promise<Response> {
  let session;
  try {
    session = (await requireAuthenticatedStudioRequest(req)).session;
  } catch {
    return failure("FORBIDDEN", 403);
  }
  if (!allowPreview(String(session.user_id))) return failure("RATE_LIMITED", 429);
  const url = new URL(req.url || "http://local");
  const family = url.searchParams.get("family") ?? "";
  const weight = Number(url.searchParams.get("weight") ?? "400");
  const format = url.searchParams.get("format") ?? "woff2";
  const font = isFontFamilyName(family) ? findCatalogFont(family) : null;
  if (!font || !isFontWeight(weight)) return failure("VALIDATION_FAILED", 400);
  if (format !== "woff2" && format !== "ttf") return failure("VALIDATION_FAILED", 400);
  // #2829 W11 (A17) — TrueType for native font loaders, from the same
  // pipeline (exact hosts, signature and size checked, content-addressed).
  if (format === "ttf") {
    try {
      const face = await ttfPreviewFace(payloadTtfPipeline(req), family, nearestWeight(weight, font.weights));
      const bytes = await readFontFile(face.digest, "ttf");
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { "content-type": "font/ttf", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
      });
    } catch {
      return failure("FONT_UNAVAILABLE", 502);
    }
  }
  try {
    const faces = await facesForSlot(
      payloadFontPipeline(req),
      { family, weights: [nearestWeight(weight, font.weights)], italic: false },
      ["latin"],
    );
    const face = faces.find((candidate) => candidate.style === "normal") ?? faces[0];
    if (!face) return failure("NOT_FOUND", 404);
    const bytes = await readFontFile(face.digest);
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "font/woff2",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return failure("FONT_UNAVAILABLE", 502);
  }
}

export const fontEndpoints: Endpoint[] = [
  {
    path: "/mingla/fonts/search",
    method: "get",
    handler: observeCmsEndpoint("/mingla/fonts/search", "studio_to_cms", search),
  },
  {
    path: "/mingla/fonts/preview",
    method: "get",
    handler: observeCmsEndpoint("/mingla/fonts/preview", "studio_to_cms", preview),
  },
];
