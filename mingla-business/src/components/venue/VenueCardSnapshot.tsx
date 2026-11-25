/** Lazy operational snapshot below a Hub venue card (#4490). */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { radius as radiusTokens, color } from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useVenueDay } from "../../hooks/useVenueDay";
import { StatRow } from "../ui/StatRow";
import { Skeleton } from "../ui/Skeleton";
import {
  doorSnapshot,
  requestSnapshot,
  setupSnapshot,
  staySnapshot,
  tableSnapshot,
  type VenueCardSnapshotMetric,
} from "./venueCardSnapshotModel";
import type { VenueCardSnapshotKind } from "./venueCardSnapshotKind";

export interface VenueCardSnapshotProps {
  kind: VenueCardSnapshotKind;
  brandId: string;
  venueId: string;
  enabledFeatures: number | null;
  menuItems: number | null;
  openFixes: number | null;
  testID?: string;
}

function SnapshotRow({
  items,
  testID,
}: {
  items: readonly VenueCardSnapshotMetric[];
  testID?: string;
}): React.ReactElement {
  return <StatRow items={items} style={styles.stats} testID={testID} />;
}

function LoadingSnapshot({ testID }: { testID?: string }): React.ReactElement {
  return (
    <Skeleton
      height={92}
      radius="md"
      testID={testID !== undefined ? `${testID}-loading` : undefined}
    />
  );
}

function DoorSnapshot({
  brandId,
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "brandId" | "venueId" | "testID">): React.ReactElement {
  const query = useVenueDay(brandId, venueId, null, { live: true });
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return <SnapshotRow items={doorSnapshot(query.data)} testID={testID} />;
}

function RequestsSnapshot({
  brandId,
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "brandId" | "venueId" | "testID">): React.ReactElement {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: ["venueCardSnapshot", "requests", brandId, venueId] as const,
    enabled: isAuthReady,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () =>
      (await import("./venueCardSnapshotReads")).readRequestSnapshot(venueId),
  });
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return <SnapshotRow items={requestSnapshot(query.data)} testID={testID} />;
}

function StaySnapshot({
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "venueId" | "testID">): React.ReactElement {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: ["venueCardSnapshot", "stay", venueId] as const,
    enabled: isAuthReady,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () =>
      (await import("./venueCardSnapshotReads")).readStaySnapshot(venueId),
  });
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return <SnapshotRow items={staySnapshot(query.data)} testID={testID} />;
}

function TablesSnapshot({
  brandId,
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "brandId" | "venueId" | "testID">): React.ReactElement {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: ["venueCardSnapshot", "tables", brandId, venueId] as const,
    enabled: isAuthReady,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () =>
      (await import("./venueCardSnapshotReads")).readTableSnapshot(
        brandId,
        venueId,
      ),
  });
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return (
    <SnapshotRow
      items={tableSnapshot({
        reservations: query.data?.reservations,
        waitlist: query.data?.waitlist,
        timeZone: query.data?.timeZone,
      })}
      testID={testID}
    />
  );
}

export function VenueCardSnapshot({
  kind,
  brandId,
  venueId,
  enabledFeatures,
  menuItems,
  openFixes,
  testID,
}: VenueCardSnapshotProps): React.ReactElement {
  return (
    <View style={styles.slot}>
      {kind === "door" ? (
        <DoorSnapshot brandId={brandId} venueId={venueId} testID={testID} />
      ) : kind === "requests" ? (
        <RequestsSnapshot brandId={brandId} venueId={venueId} testID={testID} />
      ) : kind === "stay" ? (
        <StaySnapshot venueId={venueId} testID={testID} />
      ) : kind === "tables" ? (
        <TablesSnapshot brandId={brandId} venueId={venueId} testID={testID} />
      ) : (
        <SnapshotRow
          items={setupSnapshot({ enabledFeatures, menuItems, openFixes })}
          testID={testID}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: 92 },
  stats: {
    height: "100%",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
  },
});

export default VenueCardSnapshot;
