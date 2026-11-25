/** Lazy operational snapshot below a Hub venue card (#4490). */
import React from "react";
import { StyleSheet, View } from "react-native";

import { radius as radiusTokens, color } from "../../constants/designSystem";
import { useStayStaffReservationList } from "../../hooks/useStayStaffReservations";
import { useVenueAvailabilityConfig } from "../../hooks/useVenueAvailability";
import { useVenueDay } from "../../hooks/useVenueDay";
import { useVenueRequests } from "../../hooks/useVenueHire";
import { useVenueReservations } from "../../hooks/useVenueReservations";
import { useVenueWaitlist } from "../../hooks/useVenueWaitlist";
import { StatRow } from "../ui/StatRow";
import { Skeleton } from "../ui/Skeleton";
import { resolveVenueTimeZone } from "./reservationCalendarModel";
import {
  doorSnapshot,
  requestSnapshot,
  setupSnapshot,
  staySnapshot,
  tableSnapshot,
  type VenueCardSnapshotKind,
  type VenueCardSnapshotMetric,
} from "./venueCardSnapshotModel";

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
  const query = useVenueRequests(brandId, venueId, "all");
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return <SnapshotRow items={requestSnapshot(query.data)} testID={testID} />;
}

function StaySnapshot({
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "venueId" | "testID">): React.ReactElement {
  const query = useStayStaffReservationList(venueId);
  if (query.isLoading) return <LoadingSnapshot testID={testID} />;
  return <SnapshotRow items={staySnapshot(query.data)} testID={testID} />;
}

function TablesSnapshot({
  brandId,
  venueId,
  testID,
}: Pick<VenueCardSnapshotProps, "brandId" | "venueId" | "testID">): React.ReactElement {
  const reservations = useVenueReservations(brandId, venueId);
  const waitlist = useVenueWaitlist(brandId, venueId);
  const availability = useVenueAvailabilityConfig(brandId, venueId);
  if (reservations.isLoading || waitlist.isLoading || availability.isLoading) {
    return <LoadingSnapshot testID={testID} />;
  }
  const timeZone = availability.isError
    ? undefined
    : resolveVenueTimeZone(availability.data?.ianaTimezone).timeZone;
  return (
    <SnapshotRow
      items={tableSnapshot({
        reservations: reservations.data,
        waitlist: waitlist.data,
        timeZone,
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
