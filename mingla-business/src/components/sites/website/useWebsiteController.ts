import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { isFeatureEnabled } from "../../../config/featureFlags";
import { useAuth } from "../../../context/AuthContext";
import { useBrand } from "../../../hooks/useBrands";
import {
  useBrandSite,
  useBrandSiteAvailability,
  useBrandSiteExport,
  useBrandSiteLabel,
  useBrandSiteOperation,
  useBrandSitePreview,
  useBrandSiteVersions,
  useProvisionBrandSite,
  usePublishBrandSite,
  useRequestBrandSiteExport,
  useRollbackBrandSite,
  useSetBrandSiteOffline,
  useStudioExchange,
} from "../../../hooks/useBrandSite";
import { useNetInfoSafe } from "../../../lib/netinfoSafe";
import {
  BrandSitesError,
  canResetFailedPublicationOperation,
  clearProvisionOperation,
  clearPublicationOperation,
  createBrandSiteOperationId,
  createBrandSitePreview,
  failedRollbackReviewVersion,
  isOrphanedPublicationOperation,
  loadProvisionOperation,
  loadPublicationOperation,
  persistProvisionOperation,
  persistPublicationOperation,
  PROVISION_POLL_WINDOW_MS,
  resolveProvisionOperation,
  studioExchangeUrl,
  validateBrandSiteDraft,
  type PersistedProvisionOperation,
  type PersistedPublicationOperation,
} from "../../../services/brandSitesService";
import { brandSiteKeys } from "../../../sites/brandSiteKeys";
import {
  capabilitiesFrom,
  previewUrlForPage,
  type BrandSiteDraftValidation,
  type BrandSitePreview,
  type BrandSiteVersion,
} from "../../../sites/contracts";
import { openWebsiteUrl } from "../../../sites/websiteExternalOpen";
import {
  PUBLICATION_TRACK_WINDOW_MS,
  publicationOutcomeUnknown,
  startTrackedPublication,
} from "../../../sites/publicationFlow";
import {
  deriveBusinessWebsiteState,
  OFFLINE_NOTICE,
  ORPHANED_PUBLICATION_NOTICE,
  websiteFailureNotice,
  type StudioReturnResult,
  type WorkspaceNotice,
} from "../../../sites/websiteJourney";
import { openStudioHandoff, studioReturnSurface } from "../../../sites/studioHandoff";

/**
 * #3583 — EVERY REFUSAL SURFACES. A typed Website failure keeps Core's own
 * customer-safe sentence plus the next action; anything else still surfaces
 * as an actionable failure, never as silence (Constitution #3).
 */
export function noticeFor(error: unknown): WorkspaceNotice {
  if (error instanceof BrandSitesError) {
    return websiteFailureNotice({ code: error.code, message: error.message });
  }
  console.warn("[website] untyped Website failure surfaced to the owner", error);
  return websiteFailureNotice({ code: null, message: null });
}

/**
 * #2829 W9r — the Website section's server state and the operations that
 * change what is live (moved here from the old Website route, behaviour
 * unchanged): Core's availability answer decides what opens and which
 * controls show (A5); provision and publication operations are durable and
 * tracked to their receipts (#3583, W9f); a refusal is always a notice.
 */
