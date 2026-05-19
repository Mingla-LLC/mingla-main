/**
 * /trip/[id] — operator trip dashboard. Tr2 (ORCH-0859).
 *
 * Two tabs: Overview (revenue + traveler count + days-until-departure) +
 * Travelers (per-order rows). Mirrors event dashboard pattern.
 *
 * Per SPEC §4.9 + §4.10 file 13. Tr5+ adds Intake Forms tab, Tr6 adds
 * Discussion tab — Tr2 ships these two tabs only.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
// ORCH-0874 [Trip surfaces visual parity with Events]: hero + action grid +
// header right-slot share/moreH + manage menu + cancel-trip CTA.
import { ActionTile } from "../../../src/components/event/ActionTile";
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — operator-mode RefundPreviewSheet
// replaces the prior Refund stub in the Money tab per DESIGN_ORCH-0875 §3 (operator
// path) + spec §3.5.3.
import { RefundPreviewSheet } from "../../../src/components/trip/RefundPreviewSheet";
import { TripManageMenu } from "../../../src/components/trip/TripManageMenu";
import {
  InstallmentScheduleDisplay,
  type InstallmentScheduleDisplaySchedule,
} from "../../../src/components/trip/InstallmentScheduleDisplay";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
import { Button } from "../../../src/components/ui/Button";
import { useTrip, useSoftDeleteTrip } from "../../../src/hooks/useTrips";
import { useTripOrders } from "../../../src/hooks/useTripOrders";
// ORCH-0880 [Tr5 Traveler Intake Forms] — Travelers tab card extension.
import { useTripIntakeSchemasByEvent } from "../../../src/hooks/useIntakeSchema";
import {
  TravelerIntakeAnswerCard,
  TravelerTierChip,
} from "../../../src/components/trip/TravelerIntakeAnswerCard";
import type { IntakeAnswerValue } from "../../../src/services/intakeSchemaService";
// ORCH-0873 [Tr3 Stage 2 UI] — Money tab data.
import {
  useInstallmentsForBrandTrips,
  useRetryInstallment,
} from "../../../src/hooks/useOrderInstallments";
import type {
  OrderInstallmentForBrand,
  OrderInstallmentStatus,
} from "../../../src/services/orderInstallmentsService";

type TabKey = "overview" | "travelers" | "money";
type MoneyFilter = "all" | "atRisk";

function daysBetween(now: Date, future: string | null): number | null {
  if (future === null) return null;
  try {
    const f = new Date(future);
    const diffMs = f.getTime() - now.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export default function TripDashboardRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [tab, setTab] = useState<TabKey>("overview");

  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const ordersQuery = useTripOrders(typeof eventId === "string" ? eventId : null);
  // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake schemas for the
  // Travelers tab card extension. Empty Map when no schemas exist; the card
  // gracefully renders nothing in that case.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(
    typeof eventId === "string" ? eventId : "",
    { enabled: typeof eventId === "string" },
  );
  // ORCH-0873 [Tr3 Stage 2 UI] — Money tab installment ledger.
  const brandId = tripQuery.data?.brandId ?? null;
  const [moneyFilter, setMoneyFilter] = useState<MoneyFilter>("all");
  const installmentsQuery = useInstallmentsForBrandTrips(brandId, {
    tripEventId: typeof eventId === "string" ? eventId : undefined,
    atRiskOnly: moneyFilter === "atRisk",
  });
  // Toast for retry mutation feedback (Constitution #3 — no silent failures).
  // Map hook's semantic kinds (success/warning/error) onto Toast's
  // ToastKind union (success/warn/error/info).
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });
  const retryMutation = useRetryInstallment({
    onMessage: ({ kind, message }) => {
      const toastKind: "success" | "warn" | "error" | "info" =
        kind === "warning" ? "warn" : kind;
      setToast({ visible: true, kind: toastKind, message });
    },
  });
  // ORCH-0874 [Trip surfaces visual parity with Events]: header right-slot
  // share + moreH state, plus cancel-trip dialog state.
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [manageMenuVisible, setManageMenuVisible] = useState<boolean>(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [cancelSubmitting, setCancelSubmitting] = useState<boolean>(false);
  const softDeleteMutation = useSoftDeleteTrip();
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((orderId: string): void => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const moneyData = useMemo(() => {
    if (installmentsQuery.data === undefined) return null;
    const rowsByOrder = new Map<string, OrderInstallmentForBrand[]>();
    for (const row of installmentsQuery.data) {
      const arr = rowsByOrder.get(row.orderId) ?? [];
      arr.push(row);
      rowsByOrder.set(row.orderId, arr);
    }
    // Sort orders: at-risk first, then by next-due-at ascending.
    const orderIds = [...rowsByOrder.keys()].sort((a, b) => {
      const ra = rowsByOrder.get(a)![0];
      const rb = rowsByOrder.get(b)![0];
      if (ra.orderAtRisk !== rb.orderAtRisk) return ra.orderAtRisk ? -1 : 1;
      const nextA = rowsByOrder
        .get(a)!
        .filter((i) => i.status === "scheduled" || i.status === "failed")
        .map((i) => i.dueAt)
        .sort()[0] ?? "";
      const nextB = rowsByOrder
        .get(b)!
        .filter((i) => i.status === "scheduled" || i.status === "failed")
        .map((i) => i.dueAt)
        .sort()[0] ?? "";
      return nextA.localeCompare(nextB);
    });
    const atRiskOrderCount = new Set(
      installmentsQuery.data
        .filter((r) => r.orderAtRisk)
        .map((r) => r.orderId),
    ).size;
    return { rowsByOrder, orderIds, atRiskOrderCount };
  }, [installmentsQuery.data]);

  // Revenue aggregation (excludes failed/cancelled/refunded orders).
  const revenueByCurrency = useMemo(() => {
    if (ordersQuery.data === undefined) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const o of ordersQuery.data) {
      if (
        o.paymentStatus === "failed" ||
        o.paymentStatus === "cancelled" ||
        o.paymentStatus === "refunded"
      ) {
        continue;
      }
      map.set(o.currency, (map.get(o.currency) ?? 0) + o.totalCents);
    }
    return map;
  }, [ordersQuery.data]);

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <SafeScreen style={styles.stateHost}>
        <ActivityIndicator />
      </SafeScreen>
    );
  }

  if (tripQuery.isError) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.body}>
          {tripQuery.error instanceof Error
            ? tripQuery.error.message
            : "Try again."}
        </Text>
      </SafeScreen>
    );
  }

  const trip = tripQuery.data;
  if (trip === null || trip === undefined) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  const startDate = trip.businessTrip.startAt;
  const daysUntil = daysBetween(new Date(), startDate);
  const travelersCount = (ordersQuery.data ?? []).filter(
    (o) => o.paymentStatus !== "failed" && o.paymentStatus !== "cancelled",
  ).length;
  const primaryCurrency =
    [...revenueByCurrency.entries()][0]?.[0] ??
    trip.pricingTiers[0]?.currency ??
    "USD";
  const totalRevenue = revenueByCurrency.get(primaryCurrency) ?? 0;

  return (
    <SafeScreen style={styles.host}>
      {/* ORCH-0874: header — back + title + share IconChrome + moreH IconChrome.
          Inline "Edit" Pressable removed (Edit moves to action grid). */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
          hitSlop={8}
        >
          <Icon name="chevL" size={20} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {trip.title}
        </Text>
        <View style={styles.headerRightSlot}>
          {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
            <IconChrome
              icon="share"
              size={36}
              onPress={() => setShareModalVisible(true)}
              accessibilityLabel="Share trip"
            />
          ) : null}
          <IconChrome
            icon="moreH"
            size={36}
            onPress={() => setManageMenuVisible(true)}
            accessibilityLabel="Trip options"
          />
        </View>
      </View>

      {/* ORCH-0874: hero — full-width cover + gradient overlay + status pill
          + 24pt title overlay + 13pt date/destination subline. EventCoverMedia
          is content-agnostic; coverHue derived from trip.id when no media. */}
      <View style={styles.hero}>
        <EventCoverMedia
          hue={(function () {
            let h = 0;
            for (let i = 0; i < trip.id.length; i += 1) {
              h = (h * 31 + trip.id.charCodeAt(i)) | 0;
            }
            return Math.abs(h) % 360;
          })()}
          mediaUrl={trip.coverMediaUrl}
          mediaType={trip.coverMediaType}
          radius={24}
          label=""
          height={200}
        />
        <View style={styles.heroOverlay} pointerEvents="none" />
        <View style={styles.heroContent} pointerEvents="none">
          <View
            style={[
              styles.statusPill,
              trip.status === "scheduled" || trip.status === "live"
                ? styles.statusPillLive
                : styles.statusPillDraft,
            ]}
          >
            <Text style={styles.statusPillText}>
              {trip.status === "draft" ? "Draft" : "Published"}
            </Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {trip.title}
          </Text>
          <Text style={styles.heroSubline} numberOfLines={1}>
            {(function (): string {
              const start = trip.businessTrip.startAt;
              const end = trip.businessTrip.endAt;
              const dest = trip.businessTrip.destinationLocationText;
              let datesLabel = "";
              if (start !== null) {
                try {
                  const fmt = new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                  datesLabel = `${fmt.format(new Date(start))}${
                    end !== null ? `–${fmt.format(new Date(end))}` : ""
                  }`;
                } catch {
                  datesLabel = "";
                }
              }
              if (datesLabel.length > 0 && dest !== null && dest.length > 0) {
                return `${datesLabel} · ${dest}`;
              }
              return datesLabel.length > 0 ? datesLabel : dest ?? "Date TBD";
            })()}
          </Text>
        </View>
      </View>

      {/* ORCH-0874: action grid — View public page (ORCH-0867 fold), Brand
          page, Marketing blasts, Edit trip (primary). Replaces the inline
          Edit pill in the prior header. */}
      <View style={styles.actionGrid}>
        {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
          <ActionTile
            icon="eye"
            label="View public page"
            onPress={() =>
              router.push(`/t/${trip.brandSlug}/${trip.slug}` as never)
            }
          />
        ) : null}
        {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
          <ActionTile
            icon="user"
            label="Brand page"
            onPress={() => router.push(`/b/${trip.brandSlug}` as never)}
          />
        ) : null}
        <ActionTile
          icon="send"
          label="Marketing blasts"
          onPress={() => router.push(`/event/${trip.id}/blasts` as never)}
        />
        <ActionTile
          icon="edit"
          label={trip.status === "draft" ? "Continue editing" : "Edit trip"}
          primary
          onPress={() => router.push(`/trip/${trip.id}/edit` as never)}
        />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setTab("overview")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "overview" }}
          accessibilityLabel="Overview tab"
          style={[styles.tab, tab === "overview" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "overview" && styles.tabTextActive]}>
            Overview
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("travelers")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "travelers" }}
          accessibilityLabel={`Travelers tab, ${travelersCount} ${travelersCount === 1 ? "traveler" : "travelers"}`}
          style={[styles.tab, tab === "travelers" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "travelers" && styles.tabTextActive]}>
            Travelers ({travelersCount})
          </Text>
        </Pressable>
        {/* ORCH-0873 [Tr3 Stage 2 UI] — Money tab */}
        <Pressable
          onPress={() => setTab("money")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "money" }}
          accessibilityLabel={
            (moneyData?.atRiskOrderCount ?? 0) > 0
              ? `Money tab, ${moneyData?.atRiskOrderCount} at risk`
              : "Money tab"
          }
          style={[styles.tab, tab === "money" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "money" && styles.tabTextActive]}>
            {(moneyData?.atRiskOrderCount ?? 0) > 0 ? (
              <Text>
                Money{" "}
                <Text style={styles.tabBadgeAtRisk}>
                  ({moneyData?.atRiskOrderCount})
                </Text>
              </Text>
            ) : (
              "Money"
            )}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        {tab === "overview" ? (
          <>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Revenue</Text>
                <Text style={styles.kpiValue}>
                  {formatCurrency(totalRevenue, primaryCurrency)}
                </Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Travelers</Text>
                <Text style={styles.kpiValue}>
                  {travelersCount}
                  {trip.businessTrip.capacity !== null ? (
                    <Text style={styles.kpiSubvalue}>
                      {" / " + trip.businessTrip.capacity}
                    </Text>
                  ) : null}
                </Text>
              </View>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Departure</Text>
              <Text style={styles.kpiValue}>
                {daysUntil === null
                  ? "Date TBD"
                  : daysUntil > 0
                    ? `In ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
                    : daysUntil === 0
                      ? "Today"
                      : `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} ago`}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Destination</Text>
              <Text style={styles.kpiValue}>
                {trip.businessTrip.destinationLocationText ?? "Not set"}
              </Text>
            </View>
          </>
        ) : tab === "travelers" ? (
          <>
            {ordersQuery.isLoading ? (
              <ActivityIndicator />
            ) : (ordersQuery.data ?? []).length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="users" size={32} color={textTokens.tertiary} />
                <Text style={styles.emptyText}>
                  No travelers yet. Share the trip link to start taking bookings.
                </Text>
              </View>
            ) : (
              (ordersQuery.data ?? []).map((o) => {
                // ORCH-0880 [Tr5 Traveler Intake Forms] — resolve schema +
                // answers per traveler. Each order's intake_form_data is an
                // array (one entry per tier the buyer purchased; first entry
                // wins for the per-traveler card since orders today =
                // 1 traveler 1 tier in the typical case). Tier chip hides
                // when trip has only 1 ticket tier.
                const intakeArray = Array.isArray(o.intakeFormData)
                  ? (o.intakeFormData as Array<{
                      ticket_type_id?: string;
                      schema_version_id?: string;
                      answers?: Record<string, IntakeAnswerValue>;
                    }>)
                  : [];
                const intakeEntry = intakeArray[0] ?? null;
                const ticketTypeId = intakeEntry?.ticket_type_id ?? null;
                const intakeSchema =
                  ticketTypeId !== null && intakeSchemasQuery.data !== undefined
                    ? intakeSchemasQuery.data.get(ticketTypeId) ?? null
                    : null;
                const tier =
                  ticketTypeId !== null
                    ? trip.pricingTiers.find(
                        (t) => t.ticketTypeId === ticketTypeId,
                      ) ?? null
                    : null;
                const tierChipHidden = trip.pricingTiers.length <= 1;
                return (
                  <View key={o.id} style={styles.travelerRow}>
                    <View style={styles.travelerTextCol}>
                      <Text style={styles.travelerName}>
                        {o.buyerName ?? o.buyerEmail ?? "Anonymous"}
                      </Text>
                      {o.buyerEmail !== null ? (
                        <Text style={styles.travelerEmail}>{o.buyerEmail}</Text>
                      ) : null}
                      {/* ORCH-0880 — collapsible intake-form-answers section. */}
                      <TravelerIntakeAnswerCard
                        schema={intakeSchema}
                        answers={intakeEntry?.answers ?? null}
                      />
                    </View>
                    <View style={styles.travelerMeta}>
                      {tier !== null && !tierChipHidden ? (
                        <TravelerTierChip
                          tierName={tier.tierName}
                          hidden={tierChipHidden}
                        />
                      ) : null}
                      <Text style={styles.travelerStatus}>{o.paymentStatus}</Text>
                      <Text style={styles.travelerAmount}>
                        {formatCurrency(o.totalCents, o.currency)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </>
        ) : (
          // ORCH-0873 [Tr3 Stage 2 UI] — Money tab
          // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer +
          // Planner Surfaces] — derive planner-variant schedule template
          // from the first pricing tier so MoneyTabBody can render the
          // schedule header above the per-buyer ledger.
          (() => {
            const firstTier = trip.pricingTiers[0];
            const plannerScheduleHeader =
              firstTier === undefined
                ? null
                : projectInstallmentSchedule(firstTier, new Date());
            return (
              <MoneyTabBody
                installmentsQuery={installmentsQuery}
                moneyData={moneyData}
                moneyFilter={moneyFilter}
                setMoneyFilter={setMoneyFilter}
                expandedOrders={expandedOrders}
                toggleExpanded={toggleExpanded}
                retryMutation={retryMutation}
                onEditTripPricing={() =>
                  router.push(`/trip/${eventId}/edit` as never)
                }
                plannerScheduleHeader={plannerScheduleHeader}
              />
            );
          })()
        )}

        {/* ORCH-0874: Cancel trip CTA below tab content. Only shown for trips
            that are still active (not already ended or cancelled). Mirrors
            event/[id]/index.tsx:770-784 ghost-button bottom pattern. */}
        {trip.status !== "ended" && trip.status !== "cancelled" ? (
          <View style={styles.cancelTripWrap}>
            <Button
              label="Cancel trip"
              variant="ghost"
              size="md"
              onPress={() => setCancelDialogVisible(true)}
              fullWidth
              testID="trip-dashboard-cancel-cta"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* ORCH-0874: TripManageMenu (right-slot moreH opens this) */}
      <TripManageMenu
        visible={manageMenuVisible}
        onClose={() => setManageMenuVisible(false)}
        onShare={() => setShareModalVisible(true)}
        onEdit={() => router.push(`/trip/${trip.id}/edit` as never)}
        onViewPublic={() => {
          if (trip.brandSlug !== null && trip.brandSlug.length > 0) {
            router.push(`/t/${trip.brandSlug}/${trip.slug}` as never);
          }
        }}
        onCancelTrip={() => setCancelDialogVisible(true)}
        canCancelTrip={
          trip.status !== "draft" &&
          trip.status !== "ended" &&
          trip.status !== "cancelled"
        }
      />

      {/* ORCH-0874: ShareModal — opened from header share IconChrome or
          TripManageMenu share row */}
      {trip.brandSlug !== null && trip.brandSlug.length > 0 ? (
        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={`https://business.usemingla.com/t/${trip.brandSlug}/${trip.slug}`}
          title={`${trip.title} on Mingla`}
          description={
            trip.description !== null && trip.description.length > 0
              ? trip.description.slice(0, 200)
              : trip.title
          }
        />
      ) : null}

      {/* ORCH-0874: Cancel-trip ConfirmDialog (typeToConfirm) */}
      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => {
          if (cancelSubmitting) return;
          setCancelDialogVisible(false);
        }}
        onConfirm={async () => {
          setCancelSubmitting(true);
          try {
            await softDeleteMutation.mutateAsync({
              eventId: trip.id,
              brandId: trip.brandId,
            });
            setCancelDialogVisible(false);
            setToast({
              visible: true,
              kind: "info",
              message: "Trip cancelled.",
            });
            // Route back so the operator sees the updated list.
            setTimeout(() => router.back(), 300);
          } catch (e) {
            setToast({
              visible: true,
              kind: "error",
              message:
                e instanceof Error
                  ? e.message
                  : "Couldn't cancel trip. Try again.",
            });
          } finally {
            setCancelSubmitting(false);
          }
        }}
        title="Cancel this trip?"
        description="Buyers will be notified and refunds processed in a future release. This can't be undone."
        variant="typeToConfirm"
        confirmText={trip.title.length > 0 ? trip.title : trip.slug}
        confirmLabel="Cancel trip"
        cancelLabel="Keep trip live"
        confirmLoading={cancelSubmitting}
        confirmDisabled={cancelSubmitting}
        closeDisabled={cancelSubmitting}
        destructive
        testID="trip-dashboard-cancel-dialog"
      />

      <Toast
        visible={toast.visible}
        kind={toast.kind}
        message={toast.message}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  title: {
    fontSize: typography.h3.fontSize,
    color: textTokens.primary,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  editBtn: {
    minWidth: 48,
    height: 36,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  editBtnText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  // ORCH-0874 [Trip surfaces visual parity with Events]
  headerRightSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hero: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: 24,
    overflow: "hidden",
    position: "relative",
  },
  heroOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12, 14, 18, 0.35)",
  },
  heroContent: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    gap: 4,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.inverse,
    textShadowColor: "rgba(0, 0, 0, 0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginTop: spacing.xs,
  },
  heroSubline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  cancelTripWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  pillRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.sm,
  },
  statusPillLive: {
    backgroundColor: "rgba(34, 197, 94, 0.16)",
  },
  statusPillDraft: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  statusPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabActive: {
    borderBottomColor: accent.warm,
  },
  tabText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  tabTextActive: {
    color: textTokens.primary,
  },
  kpiRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  kpiLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  kpiValue: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  kpiSubvalue: {
    fontSize: typography.body.fontSize,
    fontWeight: "400",
    color: textTokens.tertiary,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  travelerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  travelerTextCol: {
    flex: 1,
  },
  travelerName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  travelerEmail: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  travelerMeta: {
    alignItems: "flex-end",
  },
  travelerStatus: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textTransform: "capitalize",
  },
  travelerAmount: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
  // ORCH-0873 [Tr3 Stage 2 UI] — Money tab styles
  tabBadgeAtRisk: {
    color: semantic.error,
  },
  // ORCH-0882 — planner-variant schedule template header wrapper. Sits
  // above the filter chip row when bookings exist, above the empty
  // state when none.
  plannerScheduleHeaderWrap: {
    width: "100%",
    marginBottom: spacing.md,
  },
  moneyFilterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  moneyFilterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  moneyFilterChipActive: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  moneyFilterChipAtRisk: {
    borderColor: semantic.error,
  },
  moneyFilterChipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  moneyFilterChipTextActive: {
    color: textTokens.inverse,
  },
  moneyFilterChipTextAtRisk: {
    color: semantic.error,
  },
  moneyBookingRow: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  moneyBookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  moneyBookingName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  moneyBookingMeta: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  moneyAtRiskPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  moneyAtRiskPillText: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    fontWeight: "600",
  },
  moneyInstallmentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  moneyInstallmentLabel: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  moneyInstallmentAmount: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
    marginRight: spacing.sm,
  },
  moneyStatusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    minWidth: 80,
    alignItems: "center",
  },
  moneyStatusPillScheduled: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  moneyStatusPillCollected: {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
  },
  moneyStatusPillFailed: {
    backgroundColor: "rgba(239, 68, 68, 0.18)",
  },
  moneyStatusPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  moneyStatusPillTextCollected: {
    color: semantic.success,
  },
  moneyStatusPillTextFailed: {
    color: semantic.error,
  },
  moneyRetryBtn: {
    marginTop: spacing.xs,
    minHeight: 44,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  moneyRetryBtnDisabled: {
    opacity: 0.5,
  },
  moneyRetryBtnText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.inverse,
  },
  moneyFailureReason: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginTop: 2,
  },
  moneyDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: spacing.sm,
  },
  moneyRefundBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
  },
  moneyRefundBtnText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
});

