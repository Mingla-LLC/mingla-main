import React from "react";
import { StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../src/hooks/useCurrentBrandRole";
import {
  useCurrentBrandHasHydrated,
  useCurrentBrandId,
} from "../../src/store/currentBrandStore";
import {
  listingInsightsKeys,
  useListingInsights,
} from "../../src/hooks/useListingInsights";
import {
  fetchListingInsightsIdentity,
  type ListingInsightsIdentity,
} from "../../src/services/listingInsightsService";
import { isScannerOnlyRank } from "../../src/utils/navTabGate";
import {
  sanitizeBusinessListingInsightsEntryPoint,
} from "../../src/analytics/businessAnalyticsEvents";
import { ListingInsightsScreen } from "../../src/components/analytics/ListingInsightsScreen";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { canvas } from "../../src/constants/designSystem";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const listingIdParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && CANONICAL_UUID.test(value) ? value : null;

export default function ListingInsightsRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    entry?: string | string[];
  }>();
  const id = listingIdParam(params.id);
  const { isAuthReady } = useAuth();
  const hasCurrentBrandHydrated = useCurrentBrandHasHydrated();
  const currentBrandId = useCurrentBrandId();
  const currentBrand = useCurrentBrand();
  const role = useCurrentBrandRole(
    hasCurrentBrandHydrated ? (currentBrand?.id ?? null) : null,
  );
  const rankSettled =
    hasCurrentBrandHydrated &&
    currentBrand !== null &&
    !role.isLoading &&
    !role.isError &&
    role.role !== null;
  const membershipDenied =
    hasCurrentBrandHydrated &&
    currentBrand !== null &&
    !role.isLoading &&
    !role.isError &&
    role.role === null;
  const scannerDenied = rankSettled && isScannerOnlyRank(role.rank);
  const identityProbe = useQuery<ListingInsightsIdentity, Error>({
    queryKey:
      id === null
        ? listingInsightsKeys.disabledIdentity
        : listingInsightsKeys.identity(id),
    enabled:
      isAuthReady &&
      rankSettled &&
      !scannerDenied &&
      id !== null,
    queryFn: async (): Promise<ListingInsightsIdentity> => {
      if (id === null) throw new Error("listing id is unavailable");
      return fetchListingInsightsIdentity(id);
    },
  });
  const allowed =
    rankSettled &&
    !scannerDenied &&
    identityProbe.data !== undefined &&
    currentBrand?.id === identityProbe.data.brandId;
  const insights = useListingInsights(id, isAuthReady, allowed);

  const backToListings = (): void => {
    router.replace("/(tabs)/hub/events" as never);
  };
  const back = (): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (identityProbe.data !== undefined) {
      router.replace(identityProbe.data.detailRoute as never);
      return;
    }
    backToListings();
  };

  return (
    <SafeScreen style={styles.host}>
      <ListingInsightsScreen
        identity={identityProbe}
        rollup={insights.rollup}
        entryPoint={sanitizeBusinessListingInsightsEntryPoint(params.entry)}
        onBack={back}
        onBackToListings={backToListings}
        accessError={
          hasCurrentBrandHydrated && currentBrand !== null && role.isError
        }
        onRetryAccess={() => {
          void role.refetch();
        }}
        forceUnavailable={
          id === null ||
          (hasCurrentBrandHydrated && currentBrandId === null) ||
          membershipDenied ||
          scannerDenied ||
          (identityProbe.data !== undefined && !allowed)
        }
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
});
