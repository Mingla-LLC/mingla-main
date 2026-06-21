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
  useAddToWaitlist,
  useConvertWaitlist,
  useMarkWaitlistLost,
  useNotifyWaitlist,
  useVenueWaitlist,
} from "../../hooks/useVenueWaitlist";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { WaitlistAddSheet } from "./WaitlistAddSheet";
import { WaitlistConvertSheet } from "./WaitlistConvertSheet";
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
  testID?: string;
}

export function VenueWaitlistModule({
  brandId,
  testID,
}: VenueWaitlistModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const waitlistQuery = useVenueWaitlist(brandId);
  const add = useAddToWaitlist(brandId);
  const notify = useNotifyWaitlist(brandId);
  const convert = useConvertWaitlist(brandId);
  const markLost = useMarkWaitlistLost(brandId);

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
      ) : queue.length === 0 ? (
        <GlassCard variant="elevated" style={styles.emptyCard}>
          <Icon name="clock" size={26} color={textTokens.primary} />
          <Text style={styles.emptyTitle}>Nobody&apos;s waiting</Text>
          <Text style={styles.emptyBody}>
            When you&apos;re full, add walk-ins here and notify them when a table
            opens.
          </Text>
          {canMutate ? (
            <Button
              label="Add to waitlist"
              onPress={() => setAddOpen(true)}
              variant="secondary"
              size="md"
              testID="venue-waitlist-empty-add"
            />
          ) : null}
        </GlassCard>
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
                        <Icon name="sms" size={15} color="#0c0e12" />
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
                      <Icon name="close" size={15} color={textTokens.tertiary} />
                    </Pressable>
                  </View>
                ) : null}
              </GlassCard>
            );
          })}
        </View>
      )}

      {notify.isError ? (
        <Text style={styles.errorNote}>
          Couldn&apos;t send the text. Check the guest&apos;s phone number.
        </Text>
      ) : null}
      {waitlistQuery.isError ? (
        <Text style={styles.errorNote}>
          Couldn&apos;t load the waitlist. Pull to refresh.
        </Text>
      ) : null}

      <WaitlistAddSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAdd}
        saving={add.isPending}
      />
      <WaitlistConvertSheet
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
  emptyCard: {
    // ORCH-1190 R2 — full-width empty card on WEB (see VenueReservationsModule).
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
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