export function useWebsiteController(safeBrandId: string, studioResult: StudioReturnResult | null, onPublishPanel: boolean) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const network = useNetInfoSafe();
  // #3583 — permanently false on shipped binaries without RNCNetInfo; only a
  // REAL network signal routes to the offline notice.
  const offline = network?.isConnected === false || network?.isInternetReachable === false;
  const globallyEnabled = isFeatureEnabled("sites");
  // #2829 (A5) — one owner for "what may this member do": Core's answer.
  const canCheckAvailability = globallyEnabled && safeBrandId.length > 0;
  const availability = useBrandSiteAvailability(safeBrandId, canCheckAvailability);
  const websiteAvailable: boolean | null = availability.isError
    ? false
    : availability.data === undefined
      ? null
      : availability.data.available;
  const capabilities = capabilitiesFrom(availability.data);
  const enabled = canCheckAvailability && websiteAvailable === true;
  const brand = useBrand(enabled ? safeBrandId : null);
  const site = useBrandSite(safeBrandId, enabled);
  const refetchSite = site.refetch;
  const siteId = site.data?.id ?? null;
  const [notice, setNotice] = useState<WorkspaceNotice>(null);
  const [provisionOperation, setProvisionOperation] = useState<PersistedProvisionOperation | null>(null);
  const [provisionCacheChecked, setProvisionCacheChecked] = useState(false);
  const [publicationOperation, setPublicationOperation] = useState<PersistedPublicationOperation | null>(null);
  const [publicationCacheChecked, setPublicationCacheChecked] = useState(false);
  const provision = useProvisionBrandSite(safeBrandId);
  const studio = useStudioExchange(safeBrandId);
  const preview = useBrandSitePreview(safeBrandId, siteId);
  const workReady = enabled && site.data?.status !== "provisioning";
  const provisionReceipt = useBrandSiteOperation(siteId, provisionOperation?.operationId ?? null, provisionOperation?.startedAt ?? null);
  const publicationReceipt = useBrandSiteOperation(
    siteId,
    publicationOperation?.operationId ?? null,
    publicationOperation?.startedAt ?? null,
    PUBLICATION_TRACK_WINDOW_MS,
  );
  const refetchProvisionReceipt = provisionReceipt.refetch;
  const refetchPublicationReceipt = publicationReceipt.refetch;
  const versions = useBrandSiteVersions(siteId, workReady);
  const publish = usePublishBrandSite(safeBrandId, siteId);
  const label = useBrandSiteLabel(safeBrandId, enabled && capabilities.canCreate && site.data === null);
  const offlineToggle = useSetBrandSiteOffline(safeBrandId, siteId);
  const siteExport = useRequestBrandSiteExport(siteId);
  const [exportRequest, setExportRequest] = useState<{ operationId: string; startedAt: number } | null>(null);
  const exportStatus = useBrandSiteExport(siteId, exportRequest?.operationId ?? null, exportRequest?.startedAt ?? null);
  const rollback = useRollbackBrandSite(safeBrandId);

  /*
   * #2829 W9r — the draft check behind Publish & history runs on open. It is
   * the same validation Publish uses (exact revision + draft digest), so the
   * Publish button always publishes exactly what was checked.
   */
  const validation = useQuery({
    queryKey: brandSiteKeys.siteData(siteId, "validation"),
    queryFn: () => validateBrandSiteDraft({ brandId: safeBrandId, siteId: siteId! }),
    enabled: workReady && siteId !== null && onPublishPanel,
    staleTime: 0,
    retry: false,
  });

  /*
   * #2829 W9r — one private preview link per draft, shared by every preview
   * on the screen (side panel, phone sheet, full screen) until it nears
   * expiry or the draft is saved (the savers drop this key).
   */
  const previewGrant = useQuery<BrandSitePreview>({
    queryKey: brandSiteKeys.siteData(siteId, "preview"),
    queryFn: async () => {
      const draft = await validateBrandSiteDraft({ brandId: safeBrandId, siteId: siteId! });
      return createBrandSitePreview({
        siteId: siteId!,
        expectedRevision: draft.home_revision,
        sourceDigest: draft.draft_digest,
        returnSurface: Platform.OS === "web" ? "web" : "native",
      });
    },
    enabled: workReady && siteId !== null,
    staleTime: 4 * 60_000,
    retry: false,
  });
  const refreshPreview = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, "preview") });
  }, [queryClient, siteId]);

  useEffect(() => {
    let active = true;
    setProvisionCacheChecked(false);
    setProvisionOperation(null);
    if (!safeBrandId) return () => {
      active = false;
    };
    void loadProvisionOperation(safeBrandId).then((stored) => {
      if (active) {
        setProvisionOperation(stored);
        setProvisionCacheChecked(true);
      }
    });
    return () => {
      active = false;
    };
  }, [safeBrandId]);

  useEffect(() => {
    if (!provisionCacheChecked || provisionOperation !== null) return;
    const authoritative = resolveProvisionOperation(null, site.data);
    if (authoritative !== null) setProvisionOperation(authoritative);
  }, [provisionCacheChecked, provisionOperation, site.data]);

  useEffect(() => {
    if (provisionReceipt.data?.status !== "succeeded") return;
    let active = true;
    void refetchSite().then((result) => {
      if (!active || result.data?.status === "provisioning") return;
      void clearProvisionOperation(safeBrandId);
      setProvisionOperation(null);
    });
    return () => {
      active = false;
    };
  }, [provisionReceipt.data?.status, refetchSite, safeBrandId]);

  useEffect(() => {
    let active = true;
    setPublicationCacheChecked(false);
    setPublicationOperation(null);
    const accountId = user?.id;
    if (!siteId || !accountId || !safeBrandId) return () => {
      active = false;
    };
    void loadPublicationOperation({ accountId, brandId: safeBrandId, siteId }).then((stored) => {
      if (active) {
        setPublicationOperation(stored);
        setPublicationCacheChecked(true);
      }
    });
    return () => {
      active = false;
    };
  }, [safeBrandId, siteId, user?.id]);

  const [publishedJustNow, setPublishedJustNow] = useState<"publish" | "rollback" | null>(null);
  useEffect(() => {
    if (publicationReceipt.data?.status !== "succeeded") return;
    let active = true;
    const kind = publicationOperation?.kind ?? "publish";
    void refetchSite().then((result) => {
      if (!active || result.data?.status === "publishing") return;
      const accountId = user?.id;
      const resolvedSiteId = result.data?.id ?? siteId;
      if (accountId && resolvedSiteId) {
        void clearPublicationOperation({ accountId, brandId: safeBrandId, siteId: resolvedSiteId });
      }
      setPublicationOperation(null);
      setPublishedJustNow(kind);
      void queryClient.invalidateQueries({ queryKey: brandSiteKeys.siteData(resolvedSiteId, "changes") });
      void queryClient.invalidateQueries({ queryKey: brandSiteKeys.versions(resolvedSiteId) });
    });
    return () => {
      active = false;
    };
  }, [publicationReceipt.data?.status, publicationOperation?.kind, queryClient, safeBrandId, siteId, refetchSite, user?.id]);

  useEffect(() => {
    if (!offline) return;
    setNotice(OFFLINE_NOTICE);
  }, [offline]);

  useEffect(() => {
    // #3583 — this clears the OFFLINE notice only.
    if (offline || notice?.kind !== "offline") return;
    setNotice(null);
    void Promise.all([refetchSite(), refetchProvisionReceipt(), refetchPublicationReceipt()]);
  }, [notice, offline, refetchProvisionReceipt, refetchPublicationReceipt, refetchSite]);

  const openStudio = useCallback(async (pageId?: string | null) => {
    try {
      setNotice(null);
      const exchange = await studio.mutateAsync();
      const surface = studioReturnSurface(Platform.OS);
      const url = studioExchangeUrl(exchange, surface, safeBrandId, pageId);
      await openStudioHandoff(url, surface, {
        openWeb: openWebsiteUrl,
        openNative: WebBrowser.openAuthSessionAsync,
      });
      await refetchSite();
    } catch (error) {
      setNotice(noticeFor(error));
    }
  }, [refetchSite, safeBrandId, studio]);

  /** Studio's own preview window at one page (native "Preview" falls back to it). */
  const openStudioPreview = useCallback(async (pagePath = "") => {
    try {
      setNotice(null);
      const surface = studioReturnSurface(Platform.OS);
      const grant = previewGrant.data ?? await preview.mutateAsync(surface);
      await openStudioHandoff(previewUrlForPage(grant.preview_url, pagePath), surface, {
        openWeb: openWebsiteUrl,
        openNative: WebBrowser.openAuthSessionAsync,
      });
    } catch (error) {
      setNotice(noticeFor(error));
    }
  }, [preview, previewGrant.data]);

  const runPublication = useCallback(async (operation: PersistedPublicationOperation): Promise<void> => {
    if (operation.kind === "publish") {
      await publish.mutateAsync({
        operationId: operation.operationId,
        validation: {
          site_id: operation.siteId,
          valid: true,
          renderer: "Restaurant Website v1",
          home_revision: operation.expectedRevision,
          draft_digest: operation.sourceDigest,
          checked_pages: validation.data?.checked_pages ?? 1,
        } satisfies BrandSiteDraftValidation,
      });
      return;
    }
    await rollback.mutateAsync({
      siteId: operation.siteId,
      operationId: operation.operationId,
      sourceRevision: operation.expectedRevision,
      sourceDigest: operation.sourceDigest,
    });
  }, [publish, rollback, validation.data?.checked_pages]);

  /*
   * #3583 — DO NOT CLAIM AN OPERATION CORE HAS NOT ACCEPTED. Ask Core first;
   * record the operation only once Core has accepted it. #2829 W9f — a 503 /
   * timeout is "outcome unknown": the same operation is tracked to its
   * receipt ("Still publishing…").
   */
  const startPublication = useCallback(async (operation: PersistedPublicationOperation): Promise<void> => {
    setNotice(null);
    setPublishedJustNow(null);
    await startTrackedPublication(operation, {
      run: runPublication,
      refuse: (error) => setNotice(noticeFor(error)),
      track: async (accepted) => {
        operation = accepted;
        setPublicationOperation(operation);
        await persistPublicationOperation(operation);
        await refetchPublicationReceipt();
      },
    });
  }, [refetchPublicationReceipt, runPublication]);

  const publicationReceiptErrorCode = publicationReceipt.error instanceof BrandSitesError ? publicationReceipt.error.code : null;

  // #3583 — recover installs already stuck on an operation Core never created.
  useEffect(() => {
    if (!isOrphanedPublicationOperation(publicationOperation, publicationReceiptErrorCode)) return;
    const orphan = publicationOperation;
    let active = true;
    void clearPublicationOperation(orphan).then(() => {
      if (!active) return;
      setPublicationOperation(null);
      setNotice({ ...ORPHANED_PUBLICATION_NOTICE, reference: orphan.operationId });
    });
    return () => {
      active = false;
    };
  }, [publicationOperation, publicationReceiptErrorCode]);

  const publicationPollingTimedOut =
    publicationOperation !== null &&
    Date.now() - publicationOperation.startedAt >= PUBLICATION_TRACK_WINDOW_MS &&
    publicationReceipt.data?.status !== "succeeded" &&
    publicationReceipt.data?.status !== "failed";

  const journeyState = useMemo(() => deriveBusinessWebsiteState({
    site: site.data ?? null,
    panel: onPublishPanel ? "publish_review" : "overview",
    operation: publicationReceipt.data ?? null,
    operationPending: publicationOperation !== null &&
      publicationReceipt.data?.status !== "succeeded" &&
      publicationReceipt.data?.status !== "failed",
    isOpeningStudio: studio.isPending,
    isPreviewing: preview.isPending,
    studioReturnResult: studioResult,
  }), [onPublishPanel, preview.isPending, publicationOperation, publicationReceipt.data, site.data, studio.isPending, studioResult]);

  const actions = {
    retry: () => {
      setNotice(null);
      void Promise.all([availability.refetch(), site.refetch()]);
    },
    provision: () => {
      const operation = { operationId: createBrandSiteOperationId(), startedAt: Date.now() };
      setProvisionOperation(operation);
      void persistProvisionOperation(safeBrandId, operation);
      void provision.mutateAsync(operation.operationId).catch((error) => {
        setNotice(noticeFor(error));
        void site.refetch();
      });
    },
    reconcileProvision: () => {
      if (!capabilities.canCreate || provisionOperation === null) return;
      const retry = { ...provisionOperation, startedAt: Date.now() };
      setProvisionOperation(retry);
      void persistProvisionOperation(safeBrandId, retry);
      void provision.mutateAsync(retry.operationId).catch((error) => {
        setNotice(noticeFor(error));
        void site.refetch();
      });
    },
    openStudio: (pageId?: string | null) => {
      void openStudio(pageId);
    },
    openStudioPreview: (pagePath?: string) => {
      void openStudioPreview(pagePath);
    },
    publish: () => {
      const accountId = user?.id;
      if (!accountId || !siteId || !validation.data || publicationOperation) return;
      void startPublication({
        accountId,
        brandId: safeBrandId,
        siteId,
        operationId: createBrandSiteOperationId(),
        kind: "publish",
        startedAt: Date.now(),
        expectedRevision: validation.data.home_revision,
        sourceDigest: validation.data.draft_digest,
        rollbackSourcePublicationId: null,
      });
    },
    rollback: (selectedVersion: BrandSiteVersion) => {
      const accountId = user?.id;
      if (!accountId || !siteId || publicationOperation) return;
      void startPublication({
        accountId,
        brandId: safeBrandId,
        siteId,
        operationId: createBrandSiteOperationId(),
        kind: "rollback",
        startedAt: Date.now(),
        expectedRevision: selectedVersion.source_revision_id,
        sourceDigest: selectedVersion.source_digest,
        rollbackSourcePublicationId: selectedVersion.id,
      });
    },
    onReconcilePublication: () => {
      if (!publicationOperation) return;
      const retry = { ...publicationOperation, startedAt: Date.now() };
      setPublicationOperation(retry);
      void persistPublicationOperation(retry);
      void runPublication(retry).catch((error) => {
        // #2829 W9f — an unknown outcome keeps tracking quietly.
        if (!publicationOutcomeUnknown(error)) setNotice(noticeFor(error));
        void publicationReceipt.refetch();
      });
    },
    onResetFailedPublication: () => {
      const receipt = publicationReceipt.data ?? null;
      if (!canResetFailedPublicationOperation(publicationOperation, receipt)) {
        return;
      }
      const failed = publicationOperation;
      void failedRollbackReviewVersion(failed, versions.data ?? []);
      void clearPublicationOperation(failed).then(() => {
        setPublicationOperation(null);
        void validation.refetch();
      });
    },
    setOffline: (next: boolean) => {
      void offlineToggle
        .mutateAsync({ offline: next, operationId: createBrandSiteOperationId() })
        .catch((error) => setNotice(noticeFor(error)));
    },
    requestExport: () => {
      const operationId = createBrandSiteOperationId();
      void siteExport
        .mutateAsync(operationId)
        .then(() => setExportRequest({ operationId, startedAt: Date.now() }))
        .catch((error) => setNotice(noticeFor(error)));
    },
    openUrl: (url: string) => {
      void openWebsiteUrl(url);
    },
    dismissNotice: () => setNotice(null),
    setNotice,
  };

  return {
    user,
    globallyEnabled,
    canCheckAvailability,
    availability,
    websiteAvailable,
    capabilities,
    brand,
    site,
    siteId,
    label,
    notice,
    journeyState,
    provisionOperation,
    provisionReceipt,
    provisionPollingTimedOut: provisionOperation !== null &&
      Date.now() - provisionOperation.startedAt >= PROVISION_POLL_WINDOW_MS &&
      provisionReceipt.data?.status !== "succeeded" &&
      provisionReceipt.data?.status !== "failed",
    isProvisioning: provision.isPending,
    publicationOperation,
    publicationReceipt,
    publicationPollingTimedOut,
    publicationCacheChecked,
    publishedJustNow,
    isPublishing: publish.isPending || rollback.isPending,
    isPreviewing: preview.isPending,
    isOpeningStudio: studio.isPending,
    versions,
    validation,
    previewGrant,
    refreshPreview,
    isTogglingOffline: offlineToggle.isPending,
    isExporting: siteExport.isPending,
    exportResult: exportStatus.data ?? siteExport.data ?? null,
    actions,
  };
}

export type WebsiteController = ReturnType<typeof useWebsiteController>;
