/**
 * META-ORCH-1148 sub-ORCH 2.1b — Waitlist module (real operator UI).
 *
 * Replaces the Waitlist ComingSoon slot. A live queue (realtime via
 * useVenueWaitlist) of waiting/notified guests with position, party, est wait,
 * preferred seating + Notify (Twilio "table's ready" via send-venue-sms) +
 * Convert-to-reservation (atomic RPC) + mark-lost. Manager-plus gates the
 * controls. a11y labels on every Pressable. Android glass via GlassCard.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  isSmsMarketUnavailableError,
  useAddToWaitlist,
  useConvertWaitlist,
  useMarkWaitlistLost,
  useNotifyWaitlist,
  useVenueWaitlist,
} from "../../hooks/useVenueWaitlist";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { MessageSquare, X } from "lucide-react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { WaitlistAddSheet } from "./WaitlistAddSheet";
import { WaitlistConvertSheet } from "./WaitlistConvertSheet";
import { VenueHubEmptyState } from "./VenueHubEmptyState";
import type {
  VenueTableZone,
  WaitlistAddInput,
  WaitlistEntry,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager;

const ZONE_LABEL: Record<VenueTableZone, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  private_room: "Private room",
  bar: "Bar",
  patio: "Patio",
};

export interface VenueWaitlistModuleProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue this module is scoped to. */
  venueId?: string | null;
  testID?: string;
}

export function VenueWaitlistModule({
  brandId,
  venueId = null,
  testID,
}: VenueWaitlistModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const waitlistQuery = useVenueWaitlist(brandId, venueId);
  const add = useAddToWaitlist(brandId, venueId);
  const notify = useNotifyWaitlist(brandId, venueId);
  const convert = useConvertWaitlist(brandId, venueId);
  const markLost = useMarkWaitlistLost(brandId, venueId);

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [converting, setConverting] = useState<WaitlistEntry | null>(null);

  // The ACTIVE queue (waiting + notified), FIFO by created order.
  const queue = useMemo(
    () =>
      (waitlistQuery.data ?? []).filter(
        (w) => w.status === "waiting" || w.status === "notified",
      ),
    [waitlistQuery.data],
  );

  const handleAdd = useCallback(
    (input: WaitlistAddInput): void => {
      add.mutate(input, { onSuccess: () => setAddOpen(false) });
    },
    [add],
  );

  const handleConvert = useCallback(
    (reservedFor: string, tableId: string | null): void => {
      if (converting === null) return;
      convert.mutate(
        { waitlistId: converting.id, reservedFor, tableId },
        { onSuccess: () => setConverting(null) },
      );
    },
    [convert, converting],
  );

  return (
    <View style={styles.host} testID={testID ?? "venue-waitlist-module"}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            Waitlist{queue.length > 0 ? ` · ${queue.length} waiting` : ""}
          </Text>
          <Text style={styles.subtitle}>
            Drop walk-ins here and text them when a table opens.
          </Text>
        </View>
        {canMutate ? (
          <Button
            label="Add"
            onPress={() => setAddOpen(true)}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            testID="venue-waitlist-add"
          />
        ) : null}
      </View>

      {waitlistQuery.isLoading ? (
        <Text style={styles.helper}>Loading waitlist…</Text>
      ) : waitlistQuery.isError ? (
        <Text style={styles.errorNote}>
          Couldn&apos;t load the waitlist. Pull to refresh.
        </Text>
      ) : queue.length === 0 ? (
        <VenueHubEmptyState
          icon="waitlist"
          title="Nobody's waiting"
          body="When you're full, add walk-ins here and notify them when a table opens."
          actionLabel={canMutate ? "Add to waitlist" : undefined}
          onAction={canMutate ? () => setAddOpen(true) : undefined}
          testID="venue-waitlist-empty"
          wrapTestID="venue-waitlist-empty-wrap"
          actionTestID="venue-waitlist-empty-add"
        />
      ) : (
        <View style={styles.list}>
          {queue.map((w, i) => {
            const parts: string[] = [`Party ${w.partySize}`];
            if (w.quotedWaitMinutes != null) parts.push(`~${w.quotedWaitMinutes}m`);
            if (w.preferredZone != null) parts.push(ZONE_LABEL[w.preferredZone]);
            const notified = w.status === "notified";
            return (
              <GlassCard key={w.id} variant="base" style={styles.card}>
                <View style={styles.cardMain}>
                  <Text style={styles.pos}>{i + 1}</Text>
                  <View style={styles.cardText}>
                    <Text style={styles.guest} numberOfLines={1}>
                      {w.guestName ?? "Guest"}
                    </Text>
                    <Text style={styles.meta}>{parts.join(" · ")}</Text>
                    {notified ? (
                      <Text style={styles.notified}>Notified ✓</Text>
                    ) : null}
                  </View>
                </View>
                {canMutate ? (
                  <View style={styles.actions}>
                    {w.guestPhoneE164 != null ? (
                      <Pressable
                        onPress={() => notify.mutate(w.id)}
                        disabled={notify.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Text ${w.guestName ?? "guest"} their table is ready`}
                        style={styles.notifyBtn}
                        testID={`venue-waitlist-notify-${w.id}`}
                      >
                        <MessageSquare size={15} color="#0c0e12" />
                        <Text style={styles.notifyLabel}>Notify</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => setConverting(w)}
                      accessibilityRole="button"
                      accessibilityLabel={`Seat ${w.guestName ?? "guest"} as a reservation`}
                      style={styles.seatBtn}
                      testID={`venue-waitlist-seat-${w.id}`}
                    >
                      <Text style={styles.seatLabel}>Seat</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => markLost.mutate(w.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${w.guestName ?? "guest"} as left`}
                      style={styles.lostBtn}
                      testID={`venue-waitlist-lost-${w.id}`}
                    >
                      <X size={15} color={textTokens.tertiary} />
                    </Pressable>
                  </View>
                ) : null}
              </GlassCard>
            );
          })}
        </View>
      )}

      {/*
        #1541 — a dark market is NOT a bad phone number, and telling the
        operator to check one is worse than saying nothing: it sends them to fix
        something that is not broken while the guest waits. This branch reads the
        message the hook actually threw. A message that is correctly thrown but
        never rendered is still a silent failure — the same class as every other
        defect in this chain (#1518 -> #1529 -> #1537 -> #1541).
      */}
      {notify.isError ? (
        <Text style={styles.errorNote}>
          {isSmsMarketUnavailableError(notify.error)
            ? notify.error.message
            : "Couldn't send the text. Check the guest's phone number."}
        </Text>
      ) : null}
      <WaitlistAddSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAdd}
        saving={add.isPending}
      />
      <WaitlistConvertSheet
        venueId={venueId}
        visible={converting !== null}
        onClose={() => setConverting(null)}
        brandId={brandId}
        entry={converting}
        onConvert={handleConvert}
        converting={convert.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  helper: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    // ORCH-1190 R2 — full-width queue row on WEB. The row card carried only
    // flexDirection:row, so its single clipped child shrank to min-content on
    // the wide shell. Force full width; the row layout stays on this style.
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pos: {
    ...typography.h3,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
    minWidth: 22,
  },
  cardText: {
    flex: 1,
    gap: spacing.xxs,
  },
  guest: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  meta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  notified: {
    ...typography.caption,
    color: semantic.success,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  notifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "#eb7825",
  },
  notifyLabel: {
    ...typography.caption,
    color: "#0c0e12",
    fontWeight: "700",
  },
  seatBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  seatLabel: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
  },
  lostBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
  },
});

export default VenueWaitlistModule;
