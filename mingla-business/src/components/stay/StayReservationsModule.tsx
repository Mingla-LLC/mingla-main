import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuest";
import { CalendarDays, ChevronRight } from "lucide-react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  stayReservationsMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStayStaffReservationList } from "../../hooks/useStayStaffReservations";
import type { StayStaffReservationSummary } from "../../types/stayReservation";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { StayReservationManagementDetail } from "./StayReservationManagementDetail";

type StayReservationView =
  | "needs_response"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "reconciliation";

const VIEWS: readonly { id: StayReservationView; label: string }[] = [
  { id: "needs_response", label: "Needs response" },
  { id: "awaiting_payment", label: "Awaiting payment" },
  { id: "confirmed", label: "Confirmed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "reconciliation", label: "Reconciliation" },
];

const EMPTY_COPY: Record<StayReservationView, { title: string; body: string }> =
  {
    needs_response: {
      title: "No requests need a response",
      body: "Request bookings will appear here as one Room-and-Place group.",
    },
    awaiting_payment: {
      title: "No guests are awaiting payment",
      body: "Approved requests and instant bookings stay here until payment resolves.",
    },
    confirmed: {
      title: "No confirmed stays yet",
      body: "Paid reservation groups appear here with every Room and Place line.",
    },
    cancelled: {
      title: "No cancelled reservations",
      body: "Declined, expired, partially cancelled and cancelled groups remain auditable here.",
    },
    reconciliation: {
      title: "Nothing needs reconciliation",
      body: "Ambiguous payment or refund states appear here instead of being guessed.",
    },
  };

function matchesView(
  group: StayStaffReservationSummary,
  view: StayReservationView,
): boolean {
  switch (view) {
    case "needs_response":
      return group.state === "request_pending";
    case "awaiting_payment":
      return [
        "instant_payment_pending",
        "approved_payment_required",
        "finalizing",
      ].includes(group.state);
    case "confirmed":
      return group.state === "confirmed";
    case "cancelled":
      return [
        "declined",
        "request_expired",
        "partially_cancelled",
        "cancelled",
      ].includes(group.state);
    case "reconciliation":
      return (
        group.state === "reconciliation_required" ||
        group.paymentState === "ambiguous" ||
        group.refundState === "manual_reconciliation" ||
        group.refundState === "failed"
      );
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}

function stateLabel(group: StayStaffReservationSummary): string {
  if (group.state === "request_pending") return "Response needed";
  if (group.state === "approved_payment_required")
    return "Approved · payment due";
  if (group.state === "instant_payment_pending") return "Instant · payment due";
  if (group.state === "finalizing") return "Confirming payment";
  if (group.state === "partially_cancelled") return "Partially cancelled";
  if (group.state === "reconciliation_required") return "Needs attention";
  return group.state.replaceAll("_", " ");
}

function deadline(group: StayStaffReservationSummary): string | null {
  const value =
    group.state === "request_pending"
      ? group.requestDeadline
      : group.paymentDeadline;
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function ReservationCard({
  group,
  onPress,
}: {
  group: StayStaffReservationSummary;
  onPress: () => void;
}): React.ReactElement {
  const due = deadline(group);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${group.publicReference}, ${group.guest.name}, ${stateLabel(group)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.cardPressable, pressed && styles.pressed]}
      testID={`stay-reservation-card-${group.groupId}`}
    >
      <GlassCard variant="elevated" style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={styles.cardTitle}>{group.guest.name}</Text>
            <Text style={styles.meta}>{group.publicReference}</Text>
          </View>
          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{stateLabel(group)}</Text>
          </View>
          <ChevronRight size={18} color={textTokens.tertiary} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.helper}>
            {group.lineCount} line{group.lineCount === 1 ? "" : "s"} ·{" "}
            {group.roomCount} Room · {group.placeCount} Place
          </Text>
          <Text style={styles.money}>
            {formatStayMoney(group.totalMinor, group.currencyCode)}
          </Text>
        </View>
        {due !== null ? (
          <Text style={styles.deadline}>Deadline · {due}</Text>
        ) : null}
        {group.refundState !== null ? (
          <Text style={styles.meta}>
            Latest refund: {group.refundState.replaceAll("_", " ")}
          </Text>
        ) : null}
      </GlassCard>
    </Pressable>
  );
}

export interface StayReservationsModuleProps {
  venueId: string;
}

