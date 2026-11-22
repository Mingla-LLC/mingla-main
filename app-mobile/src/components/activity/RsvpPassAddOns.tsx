/**
 * issue #3281 S6 — the add-ons on the guest's own RSVP, on their pass
 * (RsvpPassSheet): "Add-ons · Reserved seat × 1 · Tote bag × 2".
 *
 * Read only while FEATURE_FLAG_ADD_ONS is on, for the RSVP's owner, through
 * issue_3281_my_rsvp_add_ons (it answers only the signed-in owner of a going,
 * not-denied RSVP). None: nothing is drawn. A failed read says so and offers a
 * retry; the rest of the pass is unaffected.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { FEATURE_FLAG_ADD_ONS } from "../../config/featureFlags";
import { rsvpAddOnsKeys } from "../../hooks/queryKeys";
import { fetchMyRsvpAddOns } from "../../services/rsvpDeckService";

export interface RsvpPassAddOnsProps {
  rsvpId: string;
  /** The sheet is open and the viewer owns this approved RSVP. */
  enabled: boolean;
}

export function RsvpPassAddOns({ rsvpId, enabled }: RsvpPassAddOnsProps): React.ReactElement | null {
  const query = useQuery({
    queryKey: rsvpAddOnsKeys.mine(rsvpId),
    enabled: FEATURE_FLAG_ADD_ONS && enabled,
    staleTime: 30_000,
    queryFn: () => fetchMyRsvpAddOns(rsvpId),
  });
  if (!FEATURE_FLAG_ADD_ONS || !enabled) return null;
  if (query.isError) {
    return (
      <View style={styles.card} testID="issue-3281-rsvp-pass-add-ons-error">
        <Text style={styles.meta}>Your add-ons didn&apos;t load.</Text>
        <Pressable
          onPress={() => void query.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try loading your add-ons again"
          hitSlop={8}
        >
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const addOns = query.data ?? [];
  if (addOns.length === 0) return null;
  const line = addOns.map((item) => `${item.name} × ${item.quantity}`).join(" · ");
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Add-ons: ${line}`}
      testID="issue-3281-rsvp-pass-add-ons"
    >
      <Text style={styles.title}>Add-ons</Text>
      <Text style={styles.meta}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 14,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: { color: "#fff", fontSize: 14, fontWeight: "700" },
  meta: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18 },
  retry: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
