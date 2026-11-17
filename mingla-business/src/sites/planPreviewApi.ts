/**
 * #4453 milestone 10 — "See your site in three styles" (SITES_PLAN_PREVIEW).
 * Core checks the flag, the caller's rank, the plan revision and the rate
 * limit; Studio composes and renders. Asking for a preview writes nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { invokeBrandSiteControl } from "../services/brandSitesService";
import type { DesignKey } from "../../../packages/site-contracts/src/designs.ts";
import { brandSiteKeys } from "./brandSiteKeys";

export type PlanPreviewPick = { key: DesignKey; rank: 1 | 2 | 3; reason: string };
export type PlanPreviewCard = { style: DesignKey; url: string; pages: { path: string; title: string }[]; pageLabels: string[] };
export type PlanPreviewState = {
  format: string;
  picks: PlanPreviewPick[];
  skippedLine: string;
  cards: PlanPreviewCard[];
  hasSamples: boolean;
};

type Raw = Record<string, unknown>;
const arr = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter((row): row is Raw => Boolean(row) && typeof row === "object") : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The plan host's address for one key and page (never another origin than Core named). */
export function planPreviewUrl(origin: string, key: string, path = ""): string {
  const query = new URLSearchParams({ k: key });
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean) query.set("path", clean);
  return `${origin}/plan-preview?${query.toString()}`;
}

export function normalizePlanPreview(raw: unknown): PlanPreviewState {
  const data = raw && typeof raw === "object" ? (raw as Raw) : {};
  const origin = str(data.preview_origin);
  const previews = arr(data.previews);
  return {
    format: str(data.format),
    picks: arr(data.picks).map((pick) => ({ key: str(pick.key) as DesignKey, rank: (Number(pick.rank) || 1) as 1 | 2 | 3, reason: str(pick.reason) })),
    skippedLine: str(data.skipped_line),
    hasSamples: data.has_samples === true,
    cards: /^https?:\/\//.test(origin)
      ? previews.map((row) => ({
        style: str(row.style) as DesignKey,
        url: planPreviewUrl(origin, str(row.key)),
        pages: arr(row.pages).map((page) => ({ path: str(page.path), title: str(page.title) })),
        pageLabels: Array.isArray(row.page_labels) ? row.page_labels.filter((label): label is string => typeof label === "string") : [],
      }))
      : [],
  };
}

export async function requestPlanPreviews(brandId: string, revision: number): Promise<PlanPreviewState> {
  return normalizePlanPreview(await invokeBrandSiteControl<unknown>(`/v1/brands/${brandId}/plan-previews`, "POST", { plan_revision: revision }));
}

/** One request per plan revision; the server keeps the renders 24 h, so this stays fresh for a day. */
export function usePlanPreviews(brandId: string, revision: number | null, enabled: boolean) {
  return useQuery({
    queryKey: brandSiteKeys.planPreview(brandId, revision),
    queryFn: () => requestPlanPreviews(brandId, revision as number),
    enabled: enabled && revision !== null,
    staleTime: 23 * 60 * 60 * 1000,
    retry: false,
  });
}
