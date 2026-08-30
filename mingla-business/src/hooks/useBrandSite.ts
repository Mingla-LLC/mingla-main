import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStudioExchange,
  createBrandSitePreview,
  getBrandSiteAnalytics,
  getBrandSiteVersions,
  getBrandSite,
  publishBrandSite,
  provisionBrandSite,
  rollbackBrandSite,
  validateBrandSiteDraft,
} from "../services/brandSitesService";
import { useAuth } from "../context/AuthContext";

export const brandSiteKeys = {
  all: ["brand-sites"] as const,
  detail: (brandId: string) => ["brand-sites", brandId] as const,
};

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
    mutationFn: () => provisionBrandSite(brandId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: brandSiteKeys.detail(brandId),
      });
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
    mutationFn: async () => {
      if (!siteId) throw new Error("Website unavailable");
      const draft = await validateBrandSiteDraft({ brandId, siteId });
      return createBrandSitePreview({
        siteId,
        expectedRevision: draft.home_revision,
        sourceDigest: draft.draft_digest,
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
    mutationFn: async () => {
      if (!siteId) throw new Error("Website unavailable");
      const draft = await validateBrandSiteDraft({ brandId, siteId });
      return publishBrandSite({
        siteId,
        expectedRevision: draft.home_revision,
        sourceDigest: draft.draft_digest,
        argumentsDigest: "",
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