export function StayReservationsModule({
  venueId,
}: StayReservationsModuleProps): React.ReactElement {
  // #1484 — desktop gate ONLY via the canonical hook (I-DESKTOP-GATE-VIA-HOOK).
  const { isWideDesktop } = useResponsiveLayout();
  const list = useStayStaffReservationList(venueId);
  const [view, setView] = useState<StayReservationView>("needs_response");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const groups = useMemo(() => list.data?.groups ?? [], [list.data?.groups]);
  const visible = useMemo(
    () => groups.filter((group) => matchesView(group, view)),
    [groups, view],
  );
  const counts = useMemo(() => {
    const result = new Map<StayReservationView, number>();
    for (const candidate of VIEWS) {
      result.set(
        candidate.id,
        groups.filter((group) => matchesView(group, candidate.id)).length,
      );
    }
    return result;
  }, [groups]);

  return (
    <View style={styles.root} testID="stay-reservations-module">
      <ScrollView
        contentContainerStyle={
          isWideDesktop ? styles.contentDesktop : styles.content
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.flexOne}>
            <Text style={styles.title}>Stay reservations</Text>
            <Text style={styles.helper}>
              Respond, track payment and manage Room-and-Place groups.
            </Text>
          </View>
          {list.isFetching && !list.isLoading ? (
            <ActivityIndicator color={accent.warm} />
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          accessibilityRole="tablist"
        >
          {VIEWS.map((candidate) => {
            const selected = candidate.id === view;
            const count = counts.get(candidate.id) ?? 0;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${candidate.label}, ${count} reservations`}
                onPress={() => setView(candidate.id)}
                style={[styles.tab, selected && styles.tabSelected]}
                testID={`stay-reservations-tab-${candidate.id}`}
              >
                <Text
                  style={[styles.tabText, selected && styles.tabTextSelected]}
                >
                  {candidate.label} · {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {list.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.helper}>Loading Stay reservations…</Text>
          </View>
        ) : list.isError && list.data === undefined ? (
          <GlassCard variant="elevated" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Reservations could not load</Text>
            <Text style={styles.helper}>
              Check your connection or brand permission. Nothing has been
              changed.
            </Text>
            <Button
              label="Try again"
              onPress={() => void list.refetch()}
              variant="secondary"
              testID="stay-reservations-retry"
            />
          </GlassCard>
        ) : visible.length === 0 ? (
          <GlassCard variant="elevated" style={styles.emptyCard}>
            <CalendarDays size={28} color={textTokens.primary} />
            <Text style={styles.emptyTitle}>{EMPTY_COPY[view].title}</Text>
            <Text style={styles.helper}>{EMPTY_COPY[view].body}</Text>
          </GlassCard>
        ) : (
          <View style={styles.list}>
            {visible.map((group) => (
              <ReservationCard
                key={group.groupId}
                group={group}
                onPress={() => setSelectedGroupId(group.groupId)}
              />
            ))}
          </View>
        )}

        {list.isError && list.data !== undefined ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.warning}>
              You’re seeing saved reservations. Reconnect and refresh before
              acting.
            </Text>
            <Button
              label="Refresh"
              onPress={() => void list.refetch()}
              variant="secondary"
              size="sm"
            />
          </View>
        ) : null}

        {list.data !== undefined && !list.data.permissions.canView ? (
          <Text style={styles.warning}>
            Your role cannot view Stay reservations.
          </Text>
        ) : null}
      </ScrollView>

      <StayReservationManagementDetail
        visible={selectedGroupId !== null}
        venueId={venueId}
        groupId={selectedGroupId}
        onClose={() => setSelectedGroupId(null)}
      />
    </View>
  );
}

/** Geometry shared by both content measures below (see the note on `content`). */
const CONTENT_BASE = {
  width: "100%",
  padding: spacing.md,
  paddingBottom: spacing.xxl * 3,
  gap: spacing.md,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  // #1484 — COMPLETE, MUTUALLY EXCLUSIVE measures; exactly ONE is selected.
  // NEVER layered as `[content, <override setting maxWidth to undefined>]` —
  // an `undefined` override does not clear the base declaration (the base's
  // atomic `r-maxWidth-*` class survives into the DOM), so the cap silently
  // persists. Omitting the KEY is the only form the web resolver honours.
  content: {
    ...CONTENT_BASE,
    // Phone / web-phone readable measure (unchanged; tokenised).
    maxWidth: stayReservationsMaxWidth,
    alignSelf: "center",
  },
  // WIDE DESKTOP: no `maxWidth` key at all — the shared SuiteDesktopShell
  // workspace owns the gutters and the left anchor, so the reservations list
  // fills the workspace instead of leaving a dead gutter beside it.
  contentDesktop: {
    ...CONTENT_BASE,
    alignSelf: "flex-start",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  flexOne: { flex: 1, minWidth: 0 },
  title: { ...typography.h2, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  meta: { ...typography.caption, color: textTokens.tertiary },
  tabs: { flexDirection: "row", gap: spacing.xs, paddingVertical: spacing.xxs },
  tab: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
  },
  tabSelected: { borderColor: accent.warm, backgroundColor: accent.warm },
  tabText: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  tabTextSelected: { color: "#0c0e12", fontWeight: "700" },
  centerState: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  emptyCard: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  list: { gap: spacing.sm },
  cardPressable: { width: "100%" },
  pressed: { opacity: 0.78 },
  card: { gap: spacing.sm },
  cardTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  statePill: {
    maxWidth: 190,
    borderRadius: radius.full,
    backgroundColor: semantic.warningTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statePillText: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  money: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  deadline: {
    ...typography.bodySm,
    color: semantic.warning,
    fontWeight: "600",
  },
  offlineBanner: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
    padding: spacing.md,
    gap: spacing.sm,
  },
  warning: { ...typography.bodySm, color: semantic.warning },
});

export default StayReservationsModule;
