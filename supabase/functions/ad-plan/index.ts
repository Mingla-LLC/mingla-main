/**
 * Issue #3697 v1.4 — shared Admin, Host and Ari ad-plan control plane.
 *
 * This endpoint owns the resumable draft/version/targeting/funding/review/
 * confirmation lifecycle. It never creates provider objects. Provider create
 * endpoints must consume the immutable plan version, SHA-256 and per-platform
 * allocation returned here.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPlatform } from "../_shared/adChannel.ts";
import {
  type AdAudienceIntent,
  compileTargetingPlan,
  type ProviderTargetingRefs,
} from "../_shared/adTargetingCompiler.ts";
import { resolveAdBrandCurrency } from "../_shared/adCurrencyAuthority.ts";
import { buildAdMeasurementManifest } from "../_shared/adMeasurement.ts";
import {
  estimateInputFromTargeting,
  fetchProviderAudienceEstimate,
} from "../_shared/adProviderEstimate.ts";
import type { AdConnectionRow, Platform } from "../_shared/adChannelCore.ts";
import { forwardGeocodeText } from "../_shared/mapboxGeocode.ts";
import { buildCreativeLibrary } from "../_shared/adCreativeLibrary.ts";
import { withHostCreativeFit } from "../_shared/adCreativeFit.ts";
import { adCreativeOwnershipError } from "../_shared/adCreativeOwnership.ts";
import {
  applyLibraryFilters,
  creativeFitGateFailure,
  creativeSelectionError,
  decorateLibraryRows,
  FIT_CREATIVE_COLUMNS,
  handleCreativeLifecycleAction,
  IN_FLIGHT_AD_JOB_STATUSES,
  LIBRARY_CREATIVE_COLUMNS,
  LIBRARY_PAGE_SIZE,
  LIFECYCLE_ACTIONS,
  namePattern,
  parseLibraryFilters,
  pendingLibraryItems,
  storedCreativeValidation,
} from "../_shared/adCreativeLifecycle.ts";
import { destroyIfUnreferenced, type ReapDeps } from "../_shared/coverVideoReap.ts";
import { PLATFORMS } from "../_shared/adChannelCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Db = any;
type User = { id: string; email?: string | null };
type Plan = {
  id: string;
  client_kind: "admin" | "host" | "ari";
  owner_kind: "mingla" | "host";
  brand_id: string | null;
  destination_family: string;
  destination_key: string;
  current_version_id: string | null;
  state: string;
};
type Draft = {
  id: string;
  client_kind: "admin" | "host" | "ari";
  owner_kind: "mingla" | "host";
  brand_id: string | null;
  plan_id: string | null;
  created_by: string;
  status: "active" | "consumed" | "discarded";
  schema_version: 1;
  revision: number;
  current_step: string;
  draft_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type Version = {
  id: string;
  plan_id: string;
  plan_hash: string;
  canonical_plan: Record<string, unknown>;
  host_currency: string;
  host_budget_cents: number;
};
type RequestedAllocation = {
  platform: Platform;
  connection_id: string;
  host_budget_cents: number;
  host_delivery_budget_cents: number;
};
type HostAdAction =
  | "read"
  | "plan"
  | "fund"
  | "launch"
  | "pause"
  | "end"
  | "review";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function targetingCityKey(city: Record<string, unknown>): string | null {
  const name = typeof city.name === "string"
    ? city.name.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ")
    : "";
  const country = typeof city.countryCode === "string"
    ? city.countryCode.trim().toUpperCase()
    : "";
  return name && /^[A-Z]{2}$/.test(country) ? `${country}:${name}` : null;
}

async function withServerTargetingCoordinates(
  intent: AdAudienceIntent,
  refs: Partial<Record<Platform, ProviderTargetingRefs>>,
  platforms: Platform[],
): Promise<Partial<Record<Platform, ProviderTargetingRefs>>> {
  if (!platforms.includes("snapchat") || !Array.isArray(intent.cities)) {
    return refs;
  }
  const coordinates: Record<
    string,
    { latitude: number; longitude: number } | null
  > = {};
  await Promise.all(intent.cities.map(async (rawCity) => {
    const city = asRecord(rawCity);
    if (!city) return;
    const key = targetingCityKey(city);
    if (!key) return;
    const resolved = await forwardGeocodeText(
      `${String(city.name).trim()}, ${String(city.countryCode).trim()}`,
    );
    coordinates[key] = resolved
      ? {
        latitude: resolved.lat,
        longitude: resolved.lng,
      }
      : null;
  }));
  return {
    ...refs,
    snapchat: {
      ...(refs.snapchat ?? {}),
      locationCoordinates: coordinates,
    },
  };
}

function positiveMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function parseAllocations(value: unknown): RequestedAllocation[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: RequestedAllocation[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const row = asRecord(raw);
    const platform = row?.platform;
    const connectionId = row?.connection_id;
    const budget = positiveMinor(row?.host_budget_cents);
    const deliveryBudget = row?.host_delivery_budget_cents === undefined
      ? budget
      : positiveMinor(row.host_delivery_budget_cents);
    if (
      !isPlatform(platform) || typeof connectionId !== "string" ||
      !UUID_RE.test(connectionId) || budget === null ||
      deliveryBudget === null ||
      deliveryBudget > budget || seen.has(platform)
    ) return null;
    seen.add(platform);
    rows.push({
      platform,
      connection_id: connectionId,
      host_budget_cents: budget,
      host_delivery_budget_cents: deliveryBudget,
    });
  }
  return rows;
}

function normalizeMediaRights(
  value: unknown,
  actorId: string,
): Record<string, unknown> | null {
  const rights = asRecord(value);
  const basis = rights?.rights_basis;
  if (
    rights?.rights_confirmed !== true ||
    !["owned", "licensed", "authorized_by_brand"].includes(String(basis)) ||
    typeof rights?.ai_generated !== "boolean"
  ) return null;
  return {
    rights_confirmed: true,
    rights_basis: basis,
    ai_generated: rights.ai_generated,
    house_reuse_allowed: false,
    attested_by: actorId,
    attested_at: new Date().toISOString(),
  };
}

function parsePlatformList(value: unknown): Platform[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const platforms: Platform[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlatform(item) || seen.has(item)) return null;
    seen.add(item);
    platforms.push(item);
  }
  return platforms;
}

function databaseFailure(error: { message?: string; code?: string } | null) {
  const detail = error?.message ?? "database_operation_failed";
  const status = error?.code === "P0002"
    ? 404
    : error?.code === "22023"
    ? 422
    : error?.code === "55000"
    ? 409
    : 502;
  return json({ error: "plan_operation_failed", detail }, status);
}

async function isActiveAdmin(db: Db, user: User): Promise<boolean> {
  if (!user.email) return false;
  const { data } = await db.from("admin_users").select("id")
    .eq("email", user.email).eq("status", "active").maybeSingle();
  return data !== null;
}

async function loadPlan(db: Db, planId: string): Promise<Plan | null> {
  if (!UUID_RE.test(planId)) return null;
  const { data } = await db.from("ad_plans").select("*").eq("id", planId)
    .maybeSingle();
  return data as Plan | null;
}

async function loadVersion(db: Db, versionId: string): Promise<Version | null> {
  if (!UUID_RE.test(versionId)) return null;
  const { data } = await db.from("ad_plan_versions").select("*")
    .eq("id", versionId).maybeSingle();
  return data as Version | null;
}

async function loadDraft(db: Db, draftId: string): Promise<Draft | null> {
  if (!UUID_RE.test(draftId)) return null;
  const { data } = await db.from("ad_plan_drafts").select("*").eq(
    "id",
    draftId,
  ).maybeSingle();
  return data as Draft | null;
}

async function canAccessDraftScope(
  db: Db,
  user: User,
  ownerKind: unknown,
  brandId: string | null,
  permission: "read" | "plan",
): Promise<boolean> {
  if (ownerKind === "mingla") return isActiveAdmin(db, user);
  if (ownerKind !== "host" || !brandId || !UUID_RE.test(brandId)) return false;
  const { data, error } = await db.rpc("ad_can_host_action", {
    p_brand_id: brandId,
    p_user_id: user.id,
    p_action: permission,
  });
  return !error && data === true;
}

async function canAccessPlan(
  db: Db,
  user: User,
  plan: Plan,
  permission: HostAdAction,
): Promise<boolean> {
  if (plan.owner_kind === "mingla") return isActiveAdmin(db, user);
  if (permission === "review") return isActiveAdmin(db, user);
  if (!plan.brand_id) return false;
  const { data, error } = await db.rpc("ad_can_host_action", {
    p_brand_id: plan.brand_id,
    p_user_id: user.id,
    p_action: permission,
  });
  return !error && data === true;
}

async function authorizeVersion(
  db: Db,
  user: User,
  versionId: string,
  permission: HostAdAction,
): Promise<{ plan: Plan; version: Version } | null> {
  const version = await loadVersion(db, versionId);
  if (!version) return null;
  const plan = await loadPlan(db, version.plan_id);
  if (!plan || !(await canAccessPlan(db, user, plan, permission))) return null;
  return { plan, version };
}

function canonicalizePlan(
  input: Record<string, unknown>,
  platforms: Platform[],
  money: Record<string, unknown>,
): Record<string, unknown> {
  const canonical = structuredClone(input);
  delete canonical.currency;
  delete canonical.host_currency;
  delete canonical.provider_currency;
  delete canonical.provider_budget_cents;
  canonical.platforms = platforms;
  canonical.money = money;
  return canonical;
}

async function normalizedAllocations(
  db: Db,
  plan: Plan,
  requested: RequestedAllocation[],
): Promise<
  | { ok: true; hostCurrency: string; rows: Record<string, unknown>[] }
  | { ok: false; status: number; detail: string }
> {
  if (plan.owner_kind === "host") {
    if (!plan.brand_id) {
      return { ok: false, status: 422, detail: "host_brand_required" };
    }
    const authority = await resolveAdBrandCurrency(db, plan.brand_id);
    if (!authority.ok) {
      return { ok: false, status: 409, detail: authority.detail };
    }
    const rows: Record<string, unknown>[] = [];
    for (const allocation of requested) {
      const { data, error } = await db.rpc("ad_plan_quote_for_brand", {
        p_brand_id: plan.brand_id,
        p_provider_connection_id: allocation.connection_id,
        p_host_budget_cents: allocation.host_budget_cents,
      });
      if (error || !data) {
        return {
          ok: false,
          status: 422,
          detail: error?.message ?? "provider_quote_unavailable",
        };
      }
      let providerDeliveryBudget = allocation.host_delivery_budget_cents;
      if (data.provider_currency !== authority.currency) {
        const { data: converted, error: conversionError } = await db.rpc(
          "fx_convert_minor",
          {
            p_amount: allocation.host_delivery_budget_cents,
            p_source: authority.currency,
            p_target: data.provider_currency,
            p_snapshot: data.fx_snapshot_id,
          },
        );
        if (
          conversionError || !Number.isSafeInteger(converted) || converted <= 0
        ) {
          return {
            ok: false,
            status: 422,
            detail: conversionError?.message ??
              "provider_delivery_quote_unavailable",
          };
        }
        providerDeliveryBudget = converted;
      }
      rows.push({
        platform: allocation.platform,
        connection_id: allocation.connection_id,
        host_budget_cents: allocation.host_budget_cents,
        host_delivery_budget_cents: allocation.host_delivery_budget_cents,
        provider_budget_cents: data.provider_budget_cents,
        provider_delivery_budget_cents: providerDeliveryBudget,
        fx_snapshot_id: data.fx_snapshot_id,
      });
    }
    return { ok: true, hostCurrency: authority.currency, rows };
  }

  const ids = requested.map((row) => row.connection_id);
  const { data, error } = await db.from("ad_connections")
    .select("id, platform, currency, connected, status").in("id", ids);
  if (error) {
    return { ok: false, status: 502, detail: "connection_lookup_failed" };
  }
  const byId = new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((
      row,
    ) => [row.id, row]),
  );
  const currencies = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const allocation of requested) {
    const connection = byId.get(allocation.connection_id);
    const currency = typeof connection?.currency === "string"
      ? connection.currency.trim().toUpperCase()
      : "";
    if (
      !connection || connection.platform !== allocation.platform ||
      connection.connected !== true || connection.status !== "connected" ||
      !ISO_CURRENCY_RE.test(currency)
    ) {
      return {
        ok: false,
        status: 409,
        detail: `provider_connection_unavailable:${allocation.platform}`,
      };
    }
    currencies.add(currency);
    rows.push({
      platform: allocation.platform,
      connection_id: allocation.connection_id,
      host_budget_cents: allocation.host_budget_cents,
      host_delivery_budget_cents: allocation.host_delivery_budget_cents,
      provider_budget_cents: allocation.host_budget_cents,
      provider_delivery_budget_cents: allocation.host_delivery_budget_cents,
      fx_snapshot_id: null,
    });
  }
  if (currencies.size !== 1) {
    return {
      ok: false,
      status: 422,
      detail: "admin_currency_split_required",
    };
  }
  return { ok: true, hostCurrency: [...currencies][0], rows };
}

/**
 * #3697 FG-1 — the creative frozen into this version must fit every platform
 * the version allocates. Fails closed on an unreadable creative or allocation.
 */
