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
  color,
  size,
  space,
  type,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  isSmsMarketUnavailableError,
  useAddToWaitlist,
  useConvertWaitlist,
  useMarkWaitlistLost,
  useNotifyWaitlist,
  useOfferWaitlistTable,
  useVenueWaitlist,
} from "../../hooks/useVenueWaitlist";
import { useSetVenueFeature, useVenueFeatures } from "../../hooks/useVenueFeatures";
import { useVenueEditAccess } from "../../hooks/useVenueEditAccess";
import { useVenueAvailabilityConfig } from "../../hooks/useVenueAvailability";
import { Switch } from "../ui/Switch";
import { useVenueSpaces } from "../../hooks/useVenueSpaces";
import { Pill } from "../ui/Pill";
import { waitlistWantsLine } from "./features/floor/waitlistHostModel";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { Check, MessageSquare, X } from "lucide-react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { WaitlistAddSheet } from "./WaitlistAddSheet";
import { WaitlistConvertSheet } from "./WaitlistConvertSheet";
import { VenueHubEmptyState } from "./VenueHubEmptyState";

const LazyToast = React.lazy(async () => {
  const mod = await import("../ui/Toast");
  return { default: mod.Toast };
});
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

/** The toast after seating a waitlist guest (#4490 R4J-N25). */
export function seatedToastCopy(name: string, reservationsLabel: string): string {
  return `${name} is seated. They're in ${reservationsLabel} now.`;
}

export interface VenueWaitlistModuleProps {
  brandId: string | null;
  /** META-ORCH-1255 — the venue this module is scoped to. */
  venueId?: string | null;
  testID?: string;
  /**
   * #4490 R4J-N25 — the name of the screen a seated guest's booking appears
   * in. A Stay calls it "Table reservations"; the ordinary shell keeps the
   * default.
   */
  reservationsLabel?: string;
}

