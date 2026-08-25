// #2013 — Ari's single server-side tenant authority.
// Public brand/event RLS is discovery visibility, never private-agent authorization.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { ToolError } from "./agentToolHelpers.ts";

export const TENANT_SCOPED_READ_TOOL_NAMES = new Set([
  "list_brands",
  "list_events",
  "quote_stay",
  "get_payout_status",
  "get_partner_status",
  "get_tax_status",
  "get_brand_analytics",
  "list_brand_audit_log",
  "list_guest_roster",
  "get_operator_snapshot",
  // #1984 — event order sold/refunded/net read; same tenant scope as other reads.
  "get_event_order_reconciliation",
  // issue #1978 — venue discovery reads run inline under the same tenant scope.
  "list_venue_listings",
  "get_venue_listing_status",
  "list_venue_claim_feedback",
  // issue #1971 — the aggregate trip order/money snapshot runs inline under the
  // same tenant scope as every other read.
  "get_trip_order_money",
]);

export interface AccessibleAgentBrand {
  id: string;
  name: string;
  slug: string;
  default_currency: string | null;
  cover_media_url: string | null;
  role: string;
  effective_rank: number;
}

export class TenantScopeError extends Error {
  constructor(
    public code: "BRAND_ACCESS_DENIED" | "TENANT_SCOPE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "TenantScopeError";
  }
}

const ROLE_RANK: Record<string, number> = {
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  admin: 50,
  owner: 60,
  brand_owner: 60,
};

export async function resolveAccessibleAgentBrands(
  client: SupabaseClient,
  userId: string,
): Promise<AccessibleAgentBrand[]> {
  const [ownedResult, memberResult] = await Promise.all([
    client.from("brands")
      .select("id, name, slug, default_currency, cover_media_url")
      .eq("account_id", userId).is("deleted_at", null),
    client.from("brand_team_members")
      .select(
        "brand_id, role, brand:brands!inner(id, name, slug, default_currency, cover_media_url, deleted_at)",
      )
      .eq("user_id", userId).not("accepted_at", "is", null)
      .is("removed_at", null).is("brand.deleted_at", null),
  ]);
  if (ownedResult.error || memberResult.error) {
    throw new TenantScopeError(
      "TENANT_SCOPE_UNAVAILABLE",
      "Ari couldn't verify your brand access. Try again.",
    );
  }

  const byId = new Map<string, AccessibleAgentBrand>();
  for (const raw of (memberResult.data ?? []) as any[]) {
    const brand = Array.isArray(raw.brand) ? raw.brand[0] : raw.brand;
    if (!brand?.id) continue;
    const role = typeof raw.role === "string" ? raw.role : "member";
    byId.set(brand.id, {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      default_currency: brand.default_currency ?? null,
      cover_media_url: brand.cover_media_url ?? null,
      role,
      effective_rank: ROLE_RANK[role] ?? 0,
    });
  }
  // Ownership wins a duplicate membership row.
  for (const brand of (ownedResult.data ?? []) as any[]) {
    byId.set(brand.id, {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      default_currency: brand.default_currency ?? null,
      cover_media_url: brand.cover_media_url ?? null,
      role: "owner",
      effective_rank: 60,
    });
  }
  return [...byId.values()];
}

export function requireAccessibleAgentBrand(
  scope: AccessibleAgentBrand[],
  brandId: unknown,
): AccessibleAgentBrand {
  const brand = typeof brandId === "string"
    ? scope.find((item) => item.id === brandId)
    : undefined;
  if (!brand) {
    throw new TenantScopeError(
      "BRAND_ACCESS_DENIED",
      "That brand is not available to this account.",
    );
  }
  return brand;
}

export async function assertAgentReadBrand(
  client: SupabaseClient,
  userId: string,
  brandId: unknown,
): Promise<AccessibleAgentBrand> {
  try {
    return requireAccessibleAgentBrand(
      await resolveAccessibleAgentBrands(client, userId),
      brandId,
    );
  } catch (error) {
    if (error instanceof TenantScopeError) {
      throw new ToolError(error.code, error.message);
    }
    throw error;
  }
}

export async function assertAgentReadEvent(
  client: SupabaseClient,
  userId: string,
  eventId: unknown,
): Promise<string> {
  const scope = await resolveAccessibleAgentBrands(client, userId).catch(
    (error) => {
      if (error instanceof TenantScopeError) {
        throw new ToolError(error.code, error.message);
      }
      throw error;
    },
  );
  const { data, error } = await client.from("events").select("id, brand_id")
    .eq("id", String(eventId ?? "")).is("deleted_at", null).maybeSingle();
  if (error) {
    throw new ToolError(
      "TENANT_SCOPE_UNAVAILABLE",
      "Ari couldn't verify event access. Try again.",
    );
  }
  if (!data || !scope.some((brand) => brand.id === (data as any).brand_id)) {
    throw new ToolError(
      "BRAND_ACCESS_DENIED",
      "That event is not available to this account.",
    );
  }
  return (data as any).brand_id;
}
