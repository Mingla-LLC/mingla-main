/**
 * /trip/[id] — operator trip dashboard. Tr2 (ORCH-0859).
 *
 * ORCH-0913 replaces the legacy Overview / Travelers / Money tab strip with
 * event-dashboard parity: action tiles, KPI strip, pricing tiers, recent
 * activity, then the cancel CTA. Travelers and Money now live on dedicated
 * routes.
 *
 * [ORCH-0913 deliberate divergence from event] Edit trip remains a primary
 * action tile because trip operators edit drafts more frequently than event
 * operators. Do not remove the primary styling during parity cleanup.
 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { TopBar } from "../../../src/components/ui/TopBar";
import { Toast } from "../../../src/components/ui/Toast";
// ORCH-0874 [Trip surfaces visual parity with Events]: hero + action grid +
// header right-slot share/moreH + manage menu + cancel-trip CTA.
import { ActionTile } from "../../../src/components/event/ActionTile";
import { EventDetailKpiCard } from "../../../src/components/event/EventDetailKpiCard";
import {
  EventDetailActivityRow,
  activityRowKey,
  type ActivityEvent,
} from "../../../src/components/event/EventDetailActivityRow";
import { EventDetailTicketTypeRow } from "../../../src/components/event/EventDetailTicketTypeRow";
import {
  buildOfferingDashboardTiles,
  withListingInsights,
} from "../../../src/components/offering/offeringDashboardTiles";
import { summarizeEventMoney } from "../../../src/utils/moneySummary";
import { currencyCodeOrNull } from "../../../src/utils/currency";
import { useEventOrders } from "../../../src/hooks/useEventOrders";
import { TripManageMenu } from "../../../src/components/trip/TripManageMenu";
import {
  TripDetailHeroStatusPill,
  deriveTripLifecycleStatus,
} from "../../../src/components/trip/TripDetailHeroStatusPill";
import { TripDetailKpiCard } from "../../../src/components/trip/TripDetailKpiCard";
import { Button } from "../../../src/components/ui/Button";
import {
  tripKeys,
  useTrip,
  useSoftDeleteTrip,
} from "../../../src/hooks/useTrips";
import { useTripOrders } from "../../../src/hooks/useTripOrders";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { isScannerOnlyRank } from "../../../src/utils/navTabGate";
// ORCH-0873 [Tr3 Stage 2 UI] — Money tab data.
import { useInstallmentsForBrandTrips } from "../../../src/hooks/useOrderInstallments";
import type { OrderInstallmentForBrand } from "../../../src/services/orderInstallmentsService";
import {
  readTripSoldCountsByTier,
  type TripPricingTier,
} from "../../../src/services/tripsService";
import type { EventCoverMediaType, TicketStub } from "../../../src/store/draftEventStore";
import {
  formatTripHeroSubline,
  formatTripSpotsLabel,
  resolveTripTierSoldCount,
  tripDashboardBundleProofTestID,
} from "../../../src/utils/tripDashboardDisplay";

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

function tripTierToTicketStub(tier: TripPricingTier, index: number): TicketStub {
  return {
    id: tier.ticketTypeId,
    name: tier.tierName,
    priceGbp: tier.priceCents / 100,
    currency: tier.currency,
    capacity: tier.quantityTotal,
    isFree: tier.priceCents === 0,
    isUnlimited: tier.isUnlimited,
    visibility: "public",
    displayOrder: index,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    // ORCH-0948: trip waitlist deferred to a future ORCH — see SPEC §2 non-goal.
    waitlistEnabled: false,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    allowTransfers: true,
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    availableAt: "both",
  };
}

function getOrderTierId(order: { intakeFormData: unknown | null }): string | null {
  if (!Array.isArray(order.intakeFormData)) return null;
  const entry = order.intakeFormData[0] as
    | { ticket_type_id?: unknown }
    | undefined;
  return typeof entry?.ticket_type_id === "string" ? entry.ticket_type_id : null;
}

function buyerLabel(input: {
  buyerName: string | null;
  buyerEmail: string | null;
}): string {
  return input.buyerName ?? input.buyerEmail ?? "Anonymous";
}

function normalizeCoverMediaType(value: string | null): EventCoverMediaType | null {
  if (value === "image" || value === "video" || value === "gif") return value;
  return null;
}

export default function TripDashboardRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const ordersQuery = useTripOrders(typeof eventId === "string" ? eventId : null);
  // Pass 2 — OrderRecord-shaped orders (read by event_id) for the revenue/
  // payout card. Trips are events-rows, so the shared orders read + money
  // summary apply identically (payout needs the Stripe app-fee columns this
  // service returns, which useTripOrders does not surface).
  const recordOrdersQuery = useEventOrders(
    typeof eventId === "string" ? eventId : null,
  );
  const brandId = tripQuery.data?.brandId ?? null;
  useSuccessfulBusinessRecentOpen({
    brandId, entityType: "trip", entityId: typeof eventId === "string" ? eventId : null,
    ready: tripQuery.data != null && !tripQuery.isLoading && !tripQuery.isError,
    title: tripQuery.data?.title, coverUrl: tripQuery.data?.coverMediaUrl,
    coverPosterUrl: tripQuery.data?.coverMediaPosterUrl,
    coverType: normalizeCoverMediaType(tripQuery.data?.coverMediaType ?? null),
    status: tripQuery.data?.status,
  });
  const currentBrandRole = useCurrentBrandRole(brandId);
  const canShowListingInsights =
    !currentBrandRole.isLoading &&
    !currentBrandRole.isError &&
    currentBrandRole.role !== null &&
    !isScannerOnlyRank(currentBrandRole.rank);
  const installmentsQuery = useInstallmentsForBrandTrips(brandId, {
    tripEventId: typeof eventId === "string" ? eventId : undefined,
  });
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });
  // ORCH-0874 [Trip surfaces visual parity with Events]: header right-slot
  // share + moreH state, plus cancel-trip dialog state.
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [manageMenuVisible, setManageMenuVisible] = useState<boolean>(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [cancelSubmitting, setCancelSubmitting] = useState<boolean>(false);
  const softDeleteMutation = useSoftDeleteTrip();

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
    // #962 N2 — key type admits null so a null primaryCurrency (pre-bank brand,
    // no established currency) is a valid `.get` key that resolves to 0.
    if (ordersQuery.data === undefined) return new Map<string | null, number>();
    const map = new Map<string | null, number>();
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

  const soldCountsByTierQuery = useQuery({
    queryKey:
      typeof eventId === "string"
        ? tripKeys.soldCountsByTier(eventId)
        : ["trips", "__disabled__", "soldCountsByTier"],
    queryFn: () => readTripSoldCountsByTier(eventId as string),
    enabled: typeof eventId === "string" && eventId.length > 0,
    staleTime: 30_000,
  });
  const soldCountByTier = soldCountsByTierQuery.data ?? new Map<string, number>();

  const recentActivity = useMemo<ActivityEvent[]>(() => {
    const events: ActivityEvent[] = [];
    for (const o of ordersQuery.data ?? []) {
      if (o.paymentStatus !== "paid" || o.createdAt.length === 0) continue;
      const tierId = getOrderTierId(o);
      const tier = tripQuery.data?.pricingTiers.find(
        (t) => t.ticketTypeId === tierId,
      );
      events.push({
        kind: "purchase",
        orderId: o.id,
        buyerName: buyerLabel(o),
        summary: `booked ${tier?.tierName ?? "the trip"}`,
        amountGbp: o.totalCents / 100,
        currency: o.currency,
        at: o.createdAt,
      });
    }
    for (const r of installmentsQuery.data ?? []) {
      if (r.status === "collected" && r.collectedAt !== null) {
        events.push({
          kind: "purchase",
          orderId: r.orderId,
          buyerName: buyerLabel(r),
          summary: `paid installment ${r.ordinal}`,
          amountGbp: r.amountCents / 100,
          currency: r.currency,
          at: r.collectedAt,
        });
      }
      if (r.status === "failed" && r.failedAt !== null) {
        events.push({
          kind: "refund",
          orderId: r.orderId,
          buyerName: buyerLabel(r),
          summary: `installment ${r.ordinal} failed`,
          amountGbp: r.amountCents / 100,
          currency: r.currency,
          at: r.failedAt,
        });
      }
    }
    return events
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5);
  }, [installmentsQuery.data, ordersQuery.data, tripQuery.data?.pricingTiers]);

  // Pass 2 — revenue/payout summary from OrderRecord-shaped orders.
  const tripIdForMoney = tripQuery.data?.id ?? null;
  const moneySummary = useMemo(
    () =>
      summarizeEventMoney({
        expectedCurrency:
          tripQuery.data?.pricingTiers[0]?.currency ??
          tripQuery.data?.revenueCurrency ??
          undefined,
        orders:
          tripIdForMoney === null
            ? []
            : (recordOrdersQuery.data ?? []).filter(
                (o) => o.eventId === tripIdForMoney,
              ),
        doorSales: [],
      }),
    [recordOrdersQuery.data, tripIdForMoney, tripQuery.data],
  );
  const dashboardTiles = useMemo(
    () => withListingInsights(buildOfferingDashboardTiles("trip")),
    [],
  );

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

  // ORCH-0947: read canonical tickets-sold count from the trip detail
  // payload (server-derived via biz_trip_tickets_sold). Counting orders
  // client-side underreports because most orders carry >1 ticket.
  const ticketsSold = trip.ticketsSoldCount;
  // #962 N2 — never manufacture a display currency (the old "USD" fallback is a
  // business-display leak too — "do NOT swap to a different literal"). Resolve
  // the trip's REAL currency, or null when the brand has no established currency.
  const primaryCurrency = currencyCodeOrNull(
    [...revenueByCurrency.entries()][0]?.[0] ??
      trip.pricingTiers[0]?.currency ??
      trip.revenueCurrency,
  );
  // Severed from moneySummary.expectedCurrency (which normalizes to "GBP" for a
  // pre-bank brand); drives the KpiCard money — hidden ("—") when null.
  const displayCurrency = currencyCodeOrNull(
    trip.pricingTiers[0]?.currency ?? trip.revenueCurrency,
  );
  const totalRevenue = revenueByCurrency.get(primaryCurrency) ?? 0;
  const spotsLabel = formatTripSpotsLabel(
    ticketsSold,
    trip.businessTrip.capacity,
  );
  const tripLifecycleStatus = deriveTripLifecycleStatus({
    status: trip.status,
    startAt: trip.businessTrip.startAt,
    endAt: trip.businessTrip.endAt,
  });
  const coverMediaType = normalizeCoverMediaType(trip.coverMediaType);

  return (
    <SafeScreen
      style={styles.host}
      testID={tripDashboardBundleProofTestID(trip.id)}
    >
      {/* ORCH-0913-B: share the event dashboard TopBar shell so trip detail
          width/chrome tracks event/[id] instead of carrying a bespoke header. */}
      {/* ORCH-1136 F-1: web-only additive breathing gap so the bar isn't glued
          to the browser viewport top (insets.top === 0 on web). Native uses the
          SafeScreen inset only (+0 here). */}
      <View
        style={[
          styles.headerWrap,
          Platform.OS === "web" ? { paddingTop: spacing.sm } : null,
        ]}
      >
        <TopBar
          leftKind="back"
          onBack={() => router.back()}
          title={trip.title}
          rightSlot={
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
          }
        />
      </View>

      {/* ORCH-0913-A: ScrollView wraps hero + action grid + sections + cancel CTA
          so the entire page scrolls together — only the TopBar header above
          stays fixed. Matches event/[id]/index.tsx:618 boundary (single
          ScrollView starting immediately after the fixed header). Prior to
          ORCH-0913-A the hero and action grid were OUTSIDE the ScrollView,
          which broke parity with event dashboard and left short-viewport
          devices unable to reach the bottom sections without losing the
          tiles. */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          // META-ORCH-1059 Pass 1 — clear the phone's bottom bar (home
          // indicator / gesture nav) so content doesn't bleed into it, mirroring
          // the event dashboard (app/event/[id]/index.tsx).
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
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
          mediaType={coverMediaType}
          radius={24}
          label=""
          height={200}
        />
        <View style={styles.heroOverlay} pointerEvents="none" />
        <View style={styles.heroContent} pointerEvents="none">
          <TripDetailHeroStatusPill status={tripLifecycleStatus} />
          <Text style={styles.heroTitle} numberOfLines={2}>
            {trip.title}
          </Text>
          <Text
            style={styles.heroSubline}
            numberOfLines={1}
            testID="orch-0950-trip-dashboard-hero-subline"
          >
            {formatTripHeroSubline({
              startAt: trip.businessTrip.startAt,
              endAt: trip.businessTrip.endAt,
              destinationLocationText: trip.businessTrip.destinationLocationText,
            })}
          </Text>
        </View>
      </View>

      {/* META-ORCH-1059 Pass 2 — event-grade tile grid built from the per-kind
          config so trips get the full operator set: Scan · Scanners · Orders ·
          Travelers (Guests lens → /trip/{id}/travelers) · Blasts · Public ·
          Brand · Reconciliation. Edit (primary) + Payments + Group chat are
          trip-specific extras kept alongside. */}
      <View style={styles.actionGrid}>
        {/* [ORCH-0913 deliberate divergence from event] Edit remains primary. */}
        <ActionTile
          icon="edit"
          label={trip.status === "draft" ? "Continue editing" : "Edit trip"}
          primary
          onPress={() => router.push(`/trip/${trip.id}/edit` as never)}
        />
        {dashboardTiles.map((tile) => {
          if (tile.key === "insights" && !canShowListingInsights) {
            return null;
          }
          if (
            tile.requiresPublicPage &&
            (trip.brandSlug === null || trip.brandSlug.length === 0)
          ) {
            return null;
          }
          return (
            <ActionTile
              key={tile.key}
              icon={tile.icon}
              label={tile.label}
              accessibilityLabel={
                tile.key === "insights"
                  ? `Open Insights for ${trip.title}`
                  : tile.accessibilityLabel
              }
              sub={
                tile.key === "guests"
                  ? `${ticketsSold} ${ticketsSold === 1 ? "traveler" : "travelers"}`
                  : tile.key === "orders"
                    ? `${ticketsSold} sold`
                    : tile.sub
              }
              onPress={() =>
                router.push(
                  tile.route({
                    id: trip.id,
                    brandSlug: trip.brandSlug,
                    slug: trip.slug,
                  }) as never,
                )
              }
            />
          );
        })}
        <ActionTile
          icon="receipt"
          label="Payments"
          sub={
            (moneyData?.atRiskOrderCount ?? 0) > 0
              ? `${moneyData?.atRiskOrderCount} at risk`
              : undefined
          }
          onPress={() => router.push(`/trip/${trip.id}/money` as never)}
        />
        <ActionTile
          icon="chat"
          label="Group chat"
          sub="Read + reply + moderate"
          onPress={() => router.push(`/event/${trip.id}/group-chat` as never)}
        />
      </View>

        {/* Pass 2 — single revenue-left / payout-right summary (mirrors the
            event dashboard). Real money from orders read by event_id. */}
        <EventDetailKpiCard
          revenueGbp={moneySummary.onlineRevenue}
          payoutGbp={moneySummary.onlineNetMajor}
          currency={displayCurrency}
          readStatus={recordOrdersQuery.status}
          onRetry={() => void recordOrdersQuery.refetch()}
        />

        <TripDetailKpiCard
          revenueLabel={
            primaryCurrency ? formatCurrency(totalRevenue, primaryCurrency) : "—"
          }
          spotsLabel={spotsLabel}
          spotsValueTestID="orch-0950-trip-dashboard-spots-value"
        />

        <Text style={styles.sectionLabel}>PRICING TIERS</Text>
        {trip.pricingTiers.length === 0 ? (
          <GlassCard variant="base" radius="md" padding={spacing.md}>
            <Text style={styles.emptySectionText}>No pricing tiers yet.</Text>
          </GlassCard>
        ) : (
          <View style={styles.tiersList}>
            {trip.pricingTiers.map((tier, index) => (
              <EventDetailTicketTypeRow
                key={tier.ticketTypeId}
                ticket={tripTierToTicketStub(tier, index)}
                soldCount={resolveTripTierSoldCount({
                  ticketTypeId: tier.ticketTypeId,
                  soldCountByTier,
                  tripTicketsSoldCount: ticketsSold,
                  pricingTierCount: trip.pricingTiers.length,
                })}
                capacityTestID={
                  `orch-0950-trip-dashboard-tier-capacity-${tier.ticketTypeId}`
                }
              />
            ))}
          </View>
        )}

        <Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {recentActivity.length === 0 ? (
            <Text style={styles.emptySectionText}>No activity yet.</Text>
          ) : (
            <View style={styles.activityList}>
              {recentActivity.map((a) => (
                <EventDetailActivityRow key={activityRowKey(a)} event={a} />
              ))}
            </View>
          )}
        </GlassCard>

        {/* ORCH-0913: Cancel trip CTA remains last in ScrollView. Only shown for trips
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
          preloadContent
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={`https://host.usemingla.com/t/${trip.brandSlug}/${trip.slug}`}
          contentKind="trip"
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  headerWrap: {
    paddingHorizontal: spacing.md,
  },
  // ORCH-0874 [Trip surfaces visual parity with Events]
  headerRightSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hero: {
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
    ...(Platform.OS === "web"
      ? { textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)" }
      : {
          textShadowColor: "rgba(0, 0, 0, 0.6)",
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 4,
        }),
    marginTop: spacing.xs,
  },
  heroSubline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    ...(Platform.OS === "web"
      ? { textShadow: "0 1px 3px rgba(0, 0, 0, 0.5)" }
      : {
          textShadowColor: "rgba(0, 0, 0, 0.5)",
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 3,
        }),
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionLabelSpacer: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  tiersList: {
    gap: spacing.xs,
  },
  activityList: {
    gap: spacing.xs,
  },
  emptySectionText: {
    fontSize: 13,
    color: textTokens.tertiary,
  },
  cancelTripWrap: {
    marginTop: spacing.xl,
  },
});
