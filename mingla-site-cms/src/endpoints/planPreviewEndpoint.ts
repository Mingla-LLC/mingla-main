import type { Endpoint, PayloadRequest } from "payload";
import { sitesJsonResponse } from "../lib/http";
import { observeCmsEndpoint } from "../lib/observability";
import { verifyCoreRequest } from "../lib/gateway";
import { cmsConfig } from "../lib/config";
import { deleteObject, listObjects, readObject, writeObject } from "../lib/objectStore";
import { parsePlanPreviewBody, runPlanPreview, type PlanPreviewStore } from "../lib/planPreview";
import { PLAN_PREVIEW_HOST } from "../contracts/generated/planPreview.ts";

/*
 * #4453 milestone 10 — Core's signed plan-preview call (brand-site-control
 * POST /v1/brands/<id>/plan-previews, behind SITES_PLAN_PREVIEW). Studio
 * composes and builds in memory and answers with three `plan-previews/` keys.
 * No Payload document is created or changed here.
 */

function failure(code: string, status: number): Response {
  return sitesJsonResponse({ ok: false, error: { code } }, status);
}

/** The reserved preview host; a loopback runtime in local mode. */
export function planPreviewOrigin(publicRuntimeOrigin: string): string {
  try {
    const url = new URL(publicRuntimeOrigin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost")) return url.origin;
  } catch {
    // Not a URL: production rules.
  }
  return `https://${PLAN_PREVIEW_HOST}`;
}

function objectStore(): PlanPreviewStore {
  const bucket = cmsConfig().artifactBucket;
  return {
    write: (key, bytes) => writeObject(bucket, key, bytes, "application/json"),
    read: async (key) => {
      try {
        return await readObject(bucket, key);
      } catch {
        return null;
      }
    },
    list: (prefix) => listObjects(bucket, prefix),
    remove: (key) => deleteObject(bucket, key),
  };
}

async function planPreview(req: PayloadRequest): Promise<Response> {
  try {
    const raw = (await req.text?.()) || "";
    const envelope = await verifyCoreRequest(req, raw, "/api/internal/plan-preview");
    const body = parsePlanPreviewBody(JSON.parse(raw), envelope.site_id);
    if (!body) return failure("VALIDATION_FAILED", 400);
    const result = await runPlanPreview(body, { store: objectStore(), req });
    return sitesJsonResponse({
      ok: true,
      data: { ...result, preview_origin: planPreviewOrigin(cmsConfig().publicRuntimeOrigin) },
    }, 200);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SERVICE_TEMPORARILY_UNAVAILABLE";
    return failure(code, code === "SERVICE_TEMPORARILY_UNAVAILABLE" ? 503 : code === "SIGNATURE_INVALID" || code === "REPLAY_DETECTED" ? 401 : 409);
  }
}

export const planPreviewEndpoints: Endpoint[] = [
  {
    path: "/internal/plan-preview",
    method: "post",
    handler: observeCmsEndpoint("/internal/plan-preview", "core_to_cms", planPreview),
  },
];
