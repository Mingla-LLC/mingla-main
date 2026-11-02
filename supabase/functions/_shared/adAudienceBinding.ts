/**
 * Issue #4238 wave 2 (I-4238-AUDIENCE-SERVER-BOUND) — the frozen-audience
 * binding check admin-ad-create-campaign runs before any provider call, on a
 * real create AND on validate_only. Provider audience ids enter a request only
 * through the plan version's server-resolved audience_selection.
 *
 * The rule itself (audienceBindingMismatch) stays pure in adListAudienceRules;
 * this module owns the reads it needs.
 */

import {
  audienceBindingMismatch,
  compiledAudienceIds,
  type PlatformBindingRow,
} from "./adListAudienceRules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type AudienceBindingVerdict =
  | { ok: true; prospectingAudienceIds: string[] }
  | { ok: false; detail: string };

/** Ready list-audience rows on this platform for the selected keys. */
async function loadBindingRows(
  supabase: Db,
  platform: string,
  includeKeys: string[],
): Promise<PlatformBindingRow[] | null> {
  if (includeKeys.length === 0) return [];
  const { data: defs, error: defsError } = await supabase
    .from("ad_list_audiences")
    .select("id,audience_key,owner_kind,brand_id,status")
    .in("audience_key", includeKeys);
  if (defsError) return null;
  const defRows = (defs ?? []) as Record<string, unknown>[];
  if (defRows.length === 0) return [];
  const { data: states, error: statesError } = await supabase
    .from("ad_list_audience_platforms")
    .select("audience_id,platform,state,provider_audience_id")
    .eq("platform", platform)
    .in("audience_id", defRows.map((row) => row.id));
  if (statesError) return null;
  return ((states ?? []) as Record<string, unknown>[]).flatMap((state) => {
    const def = defRows.find((row) => row.id === state.audience_id);
    return def && def.status === "active"
      ? [{
        provider_audience_id: typeof state.provider_audience_id === "string"
          ? state.provider_audience_id
          : null,
        platform: String(state.platform),
        state: String(state.state),
        audience_key: String(def.audience_key),
        owner_kind: String(def.owner_kind),
        brand_id: typeof def.brand_id === "string" ? def.brand_id : null,
      }]
      : [];
  });
}

/**
 * The frozen snapshot's audience ids must equal exactly the ready ids of the
 * version's selected keys (and, for Host plans, the plan brand's own).
 */
export async function frozenAudienceBinding(supabase: Db, input: {
  platform: string;
  canonicalPlan: unknown;
  compiled: unknown;
  ownerKind: string;
  planBrandId: string | null;
}): Promise<AudienceBindingVerdict> {
  const compiled = (input.compiled ?? {}) as Record<string, unknown>;
  const selection = (input.canonicalPlan as Record<string, unknown> | null)
    ?.audience_selection as Record<string, unknown> | undefined;
  const includeKeys = Array.isArray(selection?.include_keys)
    ? (selection.include_keys as unknown[]).filter((key): key is string =>
      typeof key === "string"
    )
    : [];
  const rows = await loadBindingRows(supabase, input.platform, includeKeys);
  if (rows === null) return { ok: false, detail: "audience_binding_unverified" };
  if (
    audienceBindingMismatch({
      platform: input.platform,
      compiled,
      includeKeys,
      ownerKind: input.ownerKind,
      planBrandId: input.planBrandId,
      rows,
    })
  ) {
    return { ok: false, detail: "audience_binding_mismatch" };
  }
  return {
    ok: true,
    prospectingAudienceIds: rows
      .filter((row) => row.state === "ready" && row.provider_audience_id)
      .map((row) => String(row.provider_audience_id)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * validate_only runs the same guard before any provider call. With no plan,
 * a request may carry no audience ids at all. With a plan, the frozen
 * snapshot must bind, and the request's own targeting may name only ids the
 * frozen snapshot carries.
 */
export async function validateOnlyAudienceBinding(supabase: Db, input: {
  platform: string;
  body: Record<string, unknown>;
  ownerKind: string;
  brandId: string | null;
}): Promise<AudienceBindingVerdict> {
  const requestIds = compiledAudienceIds(
    input.platform,
    (input.body.targeting ?? {}) as Record<string, unknown>,
  );
  const planVersionId = typeof input.body.plan_version_id === "string"
    ? input.body.plan_version_id.trim()
    : "";
  const planHash = typeof input.body.plan_hash === "string"
    ? input.body.plan_hash.trim().toLowerCase()
    : "";
  if (!UUID.test(planVersionId) || !/^[0-9a-f]{64}$/.test(planHash)) {
    return requestIds.length > 0
      ? { ok: false, detail: "audience_binding_mismatch" }
      : { ok: true, prospectingAudienceIds: [] };
  }
  const { data: version, error: versionError } = await supabase
    .from("ad_plan_versions")
    .select("id, plan_id, canonical_plan")
    .eq("id", planVersionId)
    .eq("plan_hash", planHash)
    .maybeSingle();
  if (versionError || !version) {
    return { ok: false, detail: "plan_version_hash_mismatch" };
  }
  const { data: plan } = await supabase.from("ad_plans")
    .select("id, owner_kind, brand_id")
    .eq("id", version.plan_id).maybeSingle();
  const { data: snapshot } = await supabase
    .from("ad_plan_targeting_snapshots")
    .select("compiled_targeting")
    .eq("plan_version_id", planVersionId)
    .eq("platform", input.platform)
    .maybeSingle();
  if (
    !plan || !snapshot || plan.owner_kind !== input.ownerKind ||
    (input.ownerKind === "host" && plan.brand_id !== input.brandId)
  ) {
    return { ok: false, detail: "plan_binding_incomplete" };
  }
  const verdict = await frozenAudienceBinding(supabase, {
    platform: input.platform,
    canonicalPlan: version.canonical_plan,
    compiled: snapshot.compiled_targeting,
    ownerKind: String(plan.owner_kind),
    planBrandId: typeof plan.brand_id === "string" ? plan.brand_id : null,
  });
  if (!verdict.ok) return verdict;
  const frozen = new Set(compiledAudienceIds(
    input.platform,
    (snapshot.compiled_targeting ?? {}) as Record<string, unknown>,
  ));
  if (requestIds.some((id) => !frozen.has(id))) {
    return { ok: false, detail: "audience_binding_mismatch" };
  }
  return verdict;
}
