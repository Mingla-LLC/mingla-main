/**
 * #4490 N20 — the add-venue success screen says which chosen features still
 * need setting up ("Private hire needs a space first: add one, then switch it
 * on") with a button to the right place, instead of dropping them silently.
 */
import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useVenueFeatures } from "../../../hooks/useVenueFeatures";
import { venueFeatureKeys } from "../../../hooks/venueFeatureKeys";
import { FeatureSetupNeedsCard } from "./FeatureSetupNeedsCard";
import { featureSetupNeeds, type SetupRefusal, type SetupTarget } from "./featureSetupModel";

export function CreatedVenueSetupNeeds({
  brandId,
  venueId,
  onOpen,
}: {
  brandId: string | null;
  venueId: string;
  onOpen: (target: SetupTarget) => void;
}): React.ReactElement | null {
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const refusedQuery = useQuery<SetupRefusal[]>({
    queryKey: venueFeatureKeys.startRefused(venueId),
    queryFn: () => [],
    enabled: false,
    staleTime: Infinity,
  });
  const needs = useMemo(
    () =>
      featureSetupNeeds({
        features: featuresQuery.data?.features ?? null,
        activeSpaceCount: featuresQuery.data?.activeSpaceCount ?? 0,
        refused: refusedQuery.data ?? null,
      }),
    [featuresQuery.data, refusedQuery.data],
  );
  return <FeatureSetupNeedsCard needs={needs} onOpen={onOpen} testID="venue-create-setup-needs" />;
}
