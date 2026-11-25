/**
 * #4490 P4-2 — "Waiting on you" on Overview and Today: requests to answer and
 * deposits still owed (counts from `issue_4490_requests_list`), with the
 * nearest reply clock and Open Requests. Hidden when nothing waits and when
 * the read fails (the module itself shows the error).
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import { useVenueRequests } from "../../../../hooks/useVenueHire";
import { Button } from "../../../ui/Button";
import { GlassCard } from "../../../ui/GlassCard";
import { leftWords } from "./requestsModel";

export interface RequestsWaitingCardProps {
  brandId: string | null;
  venueId: string | null;
  onOpenRequests: () => void;
}

export function RequestsWaitingCard({ brandId, venueId, onOpenRequests }: RequestsWaitingCardProps): React.ReactElement | null {
  const query = useVenueRequests(brandId, venueId, "to_answer");
  const soonest = useMemo(() => {
    const now = Date.now();
    const clocks = (query.data?.requests ?? [])
      .map((r) => leftWords(r.replyBy, now))
      .filter((x): x is string => x !== null);
    return clocks[0] ?? null;
  }, [query.data?.requests]);
  const counts = query.data?.counts;
  if (counts === undefined || (counts.toAnswer === 0 && counts.waitingForDeposit === 0)) return null;
  const parts = [
    counts.toAnswer > 0 ? `${counts.toAnswer} ${counts.toAnswer === 1 ? "request" : "requests"} to answer` : null,
    counts.waitingForDeposit > 0 ? `${counts.waitingForDeposit} waiting for a deposit` : null,
  ].filter((x): x is string => x !== null);
  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="venue-requests-waiting">
      <View style={styles.text}>
        <Text style={styles.title}>Waiting on you</Text>
        <Text style={styles.meta}>
          {parts.join(" · ")}
          {soonest !== null && counts.toAnswer > 0 ? ` · next reply due in ${soonest}` : ""}
        </Text>
      </View>
      <Button label="Open Requests" variant="secondary" size="sm" onPress={onOpenRequests} testID="venue-requests-waiting-open" />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  text: { flex: 1, minWidth: 200, gap: 2 },
  title: { ...type.row, color: color.text1 },
  meta: { ...type.caption, color: color.text3 },
});
