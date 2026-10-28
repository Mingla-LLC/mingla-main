import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrandSitesError,
  createStudioExchange,
  createBrandSitePreview,
  getBrandSiteOperation,
  getBrandSiteAnalytics,
  getBrandSiteVersions,
  getBrandSite,
  getBrandSiteAvailability,
  getBrandSiteExport,
  proposeBrandSiteLabel,
  publishBrandSite,
  requestBrandSiteExport,
  setBrandSiteOffline,
  PROVISION_POLL_WINDOW_MS,
  provisionBrandSite,
  rollbackBrandSite,
  validateBrandSiteDraft,
  getBrandSiteLook,
  saveBrandSiteLook,
  searchBrandSiteFonts,
  getBrandSiteDomains,
  attachBrandSiteDomain,
  checkBrandSiteDomain,
  setPrimaryBrandSiteDomain,
  detachBrandSiteDomain,
  getBrandSite as readBrandSite,
  createBrandSiteOperationId,
  listBrandSiteShareLinks,
  createBrandSiteShareLink,
  revokeBrandSiteShareLink,
} from "../services/brandSitesService";
import { useAuth } from "../context/AuthContext";

// #2829 — every Website query key comes from ONE factory (Constitution 4),
// which lives in its own tiny module so Home's to-do can key the website
// row without loading the Website service (boot payload, #3493).
export { brandSiteKeys } from "../sites/brandSiteKeys";
import { brandSiteKeys } from "../sites/brandSiteKeys";

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

/**
 * #2829 (A5) — Core's capability answer for this member (entitlement + role).
 * A refusal (rank below 20, revoked brand) is final for the screen, so it is
 * not retried; anything else is retried once.
 */
export function useBrandSiteAvailability(brandId: string, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.availability(brandId),
    enabled: isAuthReady && enabled,
    staleTime: 30_000,
    retry: (failures, error) =>
      !(error instanceof BrandSitesError && error.code === "FORBIDDEN") &&
      failures < 1,
    queryFn: () => getBrandSiteAvailability(brandId),
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
  // #2829 W9f — a publish is tracked longer than a provision (it can outlive
  // the edge function's wait); the receipt stays the truth either way.
  pollWindowMs: number = PROVISION_POLL_WINDOW_MS,
) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.operation(siteId, operationId),
    enabled: isAuthReady && siteId !== null && operationId !== null,
    queryFn: () => getBrandSiteOperation(siteId!, operationId!),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      return startedAt !== null &&
          Date.now() - startedAt < pollWindowMs
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
    queryKey: brandSiteKeys.versions(siteId),
    enabled: isAuthReady && enabled && siteId !== null,
    queryFn: () => getBrandSiteVersions(siteId!),
    staleTime: 30_000,
  });
}

export function useBrandSiteAnalytics(siteId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.analytics(siteId),
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

/** #2829 — the address setup will create (or the existing one). */
export function useBrandSiteLabel(brandId: string, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.label(brandId),
    enabled: isAuthReady && enabled && brandId.length > 0,
    staleTime: 60_000,
    queryFn: () => proposeBrandSiteLabel(brandId),
  });
}

/** #2829 — take the site offline or bring it back online (rank 50). */
export function useSetBrandSiteOffline(brandId: string, siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { offline: boolean; operationId: string; reason?: string | null }) => {
      if (!siteId) throw siteUnavailable();
      return setBrandSiteOffline({ siteId, ...input });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) });
    },
  });
}

/** #2829 — "Download everything" (rank 50); resolves with the 24-hour link. */
export function useRequestBrandSiteExport(siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (operationId: string) => {
      if (!siteId) throw siteUnavailable();
      try {
        return await requestBrandSiteExport(siteId, operationId);
      } catch (error) {
        // A slow export can outlive the request; the receipt is the truth.
        if (error instanceof BrandSitesError && error.retryable) {
          return getBrandSiteExport(siteId, operationId);
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(brandSiteKeys.exports(siteId, result.operation_id), result);
    },
  });
}

const EXPORT_POLL_WINDOW_MS = 120_000;

/**
 * #2829 — follows a requested export until it succeeds or fails. The
 * mutation seeds this key; the receipt in Core stays the truth.
 */
export function useBrandSiteExport(
  siteId: string | null,
  operationId: string | null,
  startedAt: number | null,
) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.exports(siteId, operationId),
    enabled: isAuthReady && siteId !== null && operationId !== null,
    queryFn: () => {
      if (siteId === null || operationId === null) throw siteUnavailable();
      return getBrandSiteExport(siteId, operationId);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed" || status === "ambiguous") {
        return false;
      }
      return startedAt !== null && Date.now() - startedAt < EXPORT_POLL_WINDOW_MS
        ? 3_000
        : false;
    },
  });
}

/** #2829 W3 — the site's look (design, colours, fonts) from the draft. */
export function useBrandSiteLook(brandId: string, siteId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.look(siteId),
    enabled: isAuthReady && Boolean(siteId),
    staleTime: 0,
    queryFn: () => {
      if (!siteId) throw siteUnavailable();
      return getBrandSiteLook({ brandId, siteId });
    },
  });
}

