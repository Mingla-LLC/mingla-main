import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { BrandWebsiteView } from "../../../src/components/sites/BrandWebsiteView";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { TopBar } from "../../../src/components/ui/TopBar";
import { canvas } from "../../../src/constants/designSystem";
import { isFeatureEnabled } from "../../../src/config/featureFlags";
import { useAuth } from "../../../src/context/AuthContext";
import { useBrand } from "../../../src/hooks/useBrands";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import {
  useBrandSite,
  useBrandSiteAnalytics,
  useBrandSiteOperation,
  useBrandSitePreview,
  useBrandSiteVersions,
  usePublishBrandSite,
  useProvisionBrandSite,
  useRollbackBrandSite,
  useStudioExchange,
  useValidateBrandSiteDraft,
} from "../../../src/hooks/useBrandSite";
import { useNetInfoSafe } from "../../../src/lib/netinfoSafe";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import {
  BrandSitesError,
  canResetFailedPublicationOperation,
  clearProvisionOperation,
  clearPublicationOperation,
  createBrandSiteOperationId,
  failedRollbackReviewVersion,
  loadProvisionOperation,
  loadPublicationOperation,
  persistProvisionOperation,
  persistPublicationOperation,
  PROVISION_POLL_WINDOW_MS,
  PUBLICATION_POLL_WINDOW_MS,
  resolveProvisionOperation,
  studioExchangeUrl,
  type PersistedProvisionOperation,
  type PersistedPublicationOperation,
} from "../../../src/services/brandSitesService";
import type {
  BrandSiteDraftValidation,
  BrandSiteVersion,
} from "../../../src/sites/contracts";
import { openWebsiteUrl } from "../../../src/sites/websiteExternalOpen";
import {
  deriveBusinessWebsiteState,
  type StudioReturnResult,
  type WebsiteWorkspacePanel,
  type WorkspaceNotice,
} from "../../../src/sites/websiteJourney";
import { loadBrandWebsiteEntryContext } from "../../../src/sites/brandWebsiteEntry";
import {
  openStudioHandoff,
  studioReturnSurface,
} from "../../../src/sites/studioHandoff";

const STUDIO_RESULTS = new Set<StudioReturnResult>([
  "exchange_expired",
  "session_expired",
  "preview_expired",
  "preview_publish",
]);

function safeStudioResult(value: unknown): StudioReturnResult | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" &&
      STUDIO_RESULTS.has(candidate as StudioReturnResult)
    ? (candidate as StudioReturnResult)
    : null;
}

function noticeFor(error: unknown): WorkspaceNotice {
  if (!(error instanceof BrandSitesError)) return "offline";
  if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
    return "unauthorized";
  }
  if (error.code.includes("EXPIRED") || error.code.includes("REPLAY")) {
    return "expired";
  }
  return "offline";
}

