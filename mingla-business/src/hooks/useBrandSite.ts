import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrandSitesError,
  createStudioExchange,
  createBrandSitePreview,
  getBrandSiteOperation,
  getBrandSiteAnalytics,
  getBrandSiteVersions,
  getBrandSite,
  publishBrandSite,
  PROVISION_POLL_WINDOW_MS,
  provisionBrandSite,
  rollbackBrandSite,
  validateBrandSiteDraft,
} from "../services/brandSitesService";
import { useAuth } from "../context/AuthContext";

export const brandSiteKeys = {
  all: ["brand-sites"] as const,
  detail: (brandId: string) => ["brand-sites", brandId] as const,
};

/**
 * #3583 — a missing site id is a TYPED Website failure, not a bare Error.
 *
 * These three mutations used to throw `new Error("Website unavailable")`. The
 * route's error mapper only recognises `BrandSitesError`, so anything else fell
 * through to the "offline" branch that the network effect then cleared on the
 * next render — the silent path. The desktop rail could reach it for real:
 * it renders at >=1024px whether or not a website exists, and its Publishing
 * section's Check-draft button called `useValidateBrandSiteDraft` with a null
 * site id.
 *
 * The rail no longer offers those sections before setup exists, and the derive
 * no longer lets a panel outrank a missing site. This is the floor under both:
 * if a null site id ever reaches a mutation again, it surfaces as a real,
 * actionable message instead of nothing.
 */
function siteUnavailable(): BrandSitesError {
  return new BrandSitesError(
    "SITE_UNAVAILABLE",
    "Mingla could not find this brand\u2019s website.",
    false,
  );
}

export function useBrandSite(brandId: string, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.detail(brandId),
    enabled: isAuthReady && enabled,
    staleTime: 30_000,
    queryFn: () => getBrandSite(brandId),
  });
}

export function useProvisionBrandSite(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (operationId: string) =>
      provisionBrandSite(brandId, operationId),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: brandSiteKeys.detail(brandId),
      });
    },
  });
}

export function useBrandSiteOperation(
  siteId: string | null,
  operationId: string | null,
  startedAt: number | null,
) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: [...brandSiteKeys.all, siteId, "operation", operationId],
    enabled: isAuthReady && siteId !== null && operationId !== null,
    queryFn: () => getBrandSiteOperation(siteId!, operationId!),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      return startedAt !== null &&
          Date.now() - startedAt < PROVISION_POLL_WINDOW_MS
        ? 2_000
        : false;
    },
  });
}

export function useStudioExchange(brandId: string) {
  return useMutation({
    mutationFn: () => createStudioExchange(brandId),
  });
}

export function useBrandSitePreview(brandId: string, siteId: string | null) {
  return useMutation({
    mutationFn: async (returnSurface: "web" | "native") => {
      if (!siteId) throw siteUnavailable();
      const draft = await validateBrandSiteDraft({ brandId, siteId });
      return createBrandSitePreview({
        siteId,
        expectedRevision: draft.home_revision,
        sourceDigest: draft.draft_digest,
        returnSurface,
      });
    },
  });
}


export function useBrandSiteVersions(siteId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: [...brandSiteKeys.all, siteId, "versions"],
    enabled: isAuthReady && enabled && siteId !== null,
    queryFn: () => getBrandSiteVersions(siteId!),
    staleTime: 30_000,
  });
}

export function useBrandSiteAnalytics(siteId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: [...brandSiteKeys.all, siteId, "analytics"],
    enabled: isAuthReady && enabled && siteId !== null,
    queryFn: () => getBrandSiteAnalytics(siteId!),
    staleTime: 60_000,
  });
}

export function usePublishBrandSite(brandId: string, siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      operationId: string;
      validation: Awaited<ReturnType<typeof validateBrandSiteDraft>>;
    }) => {
      if (!siteId) throw siteUnavailable();
      return publishBrandSite({
        siteId,
        operationId: input.operationId,
        expectedRevision: input.validation.home_revision,
        sourceDigest: input.validation.draft_digest,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) });
    },
  });
}

export function useRollbackBrandSite(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rollbackBrandSite,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) });
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.all });
    },
  });
}

export function useValidateBrandSiteDraft(
  brandId: string,
  siteId: string | null,
) {
  return useMutation({
    mutationFn: async () => {
      if (!siteId) throw siteUnavailable();
      return validateBrandSiteDraft({ brandId, siteId });
    },
  });
}
