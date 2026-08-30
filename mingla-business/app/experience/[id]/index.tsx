/**
 * /experience/[id] — operator experience dashboard. META-ORCH-1059 Sub-B +
 * Pass 2 (dashboard tile grid + analytics parity).
 *
 * Mirrors app/event/[id]/index.tsx tile set. Experiences are events-table rows
 * that issue ticket_types-backed tickets, so the shared event sub-screens
 * (scanner/scanners/orders/guests/reconciliation/blasts) resolve directly off
 * the experience id and read orders by event_id. The tile grid is built from
 * the per-kind config (offeringDashboardTiles), so labels read through the
 * experience lens ("Spots" not "Guests"). Revenue/payout + recent activity are
 * derived from useEventOrders, identical to the event dashboard.
 *
 * Layout: fixed TopBar → ScrollView{ hero → tile grid → revenue/payout →
 * STOPS gallery (Types tile) → recent activity → cancel CTA }.
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
import { ActionTile } from "../../../src/components/event/ActionTile";
import { EventDetailKpiCard } from "../../../src/components/event/EventDetailKpiCard";
import {
  EventDetailActivityRow,
  activityRowKey,
} from "../../../src/components/event/EventDetailActivityRow";
import { Button } from "../../../src/components/ui/Button";
import { Pill } from "../../../src/components/ui/Pill";
import {
  deriveTripLifecycleStatus,
  type TripLifecycleStatus,
} from "../../../src/components/trip/TripDetailHeroStatusPill";
import {
  OfferingManageSheet,
  buildOfferingManageActions,
} from "../../../src/components/offering/OfferingManageSheet";
import {
  buildOfferingDashboardTiles,
  withListingInsights,
} from "../../../src/components/offering/offeringDashboardTiles";
import { ExperienceStopsGalleryTile } from "../../../src/components/offering/ExperienceStopsGalleryTile";
import { useExperienceDetail } from "../../../src/hooks/useExperienceDetail";
import { useCancelBusinessEvent } from "../../../src/hooks/useBusinessEvents";
import { useEventOrders } from "../../../src/hooks/useEventOrders";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { isScannerOnlyRank } from "../../../src/utils/navTabGate";
import { summarizeEventMoney } from "../../../src/utils/moneySummary";
import { offeringActivityFromOrders } from "../../../src/utils/offeringActivityFromOrders";
import { formatExperienceDateSubline } from "../../../src/utils/experienceDateSubline";
import { unpublishExperienceToDraft } from "../../../src/services/experienceDetailService";

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

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function HeroStatusPill({
  status,
}: {
  status: TripLifecycleStatus | "draft";
}): React.ReactElement {
  if (status === "draft") {
    return <Pill variant="draft">Draft</Pill>;
  }
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        Live
      </Pill>
    );
  }
  if (status === "upcoming") {
    return <Pill variant="accent">Upcoming</Pill>;
  }
  if (status === "cancelled") {
    return <Pill variant="error">Cancelled</Pill>;
  }
  return <Pill variant="draft">Past</Pill>;
}

export default function ExperienceDashboardRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const detailQuery = useExperienceDetail(
    typeof eventId === "string" ? eventId : null,
  );
  const cancelMutation = useCancelBusinessEvent();
  // Pass 2 — orders read by event_id (experiences are events-rows). Same hook
  // the event dashboard uses; drives revenue/payout + recent activity.
  const ordersQuery = useEventOrders(
    typeof eventId === "string" ? eventId : null,
  );

  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [manageMenuVisible, setManageMenuVisible] = useState(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [unpublishDialogVisible, setUnpublishDialogVisible] = useState(false);
  const [unpublishSubmitting, setUnpublishSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });

  const experience = detailQuery.data ?? null;
  useSuccessfulBusinessRecentOpen({
    brandId: experience?.brandId ?? null, entityType: "experience",
    entityId: typeof eventId === "string" ? eventId : null,
    ready: experience !== null && !detailQuery.isLoading && !detailQuery.isError,
    title: experience?.title, coverUrl: experience?.coverMediaUrl,
    coverPosterUrl: experience?.coverMediaPosterUrl, coverType: experience?.coverMediaType,
    status: experience?.status,
  });
  const currentBrandRole = useCurrentBrandRole(experience?.brandId ?? null);
  const canShowListingInsights =
    !currentBrandRole.isLoading &&
    !currentBrandRole.isError &&
    currentBrandRole.role !== null &&
    !isScannerOnlyRank(currentBrandRole.rank);

  const subline = useMemo(() => {
    if (experience === null) return "";
    return formatExperienceDateSubline({
      venueText: experience.venueText,
      dateStartIsos: experience.dates.map((d) => d.startAt),
      whenMode: experience.whenMode,
      recurrenceRule: experience.recurrenceRule,
    });
  }, [experience]);

  // Pass 2 — revenue/payout + recent activity from orders (mirrors the event
  // dashboard's money summary + activity feed). Declared before any early
  // return so hook order is stable.
  const allOrders = ordersQuery.data ?? [];
  const ordersReady =
    ordersQuery.status === "ready" || ordersQuery.status === "stale-error";
  const moneySummary = useMemo(
    () =>
      summarizeEventMoney({
        expectedCurrency: experience?.currency,
        orders:
          experience === null
            ? []
            : allOrders.filter((o) => o.eventId === experience.id),
        doorSales: [],
      }),
    [allOrders, experience],
  );
  const recentActivity = useMemo(
    () =>
      experience === null
        ? []
        : offeringActivityFromOrders(
            allOrders.filter((o) => o.eventId === experience.id),
          ),
    [allOrders, experience],
  );
  const soldCount = useMemo<number | null>(() => {
    if (experience === null || !ordersReady) return null;
    return allOrders
      .filter(
        (o) =>
          o.eventId === experience.id &&
          (o.status === "paid" || o.status === "refunded_partial"),
      )
      .reduce(
        (sum, o) =>
          sum +
          o.lines.reduce(
            (ls, l) => ls + Math.max(0, l.quantity - l.refundedQuantity),
            0,
          ),
        0,
      );
  }, [allOrders, experience, ordersReady]);
  const tiles = useMemo(
    () => withListingInsights(buildOfferingDashboardTiles("experience")),
    [],
  );

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Experience not found</Text>
      </SafeScreen>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <SafeScreen style={styles.stateHost}>
        <ActivityIndicator />
      </SafeScreen>
    );
  }

  if (detailQuery.isError) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Couldn&rsquo;t load experience</Text>
        <Text style={styles.body}>
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : "Try again."}
        </Text>
      </SafeScreen>
    );
  }

  if (experience === null) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Experience not found</Text>
        <Text style={styles.body}>
          This experience may have been deleted or you don&rsquo;t have access.
        </Text>
      </SafeScreen>
    );
  }

  const isDraft = experience.status === "draft";
  const lifecycleStatus: TripLifecycleStatus | "draft" = isDraft
    ? "draft"
    : deriveTripLifecycleStatus({
        status: experience.status,
        startAt: experience.dates[0]?.startAt ?? null,
        endAt:
          experience.dates.length > 0
            ? experience.dates[experience.dates.length - 1].endAt
            : null,
      });

  const hasPublicPage =
    experience.brandSlug !== null && experience.brandSlug.length > 0;
  const ticket = experience.ticket;
  const priceLabel =
    ticket === null
      ? "—"
      : ticket.isFree
        ? "Free"
        : formatCurrency(ticket.priceCents, experience.currency);
  const capacityLabel =
    ticket === null
      ? "—"
      : ticket.isUnlimited || ticket.quantityTotal === null
        ? "Unlimited"
        : `${ticket.quantityTotal} spots`;

  return (
    <SafeScreen style={styles.host}>
      {/* ORCH-1136 F-1: web-only additive breathing gap (insets.top === 0 on
          web); native uses the SafeScreen inset only (+0 here). */}
      <View
        style={[
          styles.headerWrap,
          Platform.OS === "web" ? { paddingTop: spacing.sm } : null,
        ]}
      >
        <TopBar
          leftKind="back"
          onBack={() => router.back()}
          title={experience.title}
          rightSlot={
            <View style={styles.headerRightSlot}>
              {hasPublicPage ? (
                <IconChrome
                  icon="share"
                  size={36}
                  onPress={() => setShareModalVisible(true)}
                  accessibilityLabel="Share experience"
                />
              ) : null}
              <IconChrome
                icon="moreH"
                size={36}
                onPress={() => setManageMenuVisible(true)}
                accessibilityLabel="Experience options"
              />
            </View>
          }
        />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          // META-ORCH-1059 Pass 1 — clear the phone's bottom bar (home
          // indicator / gesture nav), mirroring the event dashboard.
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <EventCoverMedia
            hue={hueFromId(experience.id)}
            mediaUrl={experience.coverMediaUrl}
            mediaType={experience.coverMediaType}
            radius={24}
            label=""
            height={200}
          />
          <View style={styles.heroOverlay} pointerEvents="none" />
          <View style={styles.heroContent} pointerEvents="none">
            <HeroStatusPill status={lifecycleStatus} />
            <Text style={styles.heroTitle} numberOfLines={2}>
              {experience.title}
            </Text>
            <Text style={styles.heroSubline} numberOfLines={1}>
              {subline}
            </Text>
          </View>
        </View>

        {/* Pass 2 — event-grade tile grid, built from the per-kind config so
            labels read through the experience lens (e.g. "Spots" not
            "Guests"). Edit stays the primary tile (drafts say "Continue
            editing"). Public/Brand tiles only render when a public page
            exists, so there are no dead taps. */}
        <View style={styles.actionGrid}>
          <ActionTile
            icon="edit"
            label={isDraft ? "Continue editing" : "Edit"}
            primary
            onPress={() =>
              router.push(`/experience/${experience.id}/edit` as never)
            }
          />
          {tiles.map((tile) => {
            if (tile.key === "insights" && !canShowListingInsights) {
              return null;
            }
            if (tile.requiresPublicPage && !hasPublicPage) return null;
            return (
              <ActionTile
                key={tile.key}
                icon={tile.icon}
                label={tile.label}
                accessibilityLabel={
                  tile.key === "insights"
                    ? `Open Insights for ${experience.title}`
                    : tile.accessibilityLabel
                }
                sub={
                  tile.key === "orders"
                    ? soldCount === null
                      ? ordersQuery.status === "loading" ||
                        ordersQuery.status === "disabled"
                        ? "Loading…"
                        : "Unable to load"
                      : `${soldCount} sold`
                    : tile.sub
                }
                onPress={() =>
                  router.push(
                    tile.route({
                      id: experience.id,
                      brandSlug: experience.brandSlug,
                      slug: experience.slug,
                    }) as never,
                  )
                }
              />
            );
          })}
        </View>

        {/* Pass 2 — revenue-left / payout-right summary (mirrors the event
            dashboard). Real money from orders read by event_id. */}
        <EventDetailKpiCard
          revenueGbp={moneySummary.onlineRevenue}
          payoutGbp={moneySummary.onlineNetMajor}
          currency={experience.currency}
          readStatus={ordersQuery.status}
          onRetry={() => void ordersQuery.refetch()}
        />

        {/* Pricing summary (price + capacity) — kept below the money card. */}
        <Text style={styles.sectionLabel}>PRICING</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCol}>
              <Text style={styles.kpiValue}>{priceLabel}</Text>
              <Text style={styles.kpiCaption}>Price</Text>
            </View>
            <View style={styles.kpiCol}>
              <Text style={styles.kpiValue}>{capacityLabel}</Text>
              <Text style={styles.kpiCaption}>Capacity</Text>
            </View>
          </View>
        </GlassCard>

        {/* Pass 2 — "Types" tile for experiences = the STOPS, each spot's full
            detail + a horizontally scrollable image gallery. */}
        <Text style={styles.sectionLabelSpacer}>STOPS</Text>
        <ExperienceStopsGalleryTile
          stops={experience.stops}
          currency={experience.currency}
          showStopPrices={experience.pricingMode === "per_stop"}
        />

        {/* Pass 2 — Recent activity (purchase / refund / cancel). */}
        <Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {ordersQuery.status === "loading" || ordersQuery.status === "disabled" ? (
            <Text style={styles.emptySectionText} accessibilityRole="progressbar">
              Loading activity…
            </Text>
          ) : ordersQuery.status === "error" ? (
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => void ordersQuery.refetch()}
              fullWidth
            />
          ) : recentActivity.length === 0 ? (
            <Text style={styles.emptySectionText}>No activity yet.</Text>
          ) : (
            <View style={styles.activityList}>
              {recentActivity.map((a) => (
                <EventDetailActivityRow key={activityRowKey(a)} event={a} />
              ))}
            </View>
          )}
        </GlassCard>

        {experience.status === "scheduled" ? (
          <View style={styles.cancelWrap}>
            <Button
              label="Return experience to draft"
              variant="ghost"
              size="md"
              onPress={() => setUnpublishDialogVisible(true)}
              fullWidth
              testID="experience-dashboard-unpublish-cta"
            />
          </View>
        ) : null}

        {experience.status !== "ended" &&
        experience.status !== "cancelled" &&
        experience.status !== "draft" ? (
          <View style={styles.cancelWrap}>
            <Button
              label="Cancel experience"
              variant="ghost"
              size="md"
              onPress={() => setCancelDialogVisible(true)}
              fullWidth
              testID="experience-dashboard-cancel-cta"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* META-ORCH-1059 Pass 1 — shared per-kind manage sheet (kind="experience").
          Opened from the header 3-dot. Edit · View public · Share · Cancel.
          Orders + Duplicate are intentionally omitted: experiences have no
          orders/bookings route and no duplicate flow yet (scoped out — see the
          implementation report), so showing them would be a dead tap. */}
      <OfferingManageSheet
        visible={manageMenuVisible}
        onClose={() => setManageMenuVisible(false)}
        kind="experience"
        actions={buildOfferingManageActions(
          "experience",
          {
            onEdit: () =>
              router.push(`/experience/${experience.id}/edit` as never),
            onViewPublic: hasPublicPage
              ? () =>
                  router.push(
                    `/exp/${experience.brandSlug}/${experience.slug}` as never,
                  )
              : undefined,
            onShare: hasPublicPage
              ? () => setShareModalVisible(true)
              : undefined,
            onCancel:
              experience.status !== "ended" &&
              experience.status !== "cancelled" &&
              experience.status !== "draft"
                ? () => setCancelDialogVisible(true)
                : undefined,
          },
          () => setManageMenuVisible(false),
        )}
      />

      {hasPublicPage ? (
        <ShareModal
          preloadContent
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={`https://host.usemingla.com/exp/${experience.brandSlug}/${experience.slug}`}
          contentKind="experience"
          title={`${experience.title} on Mingla`}
          description={
            experience.description !== null && experience.description.length > 0
              ? experience.description.slice(0, 200)
              : experience.title
          }
        />
      ) : null}

      <ConfirmDialog
        visible={unpublishDialogVisible}
        onClose={() => {
          if (unpublishSubmitting) return;
          setUnpublishDialogVisible(false);
        }}
        onConfirm={async () => {
          setUnpublishSubmitting(true);
          try {
            await unpublishExperienceToDraft(experience.id);
            setUnpublishDialogVisible(false);
            setToast({ visible: true, kind: "success", message: "Experience returned to draft." });
            await detailQuery.refetch();
          } catch (e) {
            setToast({
              visible: true,
              kind: "error",
              message: e instanceof Error ? e.message : "Couldn't return this experience to draft.",
            });
          } finally {
            setUnpublishSubmitting(false);
          }
        }}
        title="Return this experience to draft?"
        description="Its public dates and checkout will disappear. Your stops, pricing, cover, and settings will remain available for editing."
        confirmLabel="Return to draft"
        cancelLabel="Keep it published"
        confirmLoading={unpublishSubmitting}
        confirmDisabled={unpublishSubmitting}
        closeDisabled={unpublishSubmitting}
        testID="experience-dashboard-unpublish-dialog"
      />

      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => {
          if (cancelSubmitting) return;
          setCancelDialogVisible(false);
        }}
        onConfirm={async () => {
          setCancelSubmitting(true);
          try {
            await cancelMutation.cancelEvent({
              eventId: experience.id,
              brandId: experience.brandId,
            });
            setCancelDialogVisible(false);
            setToast({
              visible: true,
              kind: "info",
              message: "Experience cancelled.",
            });
            setTimeout(() => router.back(), 300);
          } catch (e) {
            setToast({
              visible: true,
              kind: "error",
              message:
                e instanceof Error
                  ? e.message
                  : "Couldn't cancel experience. Try again.",
            });
          } finally {
            setCancelSubmitting(false);
          }
        }}
        title="Cancel this experience?"
        description="Buyers will be notified and refunds processed in a future release. This can't be undone."
        variant="typeToConfirm"
        confirmText={experience.title.length > 0 ? experience.title : experience.slug}
        confirmLabel="Cancel experience"
        cancelLabel="Keep it live"
        confirmLoading={cancelSubmitting}
        confirmDisabled={cancelSubmitting}
        closeDisabled={cancelSubmitting}
        destructive
        testID="experience-dashboard-cancel-dialog"
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
  host: { flex: 1, backgroundColor: "#0c0e12" },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  title: { fontSize: typography.h3.fontSize, color: textTokens.primary },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  headerWrap: { paddingHorizontal: spacing.md },
  headerRightSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hero: { borderRadius: 24, overflow: "hidden", position: "relative" },
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
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  kpiRow: { flexDirection: "row", gap: spacing.lg },
  kpiCol: { flex: 1, gap: 2 },
  kpiValue: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  kpiCaption: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  activityList: { gap: spacing.xs },
  emptySectionText: { fontSize: 13, color: textTokens.tertiary },
  cancelWrap: { marginTop: spacing.xl },
});