// ============================================================================
// ORCH-0873 [Tr3 Stage 2 UI] — MoneyTabBody subcomponent
// ============================================================================

interface MoneyTabBodyProps {
  installmentsQuery: ReturnType<typeof useInstallmentsForBrandTrips>;
  moneyData: {
    rowsByOrder: Map<string, OrderInstallmentForBrand[]>;
    orderIds: string[];
    atRiskOrderCount: number;
  } | null;
  moneyFilter: MoneyFilter;
  setMoneyFilter: (next: MoneyFilter) => void;
  expandedOrders: Set<string>;
  toggleExpanded: (orderId: string) => void;
  retryMutation: ReturnType<typeof useRetryInstallment>;
  onEditTripPricing: () => void;
  /**
   * ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner
   * Surfaces] — projected schedule for the trip's first pricing tier, or
   * null if the trip has no payment plan configured. Drives the
   * planner-variant schedule template header rendered above the filter
   * chip row and the empty-state messaging.
   */
  plannerScheduleHeader: InstallmentScheduleDisplaySchedule | null;
}

function statusPillStyle(status: OrderInstallmentStatus): {
  pill: object;
  text: object;
} {
  switch (status) {
    case "collected":
      return {
        pill: styles.moneyStatusPillCollected,
        text: styles.moneyStatusPillTextCollected,
      };
    case "failed":
      return {
        pill: styles.moneyStatusPillFailed,
        text: styles.moneyStatusPillTextFailed,
      };
    case "scheduled":
    case "refunded":
    case "cancelled":
    default:
      return { pill: styles.moneyStatusPillScheduled, text: {} };
  }
}

