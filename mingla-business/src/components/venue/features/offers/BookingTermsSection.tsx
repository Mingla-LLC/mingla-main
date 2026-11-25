/**
 * #4490 P2-4 — Settings › Terms and tax › "Selling offers": the venue-level
 * booking terms every offer uses (`issue_4490_save_booking_settings`):
 *  - VAT: added at checkout, included in the price, or not charged (the rate
 *    comes from the venue's country, never typed; 05 conflict 26, §7 Q2);
 *  - how long an unpaid checkout holds places;
 *  - how far ahead guests can book;
 *  - pause all bookings (offers stay listed, nobody can buy).
 * Saves on its own button, with the version it read; a newer save elsewhere
 * says so and reloads.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import { useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { useSaveBookingSettings, useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { BookingState, VatMode, VenueBookingSettings } from "../../../../types/venueOffers";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { GlassCard } from "../../../ui/GlassCard";
import { Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Skeleton } from "../../../ui/Skeleton";
import { offerErrorCopy, vatLine, vatRateLabel } from "./offersModel";

const HOLD_OPTIONS = [5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: `${m} minutes` }));
const HORIZON_OPTIONS = [
  { value: 30, label: "1 month" },
  { value: 60, label: "2 months" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
];

type Draft = Pick<VenueBookingSettings, "vatMode" | "instantPaymentHoldMinutes" | "bookingHorizonDays" | "bookingState">;

function draftOf(s: VenueBookingSettings): Draft {
  return {
    vatMode: s.vatMode,
    instantPaymentHoldMinutes: s.instantPaymentHoldMinutes,
    bookingHorizonDays: s.bookingHorizonDays,
    bookingState: s.bookingState,
  };
}

export interface BookingTermsSectionProps {
  brandId: string | null;
  venueId: string | null;
  canEdit: boolean;
}

export function BookingTermsSection({ brandId, venueId, canEdit }: BookingTermsSectionProps): React.ReactElement | null {
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const entryOn = featuresQuery.data?.features.entry.enabled === true;
  const offersQuery = useVenueOffers(brandId, venueId, { enabled: entryOn });
  const save = useSaveBookingSettings(brandId, venueId);
  const settings = offersQuery.data?.settings ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string; stale?: boolean } | null>(null);

  useEffect(() => {
    if (settings !== null && draft === null) setDraft(draftOf(settings));
  }, [draft, settings]);

  if (!entryOn) return null;
  if (offersQuery.isLoading || (settings !== null && draft === null)) return <Skeleton height={160} radius="md" />;
  if (offersQuery.isError) {
    return (
      <GlassCard variant="base" padding={space[4]} contentStyle={styles.card}>
        <Text style={styles.title}>Selling offers</Text>
        <Text style={styles.error}>Couldn&apos;t load your booking terms.</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={() => void offersQuery.refetch()} />
      </GlassCard>
    );
  }
  // No settings row yet: the server creates it with the first offer.
  const base: Draft = settings !== null ? draftOf(settings) : { vatMode: "added", instantPaymentHoldMinutes: 15, bookingHorizonDays: 365, bookingState: "active" };
  const current = draft ?? base;
  const dirty = JSON.stringify(current) !== JSON.stringify(base);
  const rate = vatRateLabel(settings?.vatRateBps ?? null);
  const patch = (next: Partial<Draft>): void => {
    setStatus(null);
    setDraft({ ...current, ...next });
  };

  const submit = (): void => {
    setStatus(null);
    save.mutate(
      { settings: current, expectedVersion: settings?.version ?? null },
      {
        onSuccess: (saved) => {
          if (saved !== null) setDraft(draftOf(saved));
          setStatus({ kind: "saved", text: "Booking terms saved" });
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setStatus({ kind: "error", text: offerErrorCopy(err.code, err.detail), stale: err.code === "stale_write" });
        },
      },
    );
  };

  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="venue-settings-booking-terms">
      <Text style={styles.title} accessibilityRole="header">Selling offers</Text>
      <Text style={styles.body}>These apply to every offer at this venue.</Text>

      <Text style={styles.label}>VAT{rate !== null ? ` (${rate})` : ""}</Text>
      <Segmented<VatMode>
        options={[
          { key: "added", label: "Add at checkout" },
          { key: "included", label: "Included in price" },
          { key: "none", label: "Not charged" },
        ]}
        value={current.vatMode}
        onChange={(vatMode) => canEdit && patch({ vatMode })}
        accessibilityLabel="VAT"
        testID="booking-terms-vat"
      />
      <Text style={styles.hint}>
        {vatLine(current.vatMode, settings?.vatRateBps ?? null)}. {current.vatMode === "none" ? "Choose this only if the venue isn't VAT registered." : "The rate comes from the venue's country."}
      </Text>

      <SelectSheet
        label="Hold places while a guest pays"
        value={current.instantPaymentHoldMinutes}
        options={HOLD_OPTIONS}
        onChange={(instantPaymentHoldMinutes) => patch({ instantPaymentHoldMinutes })}
        disabled={!canEdit}
        testID="booking-terms-hold"
      />
      <SelectSheet
        label="Guests can book up to"
        value={current.bookingHorizonDays}
        options={HORIZON_OPTIONS.some((o) => o.value === current.bookingHorizonDays) ? HORIZON_OPTIONS : [...HORIZON_OPTIONS, { value: current.bookingHorizonDays, label: `${current.bookingHorizonDays} days` }]}
        onChange={(bookingHorizonDays) => patch({ bookingHorizonDays })}
        disabled={!canEdit}
        testID="booking-terms-horizon"
      />
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Pause all bookings</Text>
          <Text style={styles.hint}>Offers stay on your page, but nobody can buy until you switch this off. Passes already bought stay valid.</Text>
        </View>
        <BrandSwitch
          value={current.bookingState === "paused"}
          onValueChange={(on) => patch({ bookingState: (on ? "paused" : "active") as BookingState })}
          disabled={!canEdit}
          accessibilityLabel="Pause all bookings"
          testID="booking-terms-pause"
        />
      </View>

      {status !== null ? (
        <Text style={status.kind === "error" ? styles.error : styles.saved} accessibilityLiveRegion="polite" testID="booking-terms-status">
          {status.text}
        </Text>
      ) : null}
      {canEdit ? (
        <View style={styles.actions}>
          {dirty ? (
            <Button label="Discard" variant="ghost" size="sm" onPress={() => { setDraft(base); setStatus(null); }} disabled={save.isPending} />
          ) : null}
          {status?.stale === true ? (
            <Button
              label="Reload"
              variant="secondary"
              size="sm"
              onPress={() => {
                setDraft(null);
                setStatus(null);
                void offersQuery.refetch();
              }}
            />
          ) : null}
          <Button label="Save booking terms" variant="primary" size="sm" onPress={submit} disabled={!dirty} loading={save.isPending} testID="booking-terms-save" />
        </View>
      ) : (
        <Text style={styles.hint}>Ask a brand owner, admin or event manager to change these.</Text>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  title: { ...type.h2, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  label: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  saved: { ...type.caption, color: color.success },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  switchTitle: { ...type.row, color: color.text1 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space[2], flexWrap: "wrap" },
});
