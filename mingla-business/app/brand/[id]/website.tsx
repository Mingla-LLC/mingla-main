import React, { useCallback } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { BrandWebsiteView } from "../../../src/components/sites/BrandWebsiteView";
import { canvas } from "../../../src/constants/designSystem";
import { isFeatureEnabled } from "../../../src/config/featureFlags";
import { useBrand } from "../../../src/hooks/useBrands";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import {
  useBrandSite,
  useBrandSiteAnalytics,
  useBrandSitePreview,
  useBrandSiteVersions,
  usePublishBrandSite,
  useProvisionBrandSite,
  useRollbackBrandSite,
  useStudioExchange,
} from "../../../src/hooks/useBrandSite";
import { studioExchangeUrl } from "../../../src/services/brandSitesService";

const RETURN_URL = "mingla-business://website-return";

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
  const provision = useProvisionBrandSite(safeBrandId);
  const studio = useStudioExchange(safeBrandId);
  const preview = useBrandSitePreview(safeBrandId, site.data?.id ?? null);
  const versions = useBrandSiteVersions(site.data?.id ?? null, enabled);
  const analytics = useBrandSiteAnalytics(site.data?.id ?? null, enabled);
  const publish = usePublishBrandSite(safeBrandId, site.data?.id ?? null);
  const rollback = useRollbackBrandSite(safeBrandId);

  const openStudio = useCallback(
    async () => {
      try {
        const exchange = await studio.mutateAsync();
        const url = studioExchangeUrl(exchange);
        if (Platform.OS === "web") {
          await Linking.openURL(url);
        } else {
          await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
        }
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
        await WebBrowser.openAuthSessionAsync(grant.preview_url, RETURN_URL);
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
    <View style={{ flex: 1, backgroundColor: canvas.discover }}>
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
        onRetry={() => {
          void Promise.all([role.refetch(), site.refetch()]);
        }}
        onProvision={() => {
          void provision.mutateAsync().catch(() => {
            Alert.alert(
              "Setup didn’t finish",
              "Nothing was published. Try again when you’re online.",
            );
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
    </View>
  );
}
