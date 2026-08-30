import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { BrandWebsiteView } from "../../../src/components/sites/BrandWebsiteView";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { canvas } from "../../../src/constants/designSystem";
import { isFeatureEnabled } from "../../../src/config/featureFlags";
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
} from "../../../src/hooks/useBrandSite";
import {
  clearProvisionOperation,
  createBrandSiteOperationId,
  loadProvisionOperation,
  persistProvisionOperation,
  PROVISION_POLL_WINDOW_MS,
  resolveProvisionOperation,
  studioExchangeUrl,
  type PersistedProvisionOperation,
} from "../../../src/services/brandSitesService";
import {
  openStudioHandoff,
  STUDIO_NATIVE_RETURN_URL,
  studioReturnSurface,
} from "../../../src/sites/studioHandoff";

export default function BrandWebsiteRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const safeBrandId = typeof brandId === "string" ? brandId : "";
  const role = useCurrentBrandRole(safeBrandId || null);
  const enabled =
    isFeatureEnabled("sites") && role.rank >= 20 && safeBrandId.length > 0;
  const brand = useBrand(enabled ? safeBrandId : null);
  const site = useBrandSite(safeBrandId, enabled);
  const refetchSite = site.refetch;
  const [provisionOperation, setProvisionOperation] =
    useState<PersistedProvisionOperation | null>(null);
  const [operationCacheChecked, setOperationCacheChecked] = useState(false);
  const provision = useProvisionBrandSite(safeBrandId);
  const studio = useStudioExchange(safeBrandId);
  const preview = useBrandSitePreview(safeBrandId, site.data?.id ?? null);
  const workReady = enabled && site.data?.status !== "provisioning";
  const receipt = useBrandSiteOperation(
    site.data?.id ?? null,
    provisionOperation?.operationId ?? null,
    provisionOperation?.startedAt ?? null,
  );
  const versions = useBrandSiteVersions(site.data?.id ?? null, workReady);
  const analytics = useBrandSiteAnalytics(site.data?.id ?? null, workReady);
  const publish = usePublishBrandSite(safeBrandId, site.data?.id ?? null);
  const rollback = useRollbackBrandSite(safeBrandId);

  useEffect(() => {
    let active = true;
    setOperationCacheChecked(false);
    setProvisionOperation(null);
    if (!safeBrandId) return () => {
      active = false;
    };
    void loadProvisionOperation(safeBrandId).then((stored) => {
      if (active) {
        setProvisionOperation(stored);
        setOperationCacheChecked(true);
      }
    });
    return () => {
      active = false;
    };
  }, [safeBrandId]);

  useEffect(() => {
    if (!operationCacheChecked || provisionOperation !== null) return;
    const authoritative = resolveProvisionOperation(null, site.data);
    if (authoritative !== null) setProvisionOperation(authoritative);
  }, [operationCacheChecked, provisionOperation, site.data]);

  useEffect(() => {
    if (receipt.data?.status !== "succeeded") return;
    let active = true;
    void refetchSite().then((result) => {
      if (!active || result.data?.status === "provisioning") return;
      void clearProvisionOperation(safeBrandId);
      setProvisionOperation(null);
    });
    return () => {
      active = false;
    };
  }, [receipt.data?.status, refetchSite, safeBrandId]);

  const openStudio = useCallback(
    async () => {
      try {
        const exchange = await studio.mutateAsync();
        const surface = studioReturnSurface(Platform.OS);
        const url = studioExchangeUrl(
          exchange,
          surface,
        );
        await openStudioHandoff(url, surface, {
          openWeb: Linking.openURL,
          openNative: WebBrowser.openAuthSessionAsync,
        });
        await site.refetch();
      } catch {
        Alert.alert(
          "Couldn’t open Mingla Studio",
          "The secure handoff may have expired. Try again when you’re online.",
        );
      }
    },
    [site, studio],
  );

  const openPreview = useCallback(async () => {
    try {
      const grant = await preview.mutateAsync();
      if (Platform.OS === "web") {
        await Linking.openURL(grant.preview_url);
      } else {
        await WebBrowser.openAuthSessionAsync(
          grant.preview_url,
          STUDIO_NATIVE_RETURN_URL,
        );
      }
    } catch {
      Alert.alert(
        "Couldn’t create preview",
        "Review the draft and try again when you’re online.",
      );
    }
  }, [preview]);

  if (!isFeatureEnabled("sites")) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (!role.isLoading && role.rank < 20) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }

  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <Stack.Screen options={{ title: "Website", headerBackTitle: "Brand" }} />
      <BrandWebsiteView
        brandName={brand.data?.displayName ?? "Brand"}
        site={site.data ?? null}
        rank={role.rank}
        isLoading={role.isLoading || site.isLoading}
        isError={role.isError || site.isError}
        isProvisioning={provision.isPending}
        isOpeningStudio={studio.isPending}
        isPreviewing={preview.isPending}
        isPublishing={publish.isPending}
        isRollingBack={rollback.isPending}
        versions={versions.data ?? []}
        analytics={analytics.data ?? null}
        provisionOperationId={provisionOperation?.operationId ?? null}
        provisionOperation={receipt.data ?? null}
        provisionPollingTimedOut={
          provisionOperation !== null &&
          Date.now() - provisionOperation.startedAt >= PROVISION_POLL_WINDOW_MS &&
          receipt.data?.status !== "succeeded" &&
          receipt.data?.status !== "failed"
        }
        isReconciling={provision.isPending}
        onRetry={() => {
          void Promise.all([role.refetch(), site.refetch()]);
        }}
        onProvision={() => {
          const operation = {
            operationId: createBrandSiteOperationId(),
            startedAt: Date.now(),
          };
          setProvisionOperation(operation);
          void persistProvisionOperation(safeBrandId, operation);
          void provision.mutateAsync(operation.operationId).catch(() => {
            void site.refetch();
          });
        }}
        onReconcileProvision={() => {
          if (role.rank < 50 || provisionOperation === null) return;
          const retry = { ...provisionOperation, startedAt: Date.now() };
          setProvisionOperation(retry);
          void persistProvisionOperation(safeBrandId, retry);
          void provision.mutateAsync(retry.operationId).catch(() => {
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
          void Linking.openURL(`https://${hostname}`);
        }}
        onOpenAri={() =>
          router.push(
            `/(tabs)/ari?brandId=${safeBrandId}&sitesIntent=edit` as never,
          )
        }
        onPublish={() => {
          void publish.mutateAsync().catch(() => {
            Alert.alert(
              "Website wasn’t published",
              "Review the draft and try again. Your last verified Website is still live.",
            );
          });
        }}
        onRollback={(version) => {
          if (!site.data) return;
          void rollback.mutateAsync({
            siteId: site.data.id,
            sourceRevision: version.source_revision_id,
            sourceDigest: version.source_digest,
          }).catch(() => {
            Alert.alert(
              "Earlier version wasn’t published",
              "Nothing changed publicly. Try again from Versions.",
            );
          });
        }}
      />
    </SafeScreen>
  );
}
