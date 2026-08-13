// #1970 / #424 Wave 0 — shared Ari executor helpers.
// I-ARI-USER-JWT-ONLY: every helper takes the caller JWT client. No service role.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  executor: (
    args: Record<string, unknown>,
    userClient: SupabaseClient,
    userId: string,
  ) => Promise<unknown>;
}

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

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function assertBrandOwned(
  client: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("account_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("OWNERSHIP_CHECK_FAILED", error.message);
  if (!data) throw new ToolError("OWNERSHIP_DENIED", `Brand ${brandId} is not owned by caller`);
}

export async function assertEventOwned(
  client: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from("events")
    .select("id, brand_id, brands!inner(account_id)")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("OWNERSHIP_CHECK_FAILED", error.message);
  if (!data) throw new ToolError("OWNERSHIP_DENIED", `Event ${eventId} not found or not owned`);
  const accountId = (data as any).brands?.account_id;
  if (accountId !== userId) {
    throw new ToolError("OWNERSHIP_DENIED", `Event ${eventId} is not owned by caller`);
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
  const ready = data === true || (data as { can_collect?: boolean } | null)?.can_collect === true;
  if (!ready) {
    throw new ToolError(
      "PAYOUT_NOT_READY",
      "This brand cannot collect payments yet. Finish Stripe or Paystack onboarding first (Ari can show status, but cannot skip KYC).",
    );
  }
}

/**
 * Role-rank gate. Mirrors mingla-business/src/utils/brandRole.ts ranks:
 * owner 60 > admin 50 > event_manager 40 > finance_manager 30 > marketing_manager 20 > scanner 10.
 */
export async function assertBrandRole(
  client: SupabaseClient,
  brandId: string,
  userId: string,
  minRank: number,
): Promise<void> {
  const { data, error } = await client.rpc("biz_role_rank", {
    p_brand_id: brandId,
    p_user_id: userId,
  });
  if (error) {
    // Fallback: owner of the brand always passes.
    const { data: brand } = await client
      .from("brands")
      .select("id")
      .eq("id", brandId)
      .eq("account_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (brand) return;
    throw new ToolError("ROLE_CHECK_FAILED", error.message);
  }
  const rank = typeof data === "number" ? data : Number(data ?? 0);
  if (!Number.isFinite(rank) || rank < minRank) {
    throw new ToolError(
      "ROLE_DENIED",
      `This action needs a higher brand role (required rank ${minRank}).`,
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
