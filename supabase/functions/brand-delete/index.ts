/**
 * brand-delete — #4389. Deletes a brand (or discards a draft) and closes its
 * payment accounts first. verify_jwt = true; the caller must own the brand.
 *
 * POST { brand_id, confirm_name }                     delete (name typed)
 * POST { brand_id, mode: "discard_draft" }            discard a draft (S-12)
 *
 * 200 { ok, brand_id, stripe: "closed"|"none", paystack: "switched_off"|"none" }
 * 409 { error: "delete_blocked", blockers } | { error: "payment_account_close_refused", reason_code }
 *     | { error: "not_a_draft" }
 * The core is `_shared/brandDelete.ts` (also used by Ari's delete_brand).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";
import { type BrandDeleteMode, runBrandDelete } from "../_shared/brandDelete.ts";
import { liveBrandDeleteDeps } from "../_shared/brandDeleteLive.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { brand_id?: unknown; confirm_name?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  if (!isValidUuid(body.brand_id)) {
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }
  const mode: BrandDeleteMode = body.mode === "discard_draft" ? "discard_draft" : "delete";

  try {
    const result = await runBrandDelete(liveBrandDeleteDeps(serviceRoleClient(), userId), {
      brandId: body.brand_id,
      userId,
      mode,
      confirmName: typeof body.confirm_name === "string" ? body.confirm_name : null,
    });
    return jsonResponse(result.body, result.status);
  } catch (err) {
    console.error("[brand-delete] unhandled:", err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: "internal_error" }, 500);
  }
};

if (import.meta.main) serve(handler);