/** #2829 W3 — saves the owner's exact colours and fonts to the draft. */
export function useSaveBrandSiteLook(brandId: string, siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { revision: string; tokens: unknown; fonts: unknown; design?: string }) => {
      if (!siteId) throw siteUnavailable();
      return saveBrandSiteLook({ brandId, siteId, ...input });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.look(siteId) });
      // #2829 W9a — Studio reports the save to Core; "Your look" on the plan follows.
      await queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) });
    },
  });
}

/** #2829 W3 — catalogue search (two characters or more). */
export function useBrandSiteFontSearch(brandId: string, siteId: string | null, query: string) {
  const { isAuthReady } = useAuth();
  const trimmed = query.trim();
  return useQuery({
    queryKey: brandSiteKeys.fontSearch(siteId, trimmed.toLowerCase()),
    enabled: isAuthReady && Boolean(siteId) && trimmed.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: () => {
      if (!siteId) throw siteUnavailable();
      return searchBrandSiteFonts({ brandId, siteId, query: trimmed });
    },
  });
}


/*
 * #2829 W8 — "Your addresses". Server state only (React Query); every change
 * refreshes the address list and the site overview (its address can change).
 */
export function useBrandSiteDomains(siteId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.domains(siteId),
    enabled: isAuthReady && enabled && siteId !== null,
    queryFn: () => getBrandSiteDomains(siteId!),
    staleTime: 15_000,
  });
}

function useDomainMutation<TInput, TResult>(
  brandId: string,
  siteId: string | null,
  run: (siteId: string, input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput) => {
      if (!siteId) throw siteUnavailable();
      return run(siteId, input);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.domains(siteId) }),
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) }),
      ]);
    },
  });
}

export function useAttachBrandSiteDomain(brandId: string, siteId: string | null) {
  return useDomainMutation(brandId, siteId, (id, hostname: string) =>
    attachBrandSiteDomain({ siteId: id, hostname }));
}

export function useCheckBrandSiteDomain(brandId: string, siteId: string | null) {
  return useDomainMutation(brandId, siteId, (id, hostId: string) =>
    checkBrandSiteDomain({ siteId: id, hostId }));
}

export function useSetPrimaryBrandSiteDomain(brandId: string, siteId: string | null) {
  return useDomainMutation(brandId, siteId, (id, hostId: string) =>
    setPrimaryBrandSiteDomain({ siteId: id, hostId }));
}

export function useDetachBrandSiteDomain(brandId: string, siteId: string | null) {
  return useDomainMutation(brandId, siteId, (id, hostId: string) =>
    detachBrandSiteDomain({ siteId: id, hostId }));
}


const SITE_READY_WINDOW_MS = 30_000;

/**
 * The brand's draft site, created when there is none yet (rank 50 in Core).
 * Waits up to 30 s for Studio to finish setting it up; a slower setup is an
 * honest "still setting up" error, never a pretend success.
 */
export function useEnsureBrandSiteDraft(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      let site = await readBrandSite(brandId);
      if (!site) {
        await provisionBrandSite(brandId, createBrandSiteOperationId());
        site = await readBrandSite(brandId);
      }
      const started = Date.now();
      while (site && site.status === "provisioning" && Date.now() - started < SITE_READY_WINDOW_MS) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        site = await readBrandSite(brandId);
      }
      if (!site) throw new BrandSitesError("NOT_FOUND", "Mingla couldn\u2019t create your website draft. Try again.", true);
      if (site.status === "provisioning") {
        throw new BrandSitesError("OPERATION_IN_PROGRESS", "Your website draft is still being set up. Try again in a minute.", true);
      }
      if (site.status === "error") {
        throw new BrandSitesError("INVALID_STATE", "Setting up your website draft didn\u2019t finish. Try again.", true);
      }
      return site.id;
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.detail(brandId) }),
        queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) }),
      ]);
    },
  });
}

/** #2829 W10 — the site's private share-preview links (rank 50 in Core). */
export function useBrandSiteShareLinks(siteId: string | null, enabled: boolean) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: brandSiteKeys.shareLinks(siteId),
    enabled: isAuthReady && enabled && siteId !== null,
    queryFn: () => listBrandSiteShareLinks(siteId!),
    staleTime: 30_000,
  });
}

export function useCreateBrandSiteShareLink(brandId: string, siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ttlDays: 1 | 7 | 14) => {
      if (!siteId) throw new BrandSitesError("INVALID_STATE", "Create your website first.", false);
      return createBrandSiteShareLink({ brandId, siteId, ttlDays });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: brandSiteKeys.shareLinks(siteId) }),
  });
}

export function useRevokeBrandSiteShareLink(siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => {
      if (!siteId) throw new BrandSitesError("INVALID_STATE", "Create your website first.", false);
      return revokeBrandSiteShareLink({ siteId, linkId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: brandSiteKeys.shareLinks(siteId) }),
  });
}
