/**
 * #4453 milestone 10 — "See your site in three styles" (SITES_PLAN_PREVIEW).
 * Core checks the flag, the caller's rank, the plan revision and the rate
 * limit; Studio composes and renders. Asking for a preview writes nothing.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/** `styles` (at most three) asks for those styles instead of Ari's picks (Core refuses an "avoid" style). */
export async function requestPlanPreviews(brandId: string, revision: number, styles?: readonly DesignKey[]): Promise<PlanPreviewState> {
  const body = styles && styles.length > 0 ? { plan_revision: revision, styles: styles.slice(0, 3) } : { plan_revision: revision };
  return normalizePlanPreview(await invokeBrandSiteControl<unknown>(`/v1/brands/${brandId}/plan-previews`, "POST", body));
}

/** One request per plan revision; the server keeps the renders 24 h, so this stays fresh for a day. */
export function usePlanPreviews(brandId: string, revision: number | null, enabled: boolean, styles?: readonly DesignKey[]) {
  return useQuery({
    queryKey: brandSiteKeys.planPreview(brandId, revision, styles),
    queryFn: () => requestPlanPreviews(brandId, revision as number, styles),
    enabled: enabled && revision !== null,
    staleTime: 23 * 60 * 60 * 1000,
    retry: false,
  });
}

/** Core's answer kept for one style (the shape the style preview reads). */
function forStyle(answer: PlanPreviewState, style: DesignKey): PlanPreviewState {
  return { ...answer, cards: answer.cards.filter((card) => card.style === style) };
}

/**
 * #4453 — which styles one request asks for: the wanted style first, then up
 * to two more not yet loaded, in the picker's order from the wanted one on.
 * Core counts every request (3 a minute, 20 a day per brand) and composes up
 * to three styles each, so ten styles cost about three requests, not ten.
 */
export function previewBatch(style: DesignKey, queue: readonly DesignKey[], loaded: (style: DesignKey) => boolean): DesignKey[] {
  const start = Math.max(0, queue.indexOf(style));
  const ordered = [...queue.slice(start), ...queue.slice(0, start)];
  return [style, ...ordered.filter((key) => key !== style && !loaded(key))].slice(0, 3);
}

/**
 * #4453 — the live preview of one style in "Choose your design". Reuses a
 * render the three-style chooser already has, asks for neighbours in the same
 * request and files each answer under its own style, so clicking through the
 * styles stays inside Core's rate limit.
 */
export function useStylePreview(brandId: string, revision: number | null, style: DesignKey | null, enabled: boolean, queue: readonly DesignKey[]) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: brandSiteKeys.planPreview(brandId, revision, style ? [style] : undefined),
    enabled: enabled && revision !== null && style !== null,
    staleTime: 23 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const wanted = style as DesignKey;
      const rev = revision as number;
      const picks = queryClient.getQueryData<PlanPreviewState>(brandSiteKeys.planPreview(brandId, rev));
      if (picks?.cards.some((card) => card.style === wanted)) return forStyle(picks, wanted);
      const loaded = (key: DesignKey) =>
        queryClient.getQueryData(brandSiteKeys.planPreview(brandId, rev, [key])) !== undefined ||
        Boolean(picks?.cards.some((card) => card.style === key));
      const answer = await requestPlanPreviews(brandId, rev, previewBatch(wanted, queue, loaded));
      for (const card of answer.cards) {
        if (card.style !== wanted) queryClient.setQueryData(brandSiteKeys.planPreview(brandId, rev, [card.style]), forStyle(answer, card.style));
      }
      return forStyle(answer, wanted);
    },
  });
}
