/**
 * #2829 W9a — the website plan's service calls and hooks. Imported ONLY by
 * the Website section (website/sections/PlanSection.tsx), so Metro keeps it, the
 * plan screens and site-contracts' plan vocabulary in that one route chunk:
 * nothing here is shared with — or hoisted into — the boot payload (#3493).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  BrandSitesError,
  brandSitesErrorFrom,
  createBrandSiteOperationId,
  failureFromInvokeError,
  invokeBrandSiteControl,
} from "../services/brandSitesService";
import { brandSiteKeys } from "./brandSiteKeys";
import { normalizeSitePlan, type SitePlanState } from "./sitePlanState";
import { useEnsureBrandSiteDraft } from "../hooks/useBrandSite";

/*
 * #2829 W9a — the website plan (brand-site-control). Core checks every rank,
 * the lock and the revision; the answer is normalized once.
 */
export async function getBrandSitePlan(brandId: string): Promise<SitePlanState> {
  return normalizeSitePlan(brandId, await invokeBrandSiteControl<unknown>(`/v1/brands/${brandId}/site-plan`, "GET"));
}

/** A revision conflict carries Core's latest plan, so the screen re-shows it. */
export class BrandSitePlanConflict extends BrandSitesError {
  constructor(readonly latest: SitePlanState | null) {
    super("REVISION_CONFLICT", "Your website plan changed on another device. Here is the latest.", false);
    this.name = "BrandSitePlanConflict";
  }
}

export type SitePlanPatch = {
  offerings_selected?: string[];
  venue_descriptor?: string | null;
  story?: { who?: string; why?: string; main_action?: string } | null;
  approve?: boolean;
  approved_plan?: Record<string, string>;
  skipped_parts?: string[];
  active_part?: string | null;
};

export async function saveBrandSitePlan(input: {
  brandId: string;
  revision: number;
  patch: SitePlanPatch;
}): Promise<SitePlanState> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: unknown }>(
    "brand-site-control",
    { body: { route: `/v1/brands/${input.brandId}/site-plan`, method: "POST", revision: input.revision, patch: input.patch } },
  );
  if (error !== null) {
    const context = (error as { context?: { status?: unknown; json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } } }).context;
    if (context?.status === 409 && typeof context.json === "function") {
      const body = await (typeof context.clone === "function" ? context.clone().json() : context.json()).catch(() => null) as
        | { error?: { code?: unknown }; latest?: unknown }
        | null;
      if (body?.error?.code === "REVISION_CONFLICT") {
        throw new BrandSitePlanConflict(body.latest ? normalizeSitePlan(input.brandId, body.latest) : null);
      }
    }
    throw await failureFromInvokeError(error);
  }
  if (!data || data.ok !== true) throw brandSitesErrorFrom(null, data);
  return normalizeSitePlan(input.brandId, data.data);
}

/** #2830 — a plan-level design choice exists before any draft/site row. */
export async function saveBrandSitePlanDesign(input: {
  brandId: string;
  revision: number;
  designKey: "atelier" | "voyage";
}): Promise<SitePlanState> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: unknown }>(
    "brand-site-control",
    {
      body: {
        route: `/v1/brands/${input.brandId}/site-plan/design`,
        method: "POST",
        revision: input.revision,
        design_key: input.designKey,
        source_type: "owner",
      },
    },
  );
  if (error !== null) throw await failureFromInvokeError(error);
  if (!data || data.ok !== true) throw brandSitesErrorFrom(null, data);
  return normalizeSitePlan(input.brandId, data.data);
}

export async function heartbeatBrandSitePlan(brandId: string): Promise<SitePlanState> {
  return normalizeSitePlan(brandId, await invokeBrandSiteControl<unknown>(`/v1/brands/${brandId}/site-plan/heartbeat`, "POST"));
}

export async function takeOverBrandSitePlan(brandId: string): Promise<SitePlanState> {
  return normalizeSitePlan(brandId, await invokeBrandSiteControl<unknown>(`/v1/brands/${brandId}/site-plan/take-over`, "POST"));
}

