// #1970 / #424 Wave 0 — shared Ari executor helpers.
// I-ARI-USER-JWT-ONLY: every helper takes the caller JWT client. No service role.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AgentRequiredRole =
  | "business_user"
  | "self"
  | "scanner"
  | "marketing_manager"
  | "finance_manager"
  | "event_manager"
  // issue #1978 — venue claim feedback/resubmit are brand-owner-only, matching
  // the canonical `biz_role_rank('brand_owner')` gate the RPCs enforce.
  | "brand_owner"
  | "brand_admin"
  | "deed_owner";

export type AgentResourceKind =
  | "none"
  | "optional_brand"
  | "brand"
  | "event"
  | "campaign"
  | "stay_reservation"
  | "venue_reservation"
  // issue #1978 — venue lifecycle resources. `venue` derives the tenant brand
  // from `venue_listings.id`; `venue_feedback` derives it from the feedback row
  // and requires its venue to agree, so a claim id can never straddle brands.
  | "venue"
  | "venue_feedback";

export interface AgentAuthorizationDeclaration {
  requiredRole: AgentRequiredRole;
  resource: AgentResourceKind;
}

/**
 * Durable execution identity for a confirmed Ari proposal. Read-only tools use
 * a null operation id; every write owner must require the pending-action id and
 * bind its database receipt to it.
 */
export interface AgentToolExecutionContext {
  operationId: string | null;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  executor: (
    args: Record<string, unknown>,
    userClient: SupabaseClient,
    userId: string,
    context?: AgentToolExecutionContext,
  ) => Promise<unknown>;
}

export interface AgentTool
  extends AgentToolDefinition, AgentAuthorizationDeclaration {}

export class ToolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function deriveSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function requireAgentOperationId(
  context?: AgentToolExecutionContext,
): string {
  if (!isUuid(context?.operationId)) {
    throw new ToolError(
      "OPERATION_ID_REQUIRED",
      "This write must be confirmed from its original Ari proposal.",
    );
  }
  return context.operationId;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function resolveEventBrand(
  client: SupabaseClient,
  eventId: string,
): Promise<string> {
  const { data, error } = await client
    .from("events")
    .select("id, brand_id")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("RESOURCE_CHECK_FAILED", error.message);
  if (!data) {
    throw new ToolError("BRAND_ACCESS_DENIED", "That resource is unavailable");
  }
  return (data as any).brand_id as string;
}

/**
 * Payout-readiness gate. Paid publish / paid tier create MUST call this.
 * Reuses `pg_brand_can_collect` — same RPC the manual UI uses.
 */
export async function assertCanCollect(
  client: SupabaseClient,
  brandId: string,
): Promise<void> {
  const { data, error } = await client.rpc("pg_brand_can_collect", {
    p_brand_id: brandId,
  });
  if (error) throw new ToolError("PAYOUT_CHECK_FAILED", error.message);
  const ready = data === true ||
    (data as { can_collect?: boolean } | null)?.can_collect === true;
  if (!ready) {
    throw new ToolError(
      "PAYOUT_NOT_READY",
      "This brand cannot collect payments yet. Finish Stripe or Paystack onboarding first (Ari can show status, but cannot skip KYC).",
    );
  }
}

export async function callRpc<T = unknown>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new ToolError("RPC_FAILED", `${fn}: ${error.message}`);
  return data as T;
}

export async function invokeFn<T = unknown>(
  client: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<T> {
  const { data, error } = await client.functions.invoke(name, {
    body,
    headers,
  });
  if (error) throw new ToolError("EDGE_FAILED", `${name}: ${error.message}`);
  return data as T;
}