async function fundingFitGate(
  db: Db,
  version: Version,
): Promise<Response | null> {
  const creativeId = version.canonical_plan?.creative_library_id;
  if (typeof creativeId !== "string" || !UUID_RE.test(creativeId)) return null;
  const [creativeResult, allocationResult] = await Promise.all([
    db.from("ad_creatives").select(FIT_CREATIVE_COLUMNS).eq("id", creativeId)
      .maybeSingle(),
    db.from("ad_plan_provider_allocations").select("platform").eq(
      "plan_version_id",
      version.id,
    ),
  ]);
  if (creativeResult.error || allocationResult.error) {
    return databaseFailure(creativeResult.error ?? allocationResult.error);
  }
  const creative = creativeResult.data as Record<string, unknown> | null;
  if (!creative) {
    return json(
      { error: "plan_preflight_failed", detail: "creative_not_found" },
      409,
    );
  }
  if (creative.purged_at) {
    return json({ error: "creative_purged" }, 409);
  }
  const platforms = ((allocationResult.data ?? []) as { platform: unknown }[])
    .map((row) => row.platform).filter(isPlatform);
  const failure = creativeFitGateFailure(creative, platforms);
  if (!failure) return null;
  return json({
    error: "creative_does_not_fit",
    platform: failure.platform,
    reasons: failure.reasons,
    misfits: failure.misfits.map(({ platform, needs }) => ({ platform, needs })),
  }, 422);
}

async function getPlanAggregate(db: Db, plan: Plan) {
  const version = plan.current_version_id
    ? await loadVersion(db, plan.current_version_id)
    : null;
  if (!version) return { plan, version: null };
  const [
    allocations,
    targeting,
    reviews,
    confirmations,
    hold,
    attempts,
    campaigns,
    providerFailureEvents,
  ] = await Promise.all([
    db.from("ad_plan_provider_allocations").select("*")
      .eq("plan_version_id", version.id).order("platform"),
    db.from("ad_plan_targeting_snapshots").select("*")
      .eq("plan_version_id", version.id).order("platform"),
    db.from("ad_plan_reviews").select("*").eq("plan_version_id", version.id)
      .order("decided_at", { ascending: false }),
    db.from("ad_plan_confirmations").select("*")
      .eq("plan_version_id", version.id),
    db.from("ad_plan_funding_holds").select("*")
      .eq("plan_version_id", version.id).maybeSingle(),
    db.from("ad_provider_attempts").select("*").eq(
      "plan_version_id",
      version.id,
    )
      .order("created_at"),
    db.from("ad_campaigns").select("*").eq("plan_version_id", version.id)
      .order("platform"),
    db.from("ad_status_events").select("*")
      .is("campaign_id", null)
      .in("action", ["create_failed", "rollback"])
      .contains("external_ids", { plan_version_id: version.id })
      .order("created_at"),
  ]);
  const campaignIds = (campaigns.data ?? []).map((row: { id: string }) =>
    row.id
  );
  const settlements = campaignIds.length > 0
    ? await db.from("ad_campaign_settlements").select("*").in(
      "campaign_id",
      campaignIds,
    )
    : { data: [] };
  return {
    plan,
    version,
    provider_allocations: allocations.data ?? [],
    targeting_snapshots: targeting.data ?? [],
    reviews: reviews.data ?? [],
    confirmations: confirmations.data ?? [],
    funding_hold: hold.data ?? null,
    provider_attempts: attempts.data ?? [],
    provider_failure_events: providerFailureEvents.data ?? [],
    campaigns: campaigns.data ?? [],
    settlements: settlements.data ?? [],
  };
}