export default function BrandWebsiteRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    studioResult?: string | string[];
  }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const safeBrandId = typeof brandId === "string" ? brandId : "";
  const studioResult = safeStudioResult(params.studioResult);
  const { user } = useAuth();
  const network = useNetInfoSafe();
  // I-DESKTOP-GATE-VIA-HOOK: the shell never gates itself; the route does.
  const { isWideDesktop } = useResponsiveLayout();
  const offline =
    network?.isConnected === false || network?.isInternetReachable === false;
  const role = useCurrentBrandRole(safeBrandId || null);
  const globallyEnabled = isFeatureEnabled("sites");
  const canCheckAvailability = globallyEnabled && !role.isLoading &&
    role.rank >= 20 && safeBrandId.length > 0;
  const [websiteAvailable, setWebsiteAvailable] = useState<boolean | null>(null);
  const enabled = canCheckAvailability && websiteAvailable === true;
  const brand = useBrand(enabled ? safeBrandId : null);
  const site = useBrandSite(safeBrandId, enabled);
  const refetchSite = site.refetch;
  const [panel, setPanel] = useState<WebsiteWorkspacePanel>("overview");
  const [notice, setNotice] = useState<WorkspaceNotice>(null);
  const [validation, setValidation] =
    useState<BrandSiteDraftValidation | null>(null);
  const [validationFailure, setValidationFailure] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] =
    useState<BrandSiteVersion | null>(null);
  const [provisionOperation, setProvisionOperation] =
    useState<PersistedProvisionOperation | null>(null);
  const [provisionCacheChecked, setProvisionCacheChecked] = useState(false);
  const [publicationOperation, setPublicationOperation] =
    useState<PersistedPublicationOperation | null>(null);
  const [publicationCacheChecked, setPublicationCacheChecked] = useState(false);
  const provision = useProvisionBrandSite(safeBrandId);
  const studio = useStudioExchange(safeBrandId);
  const preview = useBrandSitePreview(safeBrandId, site.data?.id ?? null);
  const validate = useValidateBrandSiteDraft(
    safeBrandId,
    site.data?.id ?? null,
  );
  const workReady = enabled && site.data?.status !== "provisioning";
  const provisionReceipt = useBrandSiteOperation(
    site.data?.id ?? null,
    provisionOperation?.operationId ?? null,
    provisionOperation?.startedAt ?? null,
  );
  const publicationReceipt = useBrandSiteOperation(
    site.data?.id ?? null,
    publicationOperation?.operationId ?? null,
    publicationOperation?.startedAt ?? null,
  );
  const refetchProvisionReceipt = provisionReceipt.refetch;
  const refetchPublicationReceipt = publicationReceipt.refetch;
  const versions = useBrandSiteVersions(site.data?.id ?? null, workReady);
  const analytics = useBrandSiteAnalytics(site.data?.id ?? null, workReady);
  const publish = usePublishBrandSite(safeBrandId, site.data?.id ?? null);
  const rollback = useRollbackBrandSite(safeBrandId);

  useEffect(() => {
    let active = true;
    setWebsiteAvailable(null);
    if (!canCheckAvailability) return () => {
      active = false;
    };
    void loadBrandWebsiteEntryContext(safeBrandId)
      .then((context) => {
        if (active) setWebsiteAvailable(context !== null);
      })
      .catch(() => {
        if (active) setWebsiteAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [canCheckAvailability, safeBrandId]);

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
    const siteId = site.data?.id;
    const accountId = user?.id;
    if (!siteId || !accountId || !safeBrandId) return () => {
      active = false;
    };
    void loadPublicationOperation({ accountId, brandId: safeBrandId, siteId }).then(
      (stored) => {
        if (active) {
          setPublicationOperation(stored);
          setPublicationCacheChecked(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [safeBrandId, site.data?.id, user?.id]);

  useEffect(() => {
    if (publicationReceipt.data?.status !== "succeeded") return;
    let active = true;
    void refetchSite().then((result) => {
      if (!active || result.data?.status === "publishing") return;
      const accountId = user?.id;
      const siteId = result.data?.id ?? site.data?.id;
      if (accountId && siteId) {
        void clearPublicationOperation({
          accountId,
          brandId: safeBrandId,
          siteId,
        });
      }
      setPublicationOperation(null);
      setValidation(null);
      setSelectedVersion(null);
      setPanel("overview");
    });
    return () => {
      active = false;
    };
  }, [
    publicationReceipt.data?.status,
    safeBrandId,
    site.data?.id,
    refetchSite,
    user?.id,
  ]);

  useEffect(() => {
    if (!offline) return;
    setNotice("offline");
  }, [offline]);

  useEffect(() => {
    if (offline || notice !== "offline") return;
    setNotice(null);
    void Promise.all([
      refetchSite(),
      refetchProvisionReceipt(),
      refetchPublicationReceipt(),
    ]);
  }, [
    notice,
    offline,
    refetchProvisionReceipt,
    refetchPublicationReceipt,
    refetchSite,
  ]);

  /**
   * #2830 — Website was the ONLY brand sub-screen with no visible way back.
   * It set `title` / `headerBackTitle` on a `Stack.Screen`, but the root
   * layout renders `<Stack screenOptions={{ headerShown: false }} />`, so that
   * header can never draw and the options have been inert since it shipped.
   * The swipe gesture was the only exit. Same `TopBar` + same `canGoBack`
   * fallback as Team, Blasts, Audit log and Brand home.
   */
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/brand/${safeBrandId}` as never);
  }, [router, safeBrandId]);

  const openStudio = useCallback(async () => {
    try {
      setNotice(null);
      const exchange = await studio.mutateAsync();
      const surface = studioReturnSurface(Platform.OS);
      const url = studioExchangeUrl(exchange, surface, safeBrandId);
      await openStudioHandoff(url, surface, {
        openWeb: openWebsiteUrl,
        openNative: WebBrowser.openAuthSessionAsync,
      });
      await refetchSite();
    } catch (error) {
      setNotice(noticeFor(error));
    }
  }, [refetchSite, safeBrandId, studio]);

  const openPreview = useCallback(async () => {
    try {
      setNotice(null);
      const surface = studioReturnSurface(Platform.OS);
      const grant = await preview.mutateAsync(surface);
      await openStudioHandoff(grant.preview_url, surface, {
        openWeb: openWebsiteUrl,
        openNative: WebBrowser.openAuthSessionAsync,
      });
    } catch (error) {
      setNotice(noticeFor(error));
    }
  }, [preview]);

  const runPublication = useCallback(
    async (operation: PersistedPublicationOperation): Promise<void> => {
      if (operation.kind === "publish") {
        await publish.mutateAsync({
          operationId: operation.operationId,
          validation: {
            site_id: operation.siteId,
            valid: true,
            renderer: "Restaurant Website v1",
            home_revision: operation.expectedRevision,
            draft_digest: operation.sourceDigest,
            checked_pages: validation?.checked_pages ?? 1,
          },
        });
        return;
      }
      await rollback.mutateAsync({
        siteId: operation.siteId,
        operationId: operation.operationId,
        sourceRevision: operation.expectedRevision,
        sourceDigest: operation.sourceDigest,
      });
    },
    [publish, rollback, validation?.checked_pages],
  );

  const startPublication = useCallback(
    async (operation: PersistedPublicationOperation): Promise<void> => {
      setNotice(null);
      setPublicationOperation(operation);
      await persistPublicationOperation(operation);
      try {
        await runPublication(operation);
      } catch (error) {
        setNotice(noticeFor(error));
        await refetchPublicationReceipt();
      }
    },
    [refetchPublicationReceipt, runPublication],
  );

  const publicationPollingTimedOut =
    publicationOperation !== null &&
    Date.now() - publicationOperation.startedAt >= PUBLICATION_POLL_WINDOW_MS &&
    publicationReceipt.data?.status !== "succeeded" &&
    publicationReceipt.data?.status !== "failed";

  const journeyState = useMemo(
    () =>
      deriveBusinessWebsiteState({
        site: site.data ?? null,
        panel,
        operation: publicationReceipt.data ?? null,
        operationPending:
          publicationOperation !== null &&
          publicationReceipt.data?.status !== "succeeded" &&
          publicationReceipt.data?.status !== "failed",
        isOpeningStudio: studio.isPending,
        isPreviewing: preview.isPending,
        studioReturnResult: studioResult,
      }),
    [
      panel,
      preview.isPending,
      publicationOperation,
      publicationReceipt.data,
      site.data,
      studio.isPending,
      studioResult,
    ],
  );

  if (!globallyEnabled) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (!role.isLoading && role.rank < 20) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (canCheckAvailability && websiteAvailable === false) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (role.isLoading || websiteAvailable !== true) {
    return (
      <SafeScreen style={{ backgroundColor: canvas.discover }}>
        <TopBar
          leftKind="back"
          title="Website"
          onBack={handleBack}
          rightSlot={null}
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <TopBar leftKind="back" title="Website" onBack={handleBack} rightSlot={null} />
      <BrandWebsiteView
        brandName={brand.data?.displayName ?? "Brand"}
        site={site.data ?? null}
        rank={role.rank}
        isWideDesktop={isWideDesktop}
        journeyState={journeyState}
        panel={panel}
        notice={notice}
        isLoading={
              role.isLoading ||
              site.isLoading ||
              (site.data !== undefined &&
                site.data !== null &&
                !publicationCacheChecked)
        }
        isError={role.isError || site.isError}
        isProvisioning={provision.isPending}
        isOpeningStudio={studio.isPending}
        isPreviewing={preview.isPending}
        isPublishing={publish.isPending}
        isRollingBack={rollback.isPending}
        isValidating={validate.isPending}
        versions={versions.data ?? []}
        analytics={analytics.data ?? null}
        validation={validation}
        validationFailure={validationFailure}
        selectedVersion={selectedVersion}
        provisionOperationId={provisionOperation?.operationId ?? null}
        provisionOperation={provisionReceipt.data ?? null}
        provisionPollingTimedOut={
          provisionOperation !== null &&
          Date.now() - provisionOperation.startedAt >= PROVISION_POLL_WINDOW_MS &&
          provisionReceipt.data?.status !== "succeeded" &&
          provisionReceipt.data?.status !== "failed"
        }
        publicationOperationId={publicationOperation?.operationId ?? null}
        publicationOperation={publicationReceipt.data ?? null}
        publicationPollingTimedOut={publicationPollingTimedOut}
        isReconciling={
          provision.isPending || publish.isPending || rollback.isPending
        }
        onRetry={() => {
          if (notice === "unauthorized") {
            router.replace(`/brand/${safeBrandId}` as never);
            return;
          }
          setNotice(null);
          void Promise.all([role.refetch(), site.refetch()]);
        }}
        onSetPanel={(nextPanel) => {
          setPanel(nextPanel);
          if (nextPanel !== "publish_review") {
            setValidation(null);
            setValidationFailure(null);
          }
          if (nextPanel !== "rollback_review") setSelectedVersion(null);
        }}
        onProvision={() => {
          const operation = {
            operationId: createBrandSiteOperationId(),
            startedAt: Date.now(),
          };
          setProvisionOperation(operation);
          void persistProvisionOperation(safeBrandId, operation);
          void provision.mutateAsync(operation.operationId).catch((error) => {
            setNotice(noticeFor(error));
            void site.refetch();
          });
        }}
        onReconcileProvision={() => {
          if (role.rank < 50 || provisionOperation === null) return;
          const retry = { ...provisionOperation, startedAt: Date.now() };
          setProvisionOperation(retry);
          void persistProvisionOperation(safeBrandId, retry);
          void provision.mutateAsync(retry.operationId).catch((error) => {
            setNotice(noticeFor(error));
            void site.refetch();
          });
        }}
        onOpenStudio={() => {
          void openStudio();
        }}
        onPreview={() => {
          void openPreview();
        }}
        onViewLive={(hostname) => {
          void openWebsiteUrl(`https://${hostname}`);
        }}
        onOpenAri={() =>
          // #2830 — the split view, not the full-screen Ari tab: editing a
          // website without seeing it is what made every change a guess.
          router.push(`/brand/${safeBrandId}/website/ari` as never)
        }
        onValidatePublish={() => {
          setValidationFailure(null);
          void validate.mutateAsync().then(setValidation).catch((error) => {
            if (
              error instanceof BrandSitesError &&
              ["VALIDATION_FAILED", "REVISION_CONFLICT", "INVALID_STATE"].includes(
                error.code,
              )
            ) {
              setValidationFailure(
                "Open the named page or setting in Studio, resolve the validation issue, then check this exact draft again.",
              );
              return;
            }
            setNotice(noticeFor(error));
          });
        }}
        onPublish={() => {
          const accountId = user?.id;
          const siteId = site.data?.id;
          if (!accountId || !siteId || !validation || publicationOperation) return;
          void startPublication({
            accountId,
            brandId: safeBrandId,
            siteId,
            operationId: createBrandSiteOperationId(),
            kind: "publish",
            startedAt: Date.now(),
            expectedRevision: validation.home_revision,
            sourceDigest: validation.draft_digest,
            rollbackSourcePublicationId: null,
          });
        }}
        onSelectRollback={(version) => {
          setSelectedVersion(version);
          setPanel("rollback_review");
        }}
        onRollback={() => {
          const accountId = user?.id;
          const siteId = site.data?.id;
          if (!accountId || !siteId || !selectedVersion || publicationOperation)
            return;
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
        }}
        onReconcilePublication={() => {
          if (!publicationOperation) return;
          const retry = { ...publicationOperation, startedAt: Date.now() };
          setPublicationOperation(retry);
          void persistPublicationOperation(retry);
          void runPublication(retry).catch((error) => {
            setNotice(noticeFor(error));
            void publicationReceipt.refetch();
          });
        }}
        onResetFailedPublication={() => {
          const receipt = publicationReceipt.data ?? null;
          if (
            !canResetFailedPublicationOperation(publicationOperation, receipt)
          ) {
            return;
          }
          const failed = publicationOperation;
          const rollbackVersion = failedRollbackReviewVersion(
            failed,
            versions.data ?? [],
          );
          void clearPublicationOperation(failed).then(() => {
            setPublicationOperation(null);
            setValidation(null);
            setValidationFailure(null);
            if (failed.kind === "rollback") {
              setSelectedVersion(rollbackVersion);
              setPanel(rollbackVersion ? "rollback_review" : "versions");
              return;
            }
            setSelectedVersion(null);
            setPanel("publish_review");
          });
        }}
      />
    </SafeScreen>
  );
}
