import type { CollectionAfterChangeHook, PayloadRequest } from "payload";
import { ATELIER, designFor } from "../contracts/generated/designs.ts";
import { emitCmsObservation } from "./observability";

/*
 * #2829 W9a — "Your look" on the website plan ticks from Core's record of
 * the owner saving the site's look (design, colours, fonts, shape, motion)
 * at least once (`brand_sites.tokens_saved_at`). Studio, the Business "Your
 * look" screen and Ari all save through site-settings, so this one hook is
 * the single reporter. A failed report never undoes the owner's save; it is
 * observed (the plan simply stays unticked until the next save reaches Core).
 */
const LOOK_FIELDS = ["design", "tokens", "fonts", "radius", "button_shape", "motion"] as const;

export function lookChanged(previous: Record<string, unknown> | undefined, next: Record<string, unknown>): boolean {
  return LOOK_FIELDS.some((field) => JSON.stringify(previous?.[field] ?? null) !== JSON.stringify(next[field] ?? null));
}

export function savedDesignKey(doc: Record<string, unknown>): string {
  return (designFor(doc.design) ?? ATELIER).key;
}

type Report = (path: string, siteId: string, operationId: string, payload: Record<string, unknown>) => Promise<unknown>;

// Resolved at call time: the signed Core client is loaded only when a look
// save actually happens (collection configs load in many contexts).
const reportToCore: Report = async (path, siteId, operationId, payload) =>
  (await import("./gateway")).callCore(path, siteId, operationId, payload);

export function reportLookSavedHook(report: Report = reportToCore): CollectionAfterChangeHook {
  return async ({ doc, previousDoc, operation, req }) => {
    const next = doc as Record<string, unknown>;
    if (operation === "create" || !lookChanged(previousDoc as Record<string, unknown> | undefined, next)) return doc;
    const siteId = await coreSiteIdOf(req, next.tenant);
    if (!siteId) return doc;
    try {
      await report(`/internal/v1/sites/${siteId}/look-saved`, siteId, crypto.randomUUID(), {
        design_key: savedDesignKey(next),
      });
    } catch (error) {
      emitCmsObservation({
        event: "mingla_sites_state",
        metric: "cms.look_saved.report_failed",
        request_id: crypto.randomUUID(),
        operation_id: null,
        site_id: siteId,
        publication_id: null,
        direction: "cms_to_core",
        route: "/internal/v1/sites/{siteId}/look-saved",
        state_transition: "look_saved->report_failed",
        latency_ms: 0,
        retry_count: 0,
        safe_error_code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CORE_UNAVAILABLE",
        status_code: null,
        version: "sites-v1",
      });
    }
    return doc;
  };
}

async function coreSiteIdOf(req: PayloadRequest, tenant: unknown): Promise<string | null> {
  const tenantId = tenant && typeof tenant === "object" ? (tenant as { id?: unknown }).id : tenant;
  if (typeof tenantId !== "string" && typeof tenantId !== "number") return null;
  try {
    const record = await req.payload.findByID({ collection: "tenants", id: String(tenantId), overrideAccess: true, depth: 0 });
    return typeof record.core_site_id === "string" ? record.core_site_id : null;
  } catch {
    return null;
  }
}