export async function requestBrandSiteStart(brandId: string): Promise<{ notified: number; alreadyAsked: boolean }> {
  const data = await invokeBrandSiteControl<{ notified?: unknown; already_asked?: unknown }>(`/v1/brands/${brandId}/site-start-request`, "POST");
  return { notified: typeof data?.notified === "number" ? data.notified : 0, alreadyAsked: data?.already_asked === true };
}

export async function composeBrandSiteFromPlan(brandId: string): Promise<{ siteId: string; pages: string[]; created: string[] }> {
  const data = await invokeBrandSiteControl<{ site_id?: unknown; pages?: unknown; created?: unknown }>(
    `/v1/brands/${brandId}/site/compose-from-plan`,
    "POST",
    { operation_id: createBrandSiteOperationId() },
  );
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return { siteId: String(data?.site_id ?? ""), pages: list(data?.pages), created: list(data?.created) };
}

/*
 * #2829 W9a — the website plan. Server state only (React Query, keys from the
 * factory). A part is ticked only when Core's answer says so: every mutation
 * writes Core's returned plan into the cache, never an optimistic guess.
 */
export function useBrandSitePlan(brandId: string, enabled = true) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.plan(brandId),
    enabled: isAuthReady && enabled && brandId.length > 0,
    staleTime: 0,
    retry: (failures, error) =>
      !(error instanceof BrandSitesError && (error.code === "FORBIDDEN" || error.code === "NOT_ENTITLED")) &&
      failures < 1,
    queryFn: () => getBrandSitePlan(brandId),
  });
}

function useApplyPlan(brandId: string) {
  const queryClient = useQueryClient();
  return async (state: SitePlanState) => {
    queryClient.setQueryData(brandSiteKeys.plan(brandId), state);
    // The Home to-do row and the site overview follow the plan.
    await queryClient.invalidateQueries({ queryKey: brandSiteKeys.planTodo(brandId) });
  };
}

export function useSaveBrandSitePlan(brandId: string) {
  const apply = useApplyPlan(brandId);
  return useMutation({
    mutationFn: (input: { revision: number; patch: SitePlanPatch }) =>
      saveBrandSitePlan({ brandId, ...input }),
    onSuccess: apply,
    onError: async (error) => {
      // A conflict re-shows the latest plan (the screen says what happened).
      if (error instanceof BrandSitePlanConflict && error.latest) await apply(error.latest);
    },
  });
}

export function useSaveBrandSitePlanDesign(brandId: string) {
  const apply = useApplyPlan(brandId);
  return useMutation({
    mutationFn: (input: { revision: number; designKey: "atelier" | "voyage" }) =>
      saveBrandSitePlanDesign({ brandId, ...input }),
    onSuccess: apply,
  });
}

/** Keeps (or takes a free) lock while the plan screen is open (rank 50). */
export function useBrandSitePlanHeartbeat(brandId: string) {
  const apply = useApplyPlan(brandId);
  return useMutation({ mutationFn: () => heartbeatBrandSitePlan(brandId), onSuccess: apply });
}

export function useTakeOverBrandSitePlan(brandId: string) {
  const apply = useApplyPlan(brandId);
  return useMutation({ mutationFn: () => takeOverBrandSitePlan(brandId), onSuccess: apply });
}

/** "Ask an admin to start it" (marketing and event managers). */
export function useRequestBrandSiteStart(brandId: string) {
  return useMutation({ mutationFn: () => requestBrandSiteStart(brandId) });
}

/**
 * "Create website draft": makes sure the draft site exists (the address
 * Core proposed; provisioning finishes in Studio), then composes the pages
 * from the approved plan. Core records "Build your pages" only after Studio
 * answered; the plan is re-read from Core afterwards.
 */
export function useComposeBrandSiteFromPlan(brandId: string) {
  const queryClient = useQueryClient();
  const ensure = useEnsureBrandSiteDraft(brandId);
  return useMutation({
    mutationFn: async () => {
      await ensure.mutateAsync();
      return composeBrandSiteFromPlan(brandId);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) }),
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) }),
      ]);
    },
  });
}