export function VenueWaitlistModule({
  brandId,
  venueId = null,
  testID,
  reservationsLabel = "Reservations",
}: VenueWaitlistModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const waitlistQuery = useVenueWaitlist(brandId, venueId);
  const add = useAddToWaitlist(brandId, venueId);
  const notify = useNotifyWaitlist(brandId, venueId);
  const convert = useConvertWaitlist(brandId, venueId);
  const markLost = useMarkWaitlistLost(brandId, venueId);
  // #4490 P5 — guests join online; staff tell them a table is ready.
  const offer = useOfferWaitlistTable(brandId, venueId);
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const waitlistFeature = featuresQuery.data?.features.waitlist ?? null;
  const venueTimeZone = useVenueAvailabilityConfig(brandId, venueId).data?.ianaTimezone ?? undefined;
  const guestJoinOn = waitlistFeature !== null && waitlistFeature.settings.guestJoin !== false;
  const [settingError, setSettingError] = useState<string | null>(null);
  const toggleGuestJoin = (next: boolean): void => {
    if (waitlistFeature === null) return;
    setSettingError(null);
    setFeature.mutate(
      {
        key: "waitlist",
        enabled: waitlistFeature.enabled,
        cascade: false,
        expectedVersion: waitlistFeature.version,
        settings: { ...waitlistFeature.settings, guestJoin: next },
      },
      { onError: () => setSettingError("Couldn't change that. Try again.") },
    );
  };

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [converting, setConverting] = useState<WaitlistEntry | null>(null);
  // #4490 fix 3 (N111) — every add and seat says it worked.
  const [toast, setToast] = useState<string | null>(null);
  // #4490 fix 3 (N112) — the venue's own spaces name a walk-in's seating.
  const spaces = useVenueSpaces(brandId, venueId).data ?? [];
  const spaceName = (id: string | null | undefined): string | null =>
    id == null ? null : spaces.find((s) => s.id === id)?.name ?? null;

  // The ACTIVE queue (waiting + notified), FIFO by created order. #4490 P5 —
  // a guest who asked for a later day sorts by that day.
  const queue = useMemo(
    () =>
      (waitlistQuery.data ?? [])
        .filter((w) => w.status === "waiting" || w.status === "notified")
        .sort((a, b) => (a.desiredDate ?? "").localeCompare(b.desiredDate ?? "")),
    [waitlistQuery.data],
  );
  const leftToday = useMemo(
    () =>
      (waitlistQuery.data ?? []).filter(
        (w) => w.leftByGuestAt != null && Date.now() - Date.parse(w.leftByGuestAt) < 24 * 3600 * 1000,
      ),
    [waitlistQuery.data],
  );

  const handleAdd = useCallback(
    (input: WaitlistAddInput): void => {
      add.mutate(input, {
        onSuccess: () => {
          setAddOpen(false);
          setToast(`${input.guestName ?? "Guest"} is on the waitlist`);
        },
      });
    },
    [add],
  );

  const handleConvert = useCallback(
    (reservedFor: string, tableId: string | null): void => {
      if (converting === null) return;
      const name = converting.guestName ?? "Guest";
      convert.mutate(
        { waitlistId: converting.id, reservedFor, tableId },
        {
          onSuccess: () => {
            setConverting(null);
            setToast(seatedToastCopy(name, reservationsLabel));
          },
        },
      );
    },
    [convert, converting, reservationsLabel],
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
          // #4490 fix 3 (N111) — the one add button (the empty state has none).
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

      {waitlistFeature !== null && waitlistFeature.enabled && access.canSwitchFeatures ? (
        <View style={styles.settingRow}>
          <View style={styles.headerText}>
            <Text style={styles.guest}>Guests can join online</Text>
            <Text style={styles.subtitle}>
              {guestJoinOn
                ? "Your booking page offers the waitlist when a time is full, with no account needed."
                : "Only your staff add people to the waitlist."}
            </Text>
          </View>
          <Switch
            value={guestJoinOn}
            onValueChange={toggleGuestJoin}
            disabled={setFeature.isPending}
            accessibilityLabel="Guests can join online"
            testID="venue-waitlist-guest-join"
          />
        </View>
      ) : null}
      {settingError !== null ? <Text style={styles.errorNote}>{settingError}</Text> : null}
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
          body={
            canMutate
              ? "When you're full, use Add to put walk-ins here and tell them when a table opens."
              : "When the venue is full, walk-ins wait here until a table opens."
          }
          testID="venue-waitlist-empty"
          wrapTestID="venue-waitlist-empty-wrap"
          actionTestID="venue-waitlist-empty-add"
        />
      ) : (
        <View style={styles.list}>
          {queue.map((w, i) => {
            const parts: string[] = [`Party ${w.partySize}`];
            if (w.quotedWaitMinutes != null) parts.push(`~${w.quotedWaitMinutes}m`);
            const wantsSpace = spaceName(w.preferredSpaceId);
            if (wantsSpace !== null) parts.push(wantsSpace);
            else if (w.preferredZone != null) parts.push(ZONE_LABEL[w.preferredZone]);
            const notified = w.status === "notified";
            const online = w.source === "guest";
            const wants = waitlistWantsLine(w);
            return (
              <GlassCard
                key={w.id}
                variant="base"
                style={styles.card}
                contentStyle={styles.cardContent}
              >
                <View style={styles.cardMain}>
                  <Text style={styles.pos}>{i + 1}</Text>
                  <View style={styles.cardText}>
                    <Text style={styles.guest} numberOfLines={1}>
                      {w.guestName ?? "Guest"}
                    </Text>
                    <Text style={styles.meta}>{parts.join(" · ")}</Text>
                    {online || wants !== null ? (
                      <View style={styles.tagRow}>
                        {online ? <Pill variant="info">Joined online</Pill> : null}
                        {wants !== null ? <Text style={styles.meta}>{wants}</Text> : null}
                      </View>
                    ) : null}
                    {notified ? (
                      <Text style={styles.notified}>
                        {w.offeredSlotAt != null
                          ? `Told a table is free at ${new Date(w.offeredSlotAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: venueTimeZone })}`
                          : w.notifiedAt != null
                            ? `Told their table is ready at ${new Date(w.notifiedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: venueTimeZone })}`
                            : "Told their table is ready"}
                      </Text>
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
                        <MessageSquare size={15} color={color.text1} />
                        <Text style={styles.notifyLabel}>Notify</Text>
                      </Pressable>
                    ) : null}
                    {!notified && (online || w.guestPhoneE164 == null) ? (
                      <Pressable
                        onPress={() => offer.mutate(w.id)}
                        disabled={offer.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Tell ${w.guestName ?? "guest"} their table is ready`}
                        style={styles.notifyBtn}
                        testID={`venue-waitlist-ready-${w.id}`}
                      >
                        <MessageSquare size={15} color={color.text1} />
                        <Text style={styles.notifyLabel}>Table ready</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => setConverting(w)}
                      accessibilityRole="button"
                      accessibilityLabel={`Seat ${w.guestName ?? "guest"} as a reservation`}
                      style={styles.seatBtn}
                      testID={`venue-waitlist-seat-${w.id}`}
                    >
                      <Check size={15} color={color.text1} />
                      <Text style={styles.seatLabel}>Seat</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => markLost.mutate(w.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${w.guestName ?? "guest"} as left`}
                      style={styles.lostBtn}
                      testID={`venue-waitlist-lost-${w.id}`}
                    >
                      <X size={15} color={color.text3} />
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
      {offer.isError ? (
        <Text style={styles.errorNote}>Couldn&apos;t tell them. Try again.</Text>
      ) : null}
      {leftToday.length > 0 ? (
        <Text style={styles.helper} testID="venue-waitlist-left">
          {`Left the waitlist today: ${leftToday.map((w) => w.guestName ?? "Guest").join(", ")}`}
        </Text>
      ) : null}
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
        venueId={venueId}
        brandId={brandId}
        error={add.isError ? "Couldn't add them. Check the details and try again." : null}
      />
      <WaitlistConvertSheet
        venueId={venueId}
        visible={converting !== null}
        onClose={() => setConverting(null)}
        brandId={brandId}
        entry={converting}
        onConvert={handleConvert}
        converting={convert.isPending}
        error={convert.isError ? "Couldn't seat them. Pick the time again and retry." : null}
        timeZone={venueTimeZone}
      />
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-waitlist-toast" />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    gap: space[4],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[4],
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.h1,
    color: color.text1,
  },
  subtitle: {
    ...type.small,
    color: color.text2,
  },
  helper: {
    ...type.small,
    color: color.text2,
  },
  list: {
    gap: space[2],
  },
  card: {
    // ORCH-1190 R2 — full-width queue row on WEB.
    width: "100%",
    alignSelf: "stretch",
  },
  // #4420 — the content fills the card (it shrank to min-content inside the
  // glass wrapper): the guest on top, the actions on their own row.
  cardContent: {
    alignSelf: "stretch",
    gap: space[3],
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  pos: {
    ...type.h1,
    color: color.text3,
    fontVariant: ["tabular-nums"],
    minWidth: 22,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  guest: {
    ...type.row,
    color: color.text1,
    fontWeight: "600",
  },
  meta: {
    ...type.small,
    color: color.text2,
  },
  notified: {
    ...type.caption,
    color: color.success,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: 22 + space[2],
  },
  // #4420 — quiet pill buttons (icon + word), 36pt tall, on the space scale.
  notifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    height: size.btn.md,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  notifyLabel: {
    ...type.btnSm,
    color: color.text1,
  },
  seatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    height: size.btn.md,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  seatLabel: {
    ...type.btnSm,
    color: color.text1,
  },
  lostBtn: {
    width: size.btn.md,
    height: size.btn.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 44,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: 2 },
  errorNote: {
    ...type.small,
    color: color.danger,
  },
});

export default VenueWaitlistModule;
