import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../src/hooks/useCurrentBrandRole";
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

const firstParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export default function ListingInsightsRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    entry?: string | string[];
  }>();
  const id = firstParam(params.id);
  const { isAuthReady } = useAuth();
  const currentBrand = useCurrentBrand();
  const role = useCurrentBrandRole(currentBrand?.id ?? null);
  const rankSettled = !role.isLoading && !role.isError;
  const scannerDenied = rankSettled && isScannerOnlyRank(role.rank);
  const identityProbe = useQuery<ListingInsightsIdentity, Error>({
    queryKey:
      id === null
        ? listingInsightsKeys.disabledIdentity
        : listingInsightsKeys.identity(id),
    enabled: isAuthReady && rankSettled && !scannerDenied && id !== null,
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
    <SafeScreen>
      <ListingInsightsScreen
        identity={identityProbe}
        rollup={insights.rollup}
        entryPoint={sanitizeBusinessListingInsightsEntryPoint(params.entry)}
        onBack={back}
        onBackToListings={backToListings}
        forceUnavailable={
          scannerDenied || (identityProbe.data !== undefined && !allowed)
        }
      />
    </SafeScreen>
  );
}