/** Test seams. Production uses the service-role client and Bunny. */
export type AdPlanDeps = {
  db?: Db;
  /** The provider delete inside the guarded path (tests stub the network). */
  reapDeps?: ReapDeps;
};

export async function handleAdPlan(
  req: Request,
  deps: AdPlanDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const serviceDb = () =>
    createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const db = (deps.db ?? serviceDb()) as ReturnType<typeof serviceDb>;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const actor = user as User;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "save_draft") {
    const draftId = typeof body.draft_id === "string" ? body.draft_id : "";
    const clientKind = String(body.client_kind ?? "");
    const ownerKind = String(body.owner_kind ?? "");
    const brandId = typeof body.brand_id === "string" ? body.brand_id : null;
    const currentStep = typeof body.current_step === "string"
      ? body.current_step.trim()
      : "";
    const draftState = asRecord(body.draft_state);
    const expectedRevision = body.expected_revision;
    const requestedPlanId = body.plan_id === null || body.plan_id === undefined
      ? null
      : typeof body.plan_id === "string"
      ? body.plan_id
      : "invalid";
    if (
      !UUID_RE.test(draftId) ||
      !["admin", "host", "ari"].includes(clientKind) ||
      !["mingla", "host"].includes(ownerKind) ||
      (ownerKind === "host" && (!brandId || !UUID_RE.test(brandId))) ||
      (ownerKind === "mingla" && brandId !== null) ||
      currentStep.length < 1 || currentStep.length > 64 ||
      !draftState || JSON.stringify(draftState).length > 524288 ||
      !Number.isSafeInteger(expectedRevision) ||
      Number(expectedRevision) < 0 ||
      (requestedPlanId !== null && !UUID_RE.test(requestedPlanId))
    ) {
      return json(
        { error: "validation_error", detail: "plan_draft_invalid" },
        400,
      );
    }
    if (
      !(await canAccessDraftScope(db, actor, ownerKind, brandId, "plan"))
    ) {
      return json({ error: "forbidden" }, 403);
    }
    const existing = await loadDraft(db, draftId);
    if (existing) {
      if (
        existing.created_by !== actor.id ||
        existing.client_kind !== clientKind ||
        existing.owner_kind !== ownerKind ||
        existing.brand_id !== brandId
      ) return json({ error: "forbidden" }, 403);
      if (
        existing.status !== "active" ||
        existing.revision !== expectedRevision
      ) {
        return json({
          error: "draft_conflict",
          detail: "reload_before_overwriting_newer_draft",
          draft: existing,
        }, 409);
      }
    } else if (expectedRevision !== 0) {
      return json({ error: "draft_not_found" }, 404);
    }
    if (requestedPlanId) {
      const plan = await loadPlan(db, requestedPlanId);
      if (
        !plan || !(await canAccessPlan(db, actor, plan, "plan")) ||
        plan.owner_kind !== ownerKind || plan.brand_id !== brandId
      ) return json({ error: "plan_conflict" }, 409);
    }
    if (!existing) {
      const { data, error } = await db.from("ad_plan_drafts").insert({
        id: draftId,
        client_kind: clientKind,
        owner_kind: ownerKind,
        brand_id: brandId,
        plan_id: requestedPlanId,
        created_by: actor.id,
        current_step: currentStep,
        draft_state: draftState,
        revision: 1,
      }).select("*").single();
      if (error) return databaseFailure(error);
      return json({ ok: true, draft: data }, 201);
    }
    const { data, error } = await db.from("ad_plan_drafts").update({
      current_step: currentStep,
      draft_state: draftState,
      plan_id: requestedPlanId ?? existing.plan_id,
      revision: existing.revision + 1,
    }).eq("id", draftId).eq("revision", existing.revision).eq(
      "status",
      "active",
    ).select("*").maybeSingle();
    if (error) return databaseFailure(error);
    if (!data) {
      return json({
        error: "draft_conflict",
        detail: "reload_before_overwriting_newer_draft",
        draft: await loadDraft(db, draftId),
      }, 409);
    }
    return json({ ok: true, draft: data });
  }

  if (action === "get_draft") {
    const draftId = typeof body.draft_id === "string" ? body.draft_id : "";
    const draft = await loadDraft(db, draftId);
    if (!draft || draft.status !== "active") {
      return json({ error: "draft_not_found" }, 404);
    }
    if (
      draft.created_by !== actor.id ||
      !(await canAccessDraftScope(
        db,
        actor,
        draft.owner_kind,
        draft.brand_id,
        "read",
      ))
    ) return json({ error: "forbidden" }, 403);
    return json({ ok: true, draft });
  }

  if (action === "discard_draft") {
    const draftId = typeof body.draft_id === "string" ? body.draft_id : "";
    const expectedRevision = body.expected_revision;
    const draft = await loadDraft(db, draftId);
    if (!draft || draft.status !== "active") {
      return json({ error: "draft_not_found" }, 404);
    }
    if (
      draft.created_by !== actor.id ||
      !Number.isSafeInteger(expectedRevision) ||
      draft.revision !== expectedRevision ||
      !(await canAccessDraftScope(
        db,
        actor,
        draft.owner_kind,
        draft.brand_id,
        "plan",
      ))
    ) return json({ error: "draft_conflict" }, 409);
    const { data, error } = await db.from("ad_plan_drafts").update({
      status: "discarded",
      revision: draft.revision + 1,
    }).eq("id", draft.id).eq("revision", draft.revision).select("*").single();
    return error ? databaseFailure(error) : json({ ok: true, draft: data });
  }

  if (action === "host_setup") {
    const brandId = typeof body.brand_id === "string" ? body.brand_id : "";
    if (!UUID_RE.test(brandId)) {
      return json(
        { error: "validation_error", detail: "brand_id_invalid" },
        400,
      );
    }
    const { data: allowed } = await db.rpc("ad_can_host_action", {
      p_brand_id: brandId,
      p_user_id: actor.id,
      p_action: "read",
    });
    if (allowed !== true) return json({ error: "forbidden" }, 403);
    if (!ANON_KEY) {
      return json(
        { error: "configuration_error", detail: "anon_key_missing" },
        503,
      );
    }
    const userDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [pages, connections, creatives, authority, plans] = await Promise.all(
      [
        userDb.rpc("ad_advertisable_pages", {
          p_query: null,
          p_types: null,
          p_include_unavailable: false,
          p_brand_id: brandId,
          p_page: 0,
        }),
        db.from("ad_connections")
          .select("id,platform,lane,currency,status,connected,updated_at")
          .eq("lane", "business").eq("connected", true).eq(
            "status",
            "connected",
          )
          .order("platform"),
        db.from("ad_creatives")
          .select(
            "id,name,kind,status,source_url,poster_url,mp4_master_url,bunny_video_id,duration_seconds,aspect_ratio,created_at,width,height,has_audio,mime_type,byte_size,variants",
          )
          .eq("brand_id", brandId).eq("kind", "video").eq("status", "active")
          .order("created_at", { ascending: false }).limit(100),
        resolveAdBrandCurrency(db, brandId),
        db.from("ad_plans")
          .select("*").eq("brand_id", brandId).eq("owner_kind", "host")
          .order("updated_at", { ascending: false }).limit(50),
      ],
    );
    const firstError = pages.error ?? connections.error ?? creatives.error ??
      plans.error;
    if (firstError) return databaseFailure(firstError);
    if (!authority.ok) {
      return json({
        error: "currency_authority_unresolved",
        detail: authority.detail,
      }, 409);
    }
    return json({
      ok: true,
      currency: authority.currency,
      pages: pages.data ?? [],
      connections: connections.data ?? [],
      // #3040 AD-04 — each video's fit on the brand's connected platforms,
      // judged by the same channel matrix as every ads gate.
      creatives: withHostCreativeFit(
        creatives.data ?? [],
        connections.data ?? [],
      ),
      plans: plans.data ?? [],
    });
  }

  if (action === "creative_library") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    // #3697 — filters, a cursor, in-flight uploads and per-platform fit. A
    // purged creative (tombstone) is excluded from every view, Archived too.
    const parsedFilters = parseLibraryFilters(body);
    if (!parsedFilters.ok) {
      return json(
        { error: "validation_error", detail: parsedFilters.detail },
        400,
      );
    }
    const filters = parsedFilters.filters;
    const creatives = await applyLibraryFilters(
      db.from("ad_creatives").select(LIBRARY_CREATIVE_COLUMNS),
      filters,
    );
    if (creatives.error) return databaseFailure(creatives.error);
    const pageRows = (creatives.data ?? []) as Record<string, unknown>[];
    const hasMore = pageRows.length > LIBRARY_PAGE_SIZE;
    const creativeRows = hasMore
      ? pageRows.slice(0, LIBRARY_PAGE_SIZE)
      : pageRows;
    const lastRow = creativeRows[creativeRows.length - 1];
    const nextCursor = hasMore && lastRow
      ? { created_at: lastRow.created_at, id: lastRow.id }
      : null;

    // In-flight house uploads by this admin show as cards before their row
    // exists (first page of the active view only).
    let pending: Record<string, unknown>[] = [];
    if (
      filters.status === "active" && !filters.before &&
      filters.kind !== "image" && filters.source !== "host"
    ) {
      let jobQuery = db.from("event_cover_video_jobs").select(
        "id,status,created_at,source_uploaded_at,source_file_name,source_bytes,source_duration_ms,client_operation_id",
      ).eq("target_kind", "ad_creative").eq("requested_by", actor.id)
        .is("brand_id", null).in("status", [...IN_FLIGHT_AD_JOB_STATUSES]);
      if (filters.q) {
        jobQuery = jobQuery.ilike("source_file_name", namePattern(filters.q));
      }
      const jobs = await jobQuery.order("created_at", { ascending: false })
        .limit(LIBRARY_PAGE_SIZE);
      if (jobs.error) return databaseFailure(jobs.error);
      const jobRows = (jobs.data ?? []) as Record<string, unknown>[];
      const jobIds = jobRows.map((row) => String(row.id));
      const made = jobIds.length > 0
        ? await db.from("ad_creatives").select("source_job_id").in(
          "source_job_id",
          jobIds,
        )
        : { data: [], error: null };
      if (made.error) return databaseFailure(made.error);
      pending = pendingLibraryItems(
        jobRows,
        new Set(
          ((made.data ?? []) as { source_job_id: string }[]).map((row) =>
            row.source_job_id
          ),
        ),
      );
    }

    const countOf = async (
      apply: (query: Db) => Db,
    ): Promise<number | null> => {
      const result = await apply(
        db.from("ad_creatives").select("id", { count: "exact", head: true })
          .is("purged_at", null),
      );
      if (result.error) {
        console.warn("[ad-plan] creative_library count failed", {
          code: result.error.code ?? null,
        });
        return null;
      }
      return typeof result.count === "number" ? result.count : null;
    };
    const [all, images, videos, fromHosts, archived] = await Promise.all([
      countOf((q) => q.eq("status", "active")),
      countOf((q) => q.eq("status", "active").eq("kind", "image")),
      countOf((q) => q.eq("status", "active").eq("kind", "video")),
      countOf((q) => q.eq("status", "active").neq("source", "admin_upload")),
      countOf((q) => q.eq("status", "archived")),
    ]);
    const counts = { all, images, videos, from_hosts: fromHosts, archived };

    const creativeIds = creativeRows.map((row) => String(row.id));
    if (creativeIds.length === 0) {
      return json({
        ok: true,
        creatives: [],
        pending,
        counts,
        next_cursor: null,
      });
    }

    const [versions, refs, ads] = await Promise.all([
      db.from("ad_plan_versions").select(
        "id,plan_id,version_number,canonical_plan,created_at",
      ).in("canonical_plan->>creative_library_id", creativeIds),
      db.from("ad_creative_platform_refs").select(
        "creative_id,platform,lane,status,retryable,last_checked_at,updated_at",
      ).in("creative_id", creativeIds),
      db.from("ads").select("creative_id,ad_set_id,created_at,updated_at")
        .in("creative_id", creativeIds),
    ]);
    const firstError = versions.error ?? refs.error ?? ads.error;
    if (firstError) return databaseFailure(firstError);

    const versionRows = versions.data ?? [];
    const planIds = [
      ...new Set(versionRows.map((row: { plan_id: string }) => row.plan_id)),
    ];
    const versionIds = versionRows.map((row: { id: string }) => row.id);
    const adSetIds = [
      ...new Set((ads.data ?? []).map(
        (row: { ad_set_id: string }) => row.ad_set_id,
      )),
    ];
    const [plans, adSets, versionCampaigns] = await Promise.all([
      planIds.length > 0
        ? db.from("ad_plans").select("id,state,owner_kind,updated_at").in(
          "id",
          planIds,
        )
        : Promise.resolve({ data: [], error: null }),
      adSetIds.length > 0
        ? db.from("ad_sets").select("id,campaign_id").in("id", adSetIds)
        : Promise.resolve({ data: [], error: null }),
      versionIds.length > 0
        ? db.from("ad_campaigns").select(
          "id,plan_version_id,platform,name,status,created_at,updated_at",
        ).in("plan_version_id", versionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const relatedError = plans.error ?? adSets.error ?? versionCampaigns.error;
    if (relatedError) return databaseFailure(relatedError);
    const campaignIds = [
      ...new Set((adSets.data ?? []).map(
        (row: { campaign_id: string }) => row.campaign_id,
      )),
    ];
    const adCampaigns = campaignIds.length > 0
      ? await db.from("ad_campaigns").select(
        "id,plan_version_id,platform,name,status,created_at,updated_at",
      ).in("id", campaignIds)
      : { data: [], error: null };
    if (adCampaigns.error) return databaseFailure(adCampaigns.error);
    const campaignsById = new Map(
      [...(versionCampaigns.data ?? []), ...(adCampaigns.data ?? [])].map(
        (row: { id: string }) => [row.id, row],
      ),
    );

    const projected = buildCreativeLibrary({
      creatives: creativeRows,
      versions: versionRows,
      plans: plans.data ?? [],
      campaigns: [...campaignsById.values()],
      adSets: adSets.data ?? [],
      ads: ads.data ?? [],
      providerRefs: refs.data ?? [],
    });
    const personIds = [
      ...new Set(
        creativeRows.flatMap((row) =>
          [row.created_by, row.archived_by].filter((id): id is string =>
            typeof id === "string"
          )
        ),
      ),
    ];
    const brandIds = [
      ...new Set(
        creativeRows.map((row) => row.brand_id).filter((
          id,
        ): id is string => typeof id === "string"),
      ),
    ];
    const [profiles, brands] = await Promise.all([
      personIds.length > 0
        ? db.from("profiles").select("id,first_name,display_name").in(
          "id",
          personIds,
        )
        : Promise.resolve({ data: [], error: null }),
      brandIds.length > 0
        ? db.from("brands").select("id,name").in("id", brandIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profiles.error || brands.error) {
      // Names are presentation only; the cards fall back to unnamed copy.
      console.warn("[ad-plan] creative_library names unavailable", {
        profiles: profiles.error?.code ?? null,
        brands: brands.error?.code ?? null,
      });
    }
    return json({
      ok: true,
      creatives: decorateLibraryRows(projected, creativeRows, {
        profiles: new Map(
          ((profiles.data ?? []) as Record<string, unknown>[]).map((row) => [
            String(row.id),
            row,
          ]),
        ),
        brands: new Map(
          ((brands.data ?? []) as { id: string; name: string }[]).map((row) => [
            row.id,
            row.name,
          ]),
        ),
      }),
      pending,
      counts,
      next_cursor: nextCursor,
    });
  }

  if (action === "creative_reuse") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const creativeId = typeof body.creative_id === "string"
      ? body.creative_id
      : "";
    if (!UUID_RE.test(creativeId)) {
      return json(
        { error: "validation_error", detail: "creative_id_invalid" },
        400,
      );
    }
    const { data: creative, error } = await db.from("ad_creatives").select(
      "id,name,kind,status,source_url,storage_bucket,storage_path,bunny_video_id,poster_url,mp4_master_url,duration_seconds,aspect_ratio,width,height,has_audio,mime_type,byte_size,ai_generated,variants,brand_id,source,source_brand_id,source_job_id,source_job_ref,purged_at,created_at,updated_at",
    ).eq("id", creativeId).maybeSingle();
    if (error) return databaseFailure(error);
    // #3697 — a new selection refuses archived (409) and purged (410) media.
    // Fit is never checked here: a misfit stays reusable from the library and
    // is blocked only inside the Builder and at the funding gate.
    const selectionError = creativeSelectionError(creative, { frozen: false });
    if (selectionError || !creative) {
      return json(
        { error: selectionError?.error ?? "creative_not_reusable" },
        selectionError?.status ?? 409,
      );
    }
    const ownershipError = adCreativeOwnershipError({
      ownerKind: "mingla",
      planBrandId: null,
      creativeBrandId: creative.brand_id,
      creativeSource: creative.source,
      creativeSourceBrandId: creative.source_brand_id,
    });
    if (ownershipError) {
      return json({ error: ownershipError }, 409);
    }
    const requestedPlatforms = Array.isArray(body.platforms)
      ? body.platforms.filter(isPlatform)
      : [];
    const reusable: Record<string, unknown> = { ...creative };
    delete reusable.purged_at;
    reusable.source_job_id = creative.source_job_id ?? creative.source_job_ref ??
      null;
    return json({
      ok: true,
      creative: reusable,
      // The Builder's per-channel report, from the probe facts stored when the
      // creative was made (server truth; no client-supplied media is read).
      validation: storedCreativeValidation(
        creative,
        requestedPlatforms.length > 0 ? requestedPlatforms : PLATFORMS,
      ),
    });
  }

  if ((LIFECYCLE_ACTIONS as readonly string[]).includes(action)) {
    const result = await handleCreativeLifecycleAction(
      action as (typeof LIFECYCLE_ACTIONS)[number],
      body,
      {
        db,
        actor,
        isActiveAdmin: () => isActiveAdmin(db, actor),
        canBrandPlan: async (brandId) => {
          const { data, error } = await db.rpc("ad_can_host_action", {
            p_brand_id: brandId,
            p_user_id: actor.id,
            p_action: "plan",
          });
          return !error && data === true;
        },
        // The one guarded provider delete: it re-reads every live reference.
        // Invariant I-VIDEO-SINGLE-GUARDED-DELETE (declared in supabase/functions/_shared/__tests__/coverVideoReap.singleDeletePath.issue3040.test.ts)
        destroyMedia: (row) => destroyIfUnreferenced(db, row, deps.reapDeps),
      },
    );
    return json(result.body, result.status);
  }

  if (action === "review_queue") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const { data: plans, error: plansError } = await db.from("ad_plans")
      .select("*").eq("state", "staff_review_required")
      .order("updated_at", { ascending: true }).limit(100);
    if (plansError) return databaseFailure(plansError);
    const versionIds = (plans ?? []).map((
      row: { current_version_id?: string },
    ) => row.current_version_id).filter((id: unknown): id is string =>
      typeof id === "string"
    );
    if (versionIds.length === 0) return json({ ok: true, queue: [] });
    const [versions, allocations, targeting, holds] = await Promise.all([
      db.from("ad_plan_versions").select("*").in("id", versionIds),
      db.from("ad_plan_provider_allocations").select("*")
        .in("plan_version_id", versionIds).order("platform"),
      db.from("ad_plan_targeting_snapshots").select("*")
        .in("plan_version_id", versionIds).order("platform"),
      db.from("ad_plan_funding_holds").select("*")
        .in("plan_version_id", versionIds),
    ]);
    const firstError = versions.error ?? allocations.error ?? targeting.error ??
      holds.error;
    if (firstError) return databaseFailure(firstError);
    const queue = (plans ?? []).map((plan: Record<string, unknown>) => {
      const versionId = String(plan.current_version_id ?? "");
      return {
        plan,
        version: (versions.data ?? []).find((row: { id: string }) =>
          row.id === versionId
        ) ?? null,
        provider_allocations: (allocations.data ?? []).filter(
          (row: { plan_version_id: string }) =>
            row.plan_version_id === versionId,
        ),
        targeting_snapshots: (targeting.data ?? []).filter(
          (row: { plan_version_id: string }) =>
            row.plan_version_id === versionId,
        ),
        funding_hold: (holds.data ?? []).find(
          (row: { plan_version_id: string }) =>
            row.plan_version_id === versionId,
        ) ?? null,
      };
    });
    return json({ ok: true, queue });
  }

  if (action === "recovery_queue") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const states = [
      "ready_for_funding",
      "funded_held",
      "creating_paused_objects",
      "creation_failed_retryable",
      "creation_failed_terminal",
    ];
    const { data: plans, error } = await db.from("ad_plans").select("*")
      .eq("owner_kind", "mingla").in("state", states)
      .order("updated_at", { ascending: true }).limit(25);
    if (error) return databaseFailure(error);
    const queue = await Promise.all(
      (plans ?? []).map((plan: Plan) => getPlanAggregate(db, plan)),
    );
    return json({ ok: true, queue });
  }

  if (action === "open") {
    const clientKind = body.client_kind;
    const ownerKind = body.owner_kind;
    const brandId = typeof body.brand_id === "string" ? body.brand_id : null;
    if (
      !["admin", "host", "ari"].includes(String(clientKind)) ||
      !["mingla", "host"].includes(String(ownerKind)) ||
      typeof body.destination_family !== "string" ||
      typeof body.destination_key !== "string"
    ) {
      return json(
        { error: "validation_error", detail: "plan_open_invalid" },
        400,
      );
    }
    if (ownerKind === "mingla") {
      if (!(await isActiveAdmin(db, actor))) {
        return json({ error: "forbidden" }, 403);
      }
    } else {
      if (!brandId || !UUID_RE.test(brandId)) {
        return json(
          { error: "validation_error", detail: "brand_id_invalid" },
          400,
        );
      }
      const { data: allowed } = await db.rpc("ad_can_host_action", {
        p_brand_id: brandId,
        p_user_id: actor.id,
        p_action: "plan",
      });
      if (allowed !== true) return json({ error: "forbidden" }, 403);
    }
    const riskReasons =
      ownerKind === "mingla" && Array.isArray(body.risk_reasons)
        ? body.risk_reasons
        : [];
    const { data, error } = await db.rpc("ad_plan_open", {
      p_client_kind: clientKind,
      p_owner_kind: ownerKind,
      p_brand_id: brandId,
      p_destination_family: body.destination_family,
      p_destination_key: body.destination_key,
      p_risk_reasons: riskReasons,
      p_actor_id: actor.id,
    });
    return error ? databaseFailure(error) : json({ ok: true, plan: data }, 201);
  }

  if (action === "list") {
    const brandId = typeof body.brand_id === "string" ? body.brand_id : null;
    let query = db.from("ad_plans").select("*").order("updated_at", {
      ascending: false,
    }).limit(100);
    if (brandId) {
      if (!UUID_RE.test(brandId)) {
        return json(
          { error: "validation_error", detail: "brand_id_invalid" },
          400,
        );
      }
      const { data: allowed } = await db.rpc("ad_can_host_action", {
        p_brand_id: brandId,
        p_user_id: actor.id,
        p_action: "read",
      });
      if (allowed !== true) return json({ error: "forbidden" }, 403);
      query = query.eq("brand_id", brandId).eq("owner_kind", "host");
    } else if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const { data, error } = await query;
    if (error) return databaseFailure(error);
    let drafts: Record<string, unknown>[] = [];
    if (brandId && body.include_drafts === true) {
      const result = await db.from("ad_plan_drafts").select(
        "id,plan_id,revision,current_step,draft_state,updated_at",
      ).eq("brand_id", brandId).eq("owner_kind", "host").eq(
        "created_by",
        actor.id,
      ).eq("status", "active").order("updated_at", { ascending: false })
        .limit(100);
      if (result.error) return databaseFailure(result.error);
      drafts = result.data ?? [];
    }
    return json({ ok: true, plans: data ?? [], drafts });
  }

  if (action === "list_destinations") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const family = typeof body.destination_family === "string"
      ? body.destination_family.trim()
      : "";
    const certificationMode = body.certification_mode === true;
    const platforms = parsePlatformList(body.platforms);
    if (!platforms) {
      return json(
        { error: "validation_error", detail: "destination_platforms_invalid" },
        400,
      );
    }
    let query = db.from("ad_destination_registry").select(
      "id,destination_family,destination_key,title,canonical_url,result_kind,app_key,os,status,metadata",
    ).eq("status", "active").order("destination_family").order("title");
    if (family) query = query.eq("destination_family", family);
    const { data, error } = await query;
    if (error) return databaseFailure(error);
    const destinations = await Promise.all((data ?? []).map(async (row) => {
      const { data: resolved, error: resolveError } = await db.rpc(
        "ad_plan_destination_resolve",
        {
          p_destination_family: row.destination_family,
          p_destination_key: row.destination_key,
          p_platforms: platforms,
        },
      );
      const snapshot = asRecord(resolved);
      let effectiveSnapshot = snapshot;
      if (
        certificationMode && snapshot &&
        ["explorer_app", "host_app"].includes(String(row.destination_family))
      ) {
        const providerReadiness = await Promise.all(platforms.map(
          async (platform) => {
            const { data: ready, error: readinessError } = await db.rpc(
              "can_prepare_native_app_canary",
              {
                p_app_key: row.app_key,
                p_os: row.os,
                p_provider: platform,
              },
            );
            return {
              platform,
              ready: !readinessError && ready === true,
            };
          },
        ));
        const ready = providerReadiness.length > 0 &&
          providerReadiness.every((item) => item.ready);
        effectiveSnapshot = {
          ...snapshot,
          ready,
          code: ready ? null : "app_certification_readiness_required",
          provider_readiness: providerReadiness,
        };
      }
      return {
        ...row,
        ready: !resolveError && effectiveSnapshot?.ready === true,
        readiness_code: resolveError?.message ?? effectiveSnapshot?.code ??
          null,
        provider_readiness: Array.isArray(
            effectiveSnapshot?.provider_readiness,
          )
          ? effectiveSnapshot.provider_readiness
          : [],
        resolved_destination: resolveError ? null : effectiveSnapshot,
      };
    }));
    return json({
      ok: true,
      destinations,
      platforms,
      certification_mode: certificationMode,
    });
  }

  const planId = typeof body.plan_id === "string" ? body.plan_id : "";
  const versionId = typeof body.plan_version_id === "string"
    ? body.plan_version_id
    : "";

  if (action === "get") {
    const plan = await loadPlan(db, planId);
    if (!plan) return json({ error: "not_found" }, 404);
    if (!(await canAccessPlan(db, actor, plan, "read"))) {
      return json({ error: "forbidden" }, 403);
    }
    return json({ ok: true, ...(await getPlanAggregate(db, plan)) });
  }

  if (action === "create_version") {
    const plan = await loadPlan(db, planId);
    const requested = parseAllocations(body.provider_allocations);
    const canonicalInput = asRecord(body.canonical_plan);
    if (!plan || !requested || !canonicalInput) {
      return json(
        { error: "validation_error", detail: "plan_version_invalid" },
        400,
      );
    }
    const mediaRights = normalizeMediaRights(
      canonicalInput.media_rights,
      actor.id,
    );
    if (!mediaRights) {
      return json({
        error: "plan_preflight_failed",
        detail: "media_rights_attestation_required",
      }, 422);
    }
    if (!(await canAccessPlan(db, actor, plan, "plan"))) {
      return json({ error: "forbidden" }, 403);
    }
    const creativeId = typeof canonicalInput.creative_library_id === "string"
      ? canonicalInput.creative_library_id
      : "";
    if (!UUID_RE.test(creativeId)) {
      return json({
        error: "plan_preflight_failed",
        detail: "creative_library_id_required",
      }, 422);
    }
    const { data: creative, error: creativeError } = await db
      .from("ad_creatives")
      .select("id,brand_id,status,source,source_brand_id,purged_at")
      .eq("id", creativeId)
      .maybeSingle();
    if (creativeError) return databaseFailure(creativeError);
    // #3697 (C-13) — an archived creative stays usable for a plan whose
    // current version already carries it; a new selection refuses it.
    let carriedOver = false;
    if (creative?.status === "archived" && plan.current_version_id) {
      const current = await loadVersion(db, plan.current_version_id);
      carriedOver = current?.canonical_plan?.creative_library_id === creativeId;
    }
    const selectionError = creativeSelectionError(creative, {
      frozen: carriedOver,
    });
    if (selectionError || !creative) {
      return json({
        error: "plan_preflight_failed",
        detail: selectionError?.error ?? "creative_not_reusable",
      }, 422);
    }
    const ownershipError = adCreativeOwnershipError({
      ownerKind: plan.owner_kind,
      planBrandId: plan.brand_id,
      creativeBrandId: creative.brand_id,
      creativeSource: creative.source,
      creativeSourceBrandId: creative.source_brand_id,
    });
    if (ownershipError) {
      return json(
        { error: "plan_preflight_failed", detail: ownershipError },
        422,
      );
    }
    const normalized = await normalizedAllocations(db, plan, requested);
    if (!normalized.ok) {
      return json(
        { error: "plan_preflight_failed", detail: normalized.detail },
        normalized.status,
      );
    }
    const hostBudget = requested.reduce(
      (sum, row) => sum + row.host_budget_cents,
      0,
    );
    if (!Number.isSafeInteger(hostBudget)) {
      return json(
        { error: "validation_error", detail: "budget_overflow" },
        400,
      );
    }
    const platforms = requested.map((row) => row.platform);
    const certificationMode = canonicalInput.certification_mode === true;
    if (
      certificationMode &&
      (plan.owner_kind !== "mingla" ||
        !["explorer_app", "host_app"].includes(plan.destination_family) ||
        platforms.length !== 1)
    ) {
      return json({
        error: "validation_error",
        detail: "certification_plan_scope_invalid",
      }, 400);
    }
    const canonical = canonicalizePlan(canonicalInput, platforms, {
      authority: plan.owner_kind === "host"
        ? "brand_settlement"
        : "provider_account",
      host_currency: normalized.hostCurrency,
      host_budget_cents: hostBudget,
    });
    canonical.media_rights = mediaRights;
    const { data: destination, error: destinationError } = await db.rpc(
      "ad_plan_destination_resolve",
      {
        p_destination_family: plan.destination_family,
        p_destination_key: plan.destination_key,
        p_platforms: platforms,
      },
    );
    const resolvedDestination = asRecord(destination);
    let certificationReady = false;
    if (certificationMode && resolvedDestination?.ok === true) {
      const { data: ready, error: readyError } = await db.rpc(
        "can_prepare_native_app_canary",
        {
          p_app_key: resolvedDestination.app_key,
          p_os: resolvedDestination.os,
          p_provider: platforms[0],
        },
      );
      certificationReady = !readyError && ready === true;
    }
    if (
      destinationError || !resolvedDestination ||
      resolvedDestination.ok !== true ||
      (certificationMode
        ? !certificationReady
        : resolvedDestination.ready !== true)
    ) {
      return json({
        error: "plan_preflight_failed",
        detail: destinationError?.message ??
          (certificationMode
            ? "app_certification_readiness_required"
            : resolvedDestination?.code ?? "destination_not_ready"),
      }, 422);
    }
    if (certificationMode) {
      resolvedDestination.ready = true;
      resolvedDestination.code = null;
      resolvedDestination.certification_mode = true;
    }
    canonical.destination = destination;
    canonical.measurement = buildAdMeasurementManifest(resolvedDestination);
    canonical.delivery_budgets = Object.fromEntries(
      normalized.rows.map((row) => [
        row.platform,
        {
          host_currency: normalized.hostCurrency,
          host_amount_cents: row.host_delivery_budget_cents,
          provider_amount_cents: row.provider_delivery_budget_cents,
        },
      ]),
    );
    const { data, error } = await db.rpc("ad_plan_create_version", {
      p_plan_id: plan.id,
      p_canonical_plan: canonical,
      p_host_budget_cents: hostBudget,
      p_host_currency: normalized.hostCurrency,
      p_provider_allocations: normalized.rows,
      p_actor_id: actor.id,
    });
    if (error) return databaseFailure(error);
    return json({
      ok: true,
      version: data,
      provider_allocations: normalized.rows,
    }, 201);
  }

  if (action === "freeze_targeting") {
    const authorized = await authorizeVersion(db, actor, versionId, "plan");
    const intent = asRecord(body.audience_intent) as AdAudienceIntent | null;
    const refsByPlatform = asRecord(body.refs_by_platform) as
      | Partial<Record<Platform, ProviderTargetingRefs>>
      | null;
    if (!authorized) return json({ error: "forbidden_or_not_found" }, 403);
    if (!intent || !Array.isArray(intent.countries)) {
      return json({
        error: "validation_error",
        detail: "audience_intent_invalid",
      }, 400);
    }
    const { plan, version } = authorized;
    if (plan.current_version_id !== version.id) {
      return json(
        { error: "plan_conflict", detail: "plan_version_stale" },
        409,
      );
    }
    const rawPlatforms = version.canonical_plan.platforms;
    if (
      !Array.isArray(rawPlatforms) ||
      rawPlatforms.some((item) => !isPlatform(item))
    ) {
      return json(
        { error: "plan_conflict", detail: "plan_platforms_invalid" },
        409,
      );
    }
    const platforms = rawPlatforms as Platform[];
    const resolvedRefs = await withServerTargetingCoordinates(
      intent,
      refsByPlatform ?? {},
      platforms,
    );
    const compiled = compileTargetingPlan({
      platforms,
      intent,
      refsByPlatform: resolvedRefs,
      campaignKind: plan.destination_family === "explorer_app" ||
          plan.destination_family === "host_app"
        ? "native_app"
        : "web",
    });
    const broaderAcceptance =
      asRecord(version.canonical_plan.broader_acceptance) ?? {};
    const frozenAt = new Date().toISOString();
    const baseRows = compiled.map((row) => {
      const accepted = row.verdict === "broader" &&
        broaderAcceptance[row.platform] === true;
      return {
        plan_version_id: version.id,
        platform: row.platform,
        audience_intent: row.audienceIntent,
        compiled_targeting: row.compiledTargeting,
        verdict: row.verdict,
        widening_summary: row.wideningSummary,
        checks_required: row.checksRequired,
        broader_accepted: accepted,
        broader_accepted_by: accepted ? actor.id : null,
        broader_accepted_at: accepted ? frozenAt : null,
        evidence_observed_at: frozenAt,
        compiler_version: row.compilerVersion,
      };
    });
    const { data: existing, error: existingError } = await db
      .from("ad_plan_targeting_snapshots").select("*")
      .eq("plan_version_id", version.id).order("platform");
    if (existingError) return databaseFailure(existingError);
    if ((existing ?? []).length > 0) {
      const same = (existing ?? []).length === baseRows.length &&
        baseRows.every((row) => {
          const frozen = (existing ?? []).find((
            item: Record<string, unknown>,
          ) => item.platform === row.platform);
          return frozen && frozen.verdict === row.verdict &&
            JSON.stringify(frozen.audience_intent) ===
              JSON.stringify(row.audience_intent) &&
            JSON.stringify(frozen.compiled_targeting) ===
              JSON.stringify(row.compiled_targeting) &&
            frozen.broader_accepted === row.broader_accepted;
        });
      if (!same) {
        return json({
          error: "plan_conflict",
          detail: "targeting_already_frozen_create_new_version",
        }, 409);
      }
      return json({
        ok: true,
        targeting_snapshots: existing,
        idempotent: true,
      });
    }
    const { data: allocations, error: allocationsError } = await db
      .from("ad_plan_provider_allocations")
      .select("platform,connection_id,provider_budget_cents")
      .eq("plan_version_id", version.id);
    if (allocationsError) return databaseFailure(allocationsError);
    const connectionIds = (allocations ?? []).map((
      row: Record<string, unknown>,
    ) => row.connection_id).filter((value: unknown): value is string =>
      typeof value === "string"
    );
    const { data: connections, error: connectionsError } = await db
      .from("ad_connections").select("*").in("id", connectionIds);
    if (connectionsError) return databaseFailure(connectionsError);
    const allocationByPlatform = new Map(
      (allocations ?? []).map((row: Record<string, unknown>) => [
        row.platform,
        row,
      ]),
    );
    const connectionById = new Map(
      (connections ?? []).map((row: Record<string, unknown>) => [row.id, row]),
    );
    const estimateInputs = compiled.map((row) => {
      const allocation = allocationByPlatform.get(row.platform);
      const connectionId = allocation?.connection_id;
      const connection = typeof connectionId === "string"
        ? connectionById.get(connectionId)
        : null;
      const providerBudgetCents = Number(allocation?.provider_budget_cents);
      if (
        !allocation || !connection ||
        !Number.isSafeInteger(providerBudgetCents) ||
        providerBudgetCents <= 0
      ) return null;
      return estimateInputFromTargeting({
        compiled: row,
        connection: connection as unknown as AdConnectionRow,
        providerBudgetCents,
      });
    });
    if (estimateInputs.some((input) => input === null)) {
      return json({
        error: "plan_conflict",
        detail: "provider_allocation_or_connection_missing",
      }, 409);
    }
    const estimates = await Promise.all(
      estimateInputs.map((input) => fetchProviderAudienceEstimate(input!)),
    );
    const rows = baseRows.map((row, index) => ({
      ...row,
      provider_estimate: estimates[index],
      estimate_observed_at: frozenAt,
    }));
    const { data, error } = await db.from("ad_plan_targeting_snapshots")
      .insert(rows).select("*");
    return error
      ? databaseFailure(error)
      : json({ ok: true, targeting_snapshots: data ?? [] }, 201);
  }

  const requiredAction: HostAdAction = action === "fund"
    ? "fund"
    : action === "review"
    ? "review"
    : action === "confirm_launch" || action === "assert_launchable" ||
        action === "record_create_failure"
    ? "launch"
    : action === "cancel_before_create" || action === "request_stop"
    ? "end"
    : "plan";
  const authorized = versionId
    ? await authorizeVersion(db, actor, versionId, requiredAction)
    : null;
  if (!authorized) return json({ error: "forbidden_or_not_found" }, 403);
  const planHash = typeof body.plan_hash === "string" ? body.plan_hash : "";
  if (planHash !== authorized.version.plan_hash) {
    return json({
      error: "plan_conflict",
      detail: "plan_version_hash_mismatch",
    }, 409);
  }

  if (action === "record_create_failure") {
    const platform = body.platform;
    if (!isPlatform(platform)) {
      return json(
        { error: "validation_error", detail: "platform_invalid" },
        400,
      );
    }
    const [{ data: allocation }, { data: existingCampaign }] = await Promise
      .all([
        db.from("ad_plan_provider_allocations").select("platform")
          .eq("plan_version_id", versionId).eq("platform", platform)
          .maybeSingle(),
        db.from("ad_campaigns").select("id")
          .eq("plan_version_id", versionId).eq("plan_hash", planHash)
          .eq("platform", platform).maybeSingle(),
      ]);
    if (!allocation) {
      return json(
        { error: "plan_conflict", detail: "provider_allocation_missing" },
        409,
      );
    }
    if (existingCampaign) {
      return json(
        { error: "plan_conflict", detail: "provider_campaign_already_exists" },
        409,
      );
    }
    const detail = typeof body.error_detail === "string"
      ? body.error_detail.trim().slice(0, 500)
      : "provider_create_failed";
    const { data: failureEvents, error: failureEventsError } = await db
      .from("ad_status_events")
      .select("action,external_ids,provider_response,created_at")
      .is("campaign_id", null)
      .eq("platform", platform)
      .in("action", ["create_failed", "rollback"])
      .contains("external_ids", { plan_version_id: versionId })
      .order("created_at", { ascending: false })
      .limit(5);
    if (failureEventsError) return databaseFailure(failureEventsError);
    const matchingFailure = (failureEvents ?? []).find((event) => {
      const ids = asRecord(event.external_ids);
      return ids?.plan_version_id === versionId && ids?.plan_hash === planHash;
    });
    const recordedIds = matchingFailure?.action === "create_failed"
      ? { ...(asRecord(matchingFailure.external_ids) ?? {}) }
      : {};
    delete recordedIds.plan_version_id;
    delete recordedIds.plan_hash;
    const reconciliationRequired = Object.keys(recordedIds).length > 0;
    const attemptState = reconciliationRequired
      ? "failed_terminal"
      : "failed_retryable";
    const { data: attempt, error: attemptError } = await db.rpc(
      "ad_record_provider_attempt",
      {
        p_plan_version_id: versionId,
        p_plan_hash: planHash,
        p_platform: platform,
        p_command: "create_paused_objects",
        p_idempotency_key: `${planHash}:${platform}:create`,
        p_state: attemptState,
        p_external_ids: recordedIds,
        p_provider_response: matchingFailure
          ? asRecord(matchingFailure.provider_response)
          : null,
        p_error_detail: detail || "provider_create_failed",
      },
    );
    if (attemptError) return databaseFailure(attemptError);
    const { data: plan, error: stateError } = await db.from("ad_plans")
      .update({
        state: reconciliationRequired
          ? "creation_failed_terminal"
          : "creation_failed_retryable",
      })
      .eq("id", authorized.plan.id)
      .eq("current_version_id", versionId)
      .in("state", ["creating_paused_objects", "creation_failed_retryable"])
      .select("*").maybeSingle();
    if (stateError) return databaseFailure(stateError);
    return plan
      ? json({
        ok: true,
        plan,
        provider_attempt: attempt,
        reconciliation_required: reconciliationRequired,
      })
      : json({ error: "plan_conflict", detail: "create_state_invalid" }, 409);
  }

  // #3697 FG-1 — the server backstop of the Builder's misfit block: no plan
  // reaches funding with a video that does not fit an allocated platform.
  if (action === "mark_ready" || action === "fund") {
    const gate = await fundingFitGate(db, authorized.version);
    if (gate) return gate;
  }

  if (action === "mark_ready") {
    const { data, error } = await db.rpc("ad_plan_mark_ready", {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
    });
    return error ? databaseFailure(error) : json({ ok: true, plan: data });
  }

  if (action === "fund") {
    const rpc = authorized.plan.owner_kind === "host"
      ? "ad_plan_hold_host_funds"
      : "ad_plan_mark_admin_funded";
    const args = authorized.plan.owner_kind === "host"
      ? {
        p_plan_version_id: versionId,
        p_plan_hash: planHash,
        p_idempotency_key: typeof body.idempotency_key === "string"
          ? body.idempotency_key
          : req.headers.get("idempotency-key") ?? "",
        p_actor_id: actor.id,
      }
      : { p_plan_version_id: versionId, p_plan_hash: planHash };
    if (
      authorized.plan.owner_kind === "host" &&
      String(args.p_idempotency_key).trim().length < 8
    ) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }
    const { data, error } = await db.rpc(rpc, args);
    return error
      ? databaseFailure(error)
      : json({ ok: true, funding_hold: data });
  }

  if (action === "review") {
    if (!(await isActiveAdmin(db, actor))) {
      return json({ error: "forbidden" }, 403);
    }
    const { data, error } = await db.rpc("ad_plan_record_review", {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
      p_decision: body.decision,
      p_reason: typeof body.reason === "string" ? body.reason : null,
      p_decided_by: actor.id,
    });
    return error ? databaseFailure(error) : json({ ok: true, review: data });
  }

  if (action === "confirm_launch") {
    const { data, error } = await db.rpc("ad_plan_confirm_launch", {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
      p_phrase: typeof body.phrase === "string" ? body.phrase : "",
      p_confirmed_by: actor.id,
    });
    return error
      ? databaseFailure(error)
      : json({ ok: true, confirmation: data });
  }

  if (action === "cancel_before_create") {
    const key = typeof body.idempotency_key === "string"
      ? body.idempotency_key
      : req.headers.get("idempotency-key") ?? "";
    const phrase = typeof body.phrase === "string" ? body.phrase : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (phrase !== "CANCEL PLAN") {
      return json({
        error: "cancel_confirm_required",
        detail: "confirm_phrase_must_be_CANCEL_PLAN",
      }, 400);
    }
    if (reason.length === 0) {
      return json({
        error: "cancel_confirm_required",
        detail: "reason_required",
      }, 400);
    }
    if (key.trim().length < 8) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }
    const { data, error } = await db.rpc("ad_plan_cancel_before_create", {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
      p_idempotency_key: key,
      p_reason: reason.slice(0, 1000),
      p_actor_id: actor.id,
    });
    return error
      ? databaseFailure(error)
      : json({ ok: true, funding_hold: data });
  }

  if (action === "assert_launchable") {
    const { data, error } = await db.rpc("ad_plan_assert_launchable", {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
    });
    return error
      ? databaseFailure(error)
      : json({ ok: true, launch_contract: data });
  }

  if (action === "request_stop") {
    const campaignId = typeof body.campaign_id === "string"
      ? body.campaign_id
      : "";
    if (!UUID_RE.test(campaignId)) {
      return json(
        { error: "validation_error", detail: "campaign_id_invalid" },
        400,
      );
    }
    const { data: campaign } = await db.from("ad_campaigns")
      .select("plan_version_id, plan_hash").eq("id", campaignId).maybeSingle();
    if (
      campaign?.plan_version_id !== versionId ||
      campaign?.plan_hash !== planHash
    ) {
      return json(
        { error: "plan_conflict", detail: "campaign_plan_mismatch" },
        409,
      );
    }
    const { data, error } = await db.rpc("ad_request_campaign_stop", {
      p_campaign_id: campaignId,
    });
    return error
      ? databaseFailure(error)
      : json({ ok: true, settlement: data });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
}

if (import.meta.main) {
  serve((req: Request) => handleAdPlan(req));
}