function statusLabel(status: OrderInstallmentStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "collected":
      return "Collected";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function friendlyFailureCopy(raw: string | null): string {
  if (raw === null) return "Payment failed.";
  const lower = raw.toLowerCase();
  if (lower.includes("card_declined")) return "Card declined.";
  if (lower.includes("insufficient_funds")) return "Insufficient funds.";
  if (lower.includes("expired_card")) return "Card expired.";
  if (lower.includes("authentication_required")) return "Requires 3D Secure.";
  return "Payment failed. Buyer may need to update their card.";
}

function formatMoneyDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const MoneyTabBody: React.FC<MoneyTabBodyProps> = ({
  installmentsQuery,
  moneyData,
  moneyFilter,
  setMoneyFilter,
  expandedOrders,
  toggleExpanded,
  retryMutation,
  onEditTripPricing,
  plannerScheduleHeader,
}) => {
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — orderId of the row whose
  // cancel sheet is currently open. NULL = no sheet visible. Mutating this
  // state opens/closes the operator RefundPreviewSheet.
  const [cancelSheetOrderId, setCancelSheetOrderId] = useState<string | null>(
    null,
  );
  if (installmentsQuery.isLoading || moneyData === null) {
    return (
      <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (installmentsQuery.isError) {
    return (
      <View style={styles.emptyState}>
        <Icon name="bell" size={32} color={semantic.error} />
        <Text style={styles.emptyText}>Couldn&rsquo;t load installments.</Text>
        <Pressable
          onPress={() => installmentsQuery.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading installments"
          style={styles.moneyRetryBtn}
        >
          <Text style={styles.moneyRetryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (moneyData.orderIds.length === 0) {
    return (
      <View>
        {/* ORCH-0882 — planner-variant schedule template above the empty
            state so the planner can see what plan is currently
            configured even before any buyer books. Renders null when
            the trip has no plan. */}
        {plannerScheduleHeader !== null ? (
          <View style={styles.plannerScheduleHeaderWrap}>
            <InstallmentScheduleDisplay
              schedule={plannerScheduleHeader}
              variant="planner"
              isProjection={true}
            />
          </View>
        ) : null}
        <View style={styles.emptyState}>
          <Icon name="pound" size={32} color={textTokens.tertiary} />
          <Text style={styles.emptyText}>No bookings on payment plans yet.</Text>
          <Text style={styles.emptyText}>
            When buyers book this trip with a payment plan, their installment
            schedule shows up here.
          </Text>
          <Pressable
            onPress={onEditTripPricing}
            accessibilityRole="button"
            accessibilityLabel="Edit trip pricing"
            style={styles.moneyRetryBtn}
          >
            <Text style={styles.moneyRetryBtnText}>Edit trip pricing</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <>
      {/* ORCH-0882 — planner-variant schedule template header above the
          filter chip row. Always visible when the trip has a plan; null
          when no plan configured. */}
      {plannerScheduleHeader !== null ? (
        <View style={styles.plannerScheduleHeaderWrap}>
          <InstallmentScheduleDisplay
            schedule={plannerScheduleHeader}
            variant="planner"
            isProjection={true}
          />
        </View>
      ) : null}
      <View style={styles.moneyFilterRow}>
        <Pressable
          onPress={() => setMoneyFilter("all")}
          accessibilityRole="button"
          accessibilityState={{ selected: moneyFilter === "all" }}
          accessibilityLabel={`All bookings, ${moneyData.orderIds.length}`}
          style={[
            styles.moneyFilterChip,
            moneyFilter === "all" && styles.moneyFilterChipActive,
          ]}
        >
          <Text
            style={[
              styles.moneyFilterChipText,
              moneyFilter === "all" && styles.moneyFilterChipTextActive,
            ]}
          >
            All bookings · {moneyData.orderIds.length}
          </Text>
        </Pressable>
        {moneyData.atRiskOrderCount > 0 ? (
          <Pressable
            onPress={() => setMoneyFilter("atRisk")}
            accessibilityRole="button"
            accessibilityState={{ selected: moneyFilter === "atRisk" }}
            accessibilityLabel={`Show ${moneyData.atRiskOrderCount} at-risk bookings`}
            style={[
              styles.moneyFilterChip,
              styles.moneyFilterChipAtRisk,
              moneyFilter === "atRisk" && styles.moneyFilterChipActive,
            ]}
          >
            <Text
              style={[
                styles.moneyFilterChipText,
                styles.moneyFilterChipTextAtRisk,
                moneyFilter === "atRisk" && styles.moneyFilterChipTextActive,
              ]}
            >
              At risk · {moneyData.atRiskOrderCount}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {moneyData.orderIds.map((orderId) => {
        const rows = moneyData.rowsByOrder.get(orderId) ?? [];
        if (rows.length === 0) return null;
        const head = rows[0];
        const paidCount = rows.filter((r) => r.status === "collected").length;
        const collectedCents = rows
          .filter((r) => r.status === "collected")
          .reduce((s, r) => s + r.amountCents, 0);
        const nextDue = rows
          .filter((r) => r.status === "scheduled" || r.status === "failed")
          .map((r) => r.dueAt)
          .sort()[0];
        const expanded = expandedOrders.has(orderId);
        return (
          <View key={orderId} style={styles.moneyBookingRow}>
            <Pressable
              onPress={() => toggleExpanded(orderId)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${head.buyerName ?? "Buyer"}, ${paidCount}/${rows.length} installments paid${head.orderAtRisk ? ", at risk" : ""}, next due ${nextDue !== undefined ? formatMoneyDate(nextDue) : "none"}`}
              accessibilityHint="Tap to see installment ledger"
            >
              <View style={styles.moneyBookingHeader}>
                <Text style={styles.moneyBookingName}>
                  {head.buyerName ?? head.buyerEmail ?? "Anonymous"}
                </Text>
                <Text style={styles.moneyInstallmentAmount}>
                  {paidCount} / {rows.length} paid ·{" "}
                  {formatCurrency(collectedCents, head.currency)}
                </Text>
              </View>
              <Text style={styles.moneyBookingMeta}>
                {nextDue !== undefined
                  ? `Next due ${formatMoneyDate(nextDue)}`
                  : "Fully paid"}
              </Text>
              {head.orderAtRisk ? (
                <View style={styles.moneyAtRiskPill}>
                  <Text style={styles.moneyAtRiskPillText}>⚠ At risk</Text>
                </View>
              ) : null}
            </Pressable>
            {expanded ? (
              <>
                <View style={styles.moneyDivider} />
                {rows.map((inst) => {
                  const pillStyle = statusPillStyle(inst.status);
                  return (
                    <View
                      key={inst.id}
                      style={{ marginBottom: spacing.xs }}
                      accessibilityRole="text"
                      accessibilityLabel={`Installment ${inst.ordinal}, ${formatCurrency(inst.amountCents, inst.currency)}, ${statusLabel(inst.status)}, due ${formatMoneyDate(inst.dueAt)}`}
                    >
                      <View style={styles.moneyInstallmentRow}>
                        <Text style={styles.moneyInstallmentLabel}>
                          Installment {inst.ordinal} ·{" "}
                          {formatMoneyDate(inst.dueAt)}
                        </Text>
                        <Text style={styles.moneyInstallmentAmount}>
                          {formatCurrency(inst.amountCents, inst.currency)}
                        </Text>
                        <View
                          style={[styles.moneyStatusPill, pillStyle.pill]}
                        >
                          <Text
                            style={[
                              styles.moneyStatusPillText,
                              pillStyle.text,
                            ]}
                          >
                            {statusLabel(inst.status)}
                          </Text>
                        </View>
                      </View>
                      {inst.status === "failed" ? (
                        <>
                          <Text style={styles.moneyFailureReason}>
                            {friendlyFailureCopy(inst.failureReason)}
                          </Text>
                          <Pressable
                            onPress={() => retryMutation.mutate(inst.id)}
                            disabled={retryMutation.isPending}
                            accessibilityRole="button"
                            accessibilityLabel={`Retry installment ${inst.ordinal} for ${head.buyerName ?? "buyer"}`}
                            accessibilityHint="Queues a charge attempt on the next cron run"
                            accessibilityState={{
                              disabled: retryMutation.isPending,
                            }}
                            style={[
                              styles.moneyRetryBtn,
                              retryMutation.isPending &&
                                styles.moneyRetryBtnDisabled,
                            ]}
                          >
                            <Text style={styles.moneyRetryBtnText}>
                              {retryMutation.isPending
                                ? "Retrying…"
                                : "Retry now"}
                            </Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  );
                })}
                <View style={styles.moneyDivider} />
                {/* ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — real
                    "Cancel & refund" CTA replaces the prior coming-in-Tr4 stub.
                    Opens operator RefundPreviewSheet for this booking. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel and refund ${head.buyerName ?? "buyer"}'s booking`}
                  accessibilityHint="Opens cancellation preview with refund amount + reason field"
                  style={styles.moneyRefundBtn}
                  onPress={() => setCancelSheetOrderId(orderId)}
                >
                  <Text style={styles.moneyRefundBtnText}>
                    Cancel &amp; refund
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      })}

      {/* ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — operator-mode
          RefundPreviewSheet. Mounts once for the whole tab; orderId state
          drives visible+content. onCancelled invalidates the installments
          query so the row reflects status=cancelled after success. */}
      <RefundPreviewSheet
        visible={cancelSheetOrderId !== null}
        orderId={cancelSheetOrderId}
        onClose={() => setCancelSheetOrderId(null)}
        onCancelled={() => {
          // Sheet auto-shows success state; close happens on user "Done" tap.
          // React Query invalidation already wired inside the mutation hook.
          void installmentsQuery.refetch();
        }}
      />
    </>
  );
};
