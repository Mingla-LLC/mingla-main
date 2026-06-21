/**
 * META-ORCH-1148 sub-ORCH 2.1b — Reservations module (real operator UI).
 *
 * Replaces the Reservations ComingSoon slot. Segmented views (Today / Upcoming /
 * Waitlist / Completed / No-shows / Canceled — a control INSIDE the module, not a
 * 3rd nav level), a live list of ReservationCards (realtime via useVenueReservations),
 * a detail sheet with guarded lifecycle actions, and manual create. Manager-plus
 * gates the controls in the UI (the RPCs re-enforce server-side). a11y labels on
 * every Pressable. Android glass via GlassCard.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  useCreateReservation,
  useTransitionReservation,
  useVenueReservations,
} from "../../hooks/useVenueReservations";
import { useVenueTables } from "../../hooks/useVenueTables";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { ReservationCard } from "./ReservationCard";
import { ReservationCreateSheet } from "./ReservationCreateSheet";
import { ReservationDetailSheet } from "./ReservationDetailSheet";
import {
  ACTION_TARGET,
  RESERVATION_VIEWS,
  filterReservationsForView,
} from "./reservationViews";
import type {
  Reservation,
  ReservationAction,
  ReservationCreateInput,
  ReservationView,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager;

const VIEW_EMPTY: Record<ReservationView, string> = {
  today: "No reservations today yet.",
  upcoming: "No upcoming reservations yet.",
  waitlist: "No waitlisted reservations.",
  completed: "No completed reservations yet.",
  no_shows: "No no-shows. Nice.",
  canceled: "No canceled reservations.",
};

export interface VenueReservationsModuleProps {
  brandId: string | null;
  testID?: string;
}

export function VenueReservationsModule({
  brandId,
  testID,
}: VenueReservationsModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const reservationsQuery = useVenueReservations(brandId);
  const tablesQuery = useVenueTables(brandId);
  const create = useCreateReservation(brandId);
  const transition = useTransitionReservation(brandId);

  const [view, setView] = useState<ReservationView>("today");
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<Reservation | null>(null);

  const tableNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tablesQuery.data ?? []) map.set(t.id, t.name);
    return map;
  }, [tablesQuery.data]);

  const reservations = reservationsQuery.data;
  const visible = useMemo(
    () => filterReservationsForView(reservations ?? [], view),
    [reservations, view],
  );

  const handleSave = useCallback(
    (input: ReservationCreateInput): void => {
      create.mutate(input, {
        onSuccess: () => setCreateOpen(false),
      });
    },
    [create],
  );

  const handleAction = useCallback(
    (r: Reservation, action: ReservationAction): void => {
      transition.mutate(
        { reservationId: r.id, toStatus: ACTION_TARGET[action] },
        { onSuccess: () => setSelected(null) },
      );
    },
    [transition],
  );

  return (
    <View style={styles.host} testID={testID ?? "venue-reservations-module"}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Reservations</Text>
          <Text style={styles.subtitle}>
            Bookings from Mingla and your own — all in one list.
          </Text>
        </View>
        {canMutate ? (
          <Button
            label="New"
            onPress={() => setCreateOpen(true)}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            testID="venue-reservations-new"
          />
        ) : null}
      </View>

      {/* Segmented views (inside the module — not a 3rd nav level). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segRow}
        accessibilityRole="tablist"
      >
        {RESERVATION_VIEWS.map((v) => {
          const active = v.id === view;
          return (
            <Pressable
              key={v.id}
              onPress={() => setView(v.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${v.label} reservations`}
              style={[styles.seg, active ? styles.segActive : null]}
              testID={`venue-reservations-view-${v.id}`}
            >
              <Text style={[styles.segLabel, active ? styles.segLabelActive : null]}>
                {v.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {reservationsQuery.isLoading ? (
        <Text style={styles.helper}>Loading reservations…</Text>
      ) : visible.length === 0 ? (
        <View style={styles.emptyWrap} testID="venue-reservations-empty-wrap">
          <GlassCard variant="elevated" style={styles.emptyCard}>
            <Icon name="calendar" size={26} color={textTokens.primary} />
            <Text style={styles.emptyTitle}>{VIEW_EMPTY[view]}</Text>
            {view === "today" || view === "upcoming" ? (
              <Text style={styles.emptyBody}>
                When guests book — from Mingla or here — they land in this list.
              </Text>
            ) : null}
            {canMutate && (view === "today" || view === "upcoming") ? (
              <Button
                label="Add one to test"
                onPress={() => setCreateOpen(true)}
                variant="secondary"
                size="md"
                testID="venue-reservations-empty-add"
              />
            ) : null}
          </GlassCard>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((r) => (
            <ReservationCard
              key={r.id}
              reservation={r}
              tableName={r.tableId != null ? (tableNameById.get(r.tableId) ?? null) : null}
              onPress={setSelected}
            />
          ))}
        </View>
      )}

      {reservationsQuery.isError ? (
        <Text style={styles.errorNote}>
          Couldn&apos;t load reservations. Pull to refresh.
        </Text>
      ) : null}

      <ReservationCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        brandId={brandId}
        onSave={handleSave}
        saving={create.isPending}
      />
      <ReservationDetailSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        reservation={selected}
        tableName={
          selected?.tableId != null
            ? (tableNameById.get(selected.tableId) ?? null)
            : null
        }
        onAction={handleAction}
        acting={transition.isPending}
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
  segRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  seg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segActive: {
    backgroundColor: accent.warm,
  },
  segLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  segLabelActive: {
    color: "#0c0e12",
  },
  helper: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  // ORCH-1190 R3 — full-width empty card on WEB, robustly. The empty card is now
  // wrapped in a stretching WRAPPER (alignSelf:"stretch") and the card itself
  // stretches via alignSelf WITHOUT width:"100%". Empirically (Playwright + real
  // react-native-web, see Mingla_Artifacts/reports/IMPLEMENT_ORCH-1190-FULLWIDTH-WEB.md):
  // an explicit `width:"100%"` resolves against the parent's content-box and, when
  // a flex ancestor leaves that width indefinite, can DEFEAT `alignSelf:"stretch"`
  // (an explicit main-size overrides stretch in flexbox) — collapsing the card to
  // its centered content's min width while the row-based header + horizontal tab
  // ScrollView still read full-width. Dropping `width:"100%"` and letting the
  // wrapper + card stretch is immune to indefinite-width ancestors.
  emptyWrap: {
    alignSelf: "stretch",
  },
  emptyCard: {
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
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
  },
});

export default VenueReservationsModule;
