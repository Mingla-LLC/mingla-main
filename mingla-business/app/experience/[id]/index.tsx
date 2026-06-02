/**
 * /experience/[id] — operator experience dashboard. META-ORCH-1059 Sub-B.
 *
 * Mirrors app/trip/[id]/index.tsx (fixed TopBar → ScrollView{ hero → action
 * grid → KPI → stops/tiers → cancel CTA }). Experiences are events-table rows,
 * so the lifecycle pill + cancel reuse the same derive-from-dates logic.
 *
 * Tile scope (Sub-B functional core): Edit (primary), Public page, Brand page,
 * Share, Cancel. Orders / Check-in / Blasts tiles are a fast-follow (the
 * experience orders/scanner routes don't exist yet) — omitted cleanly here so
 * there are NO dead taps.
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
import { Button } from "../../../src/components/ui/Button";
import { Pill } from "../../../src/components/ui/Pill";
import {
  deriveTripLifecycleStatus,
  type TripLifecycleStatus,
} from "../../../src/components/trip/TripDetailHeroStatusPill";
import { useExperienceDetail } from "../../../src/hooks/useExperienceDetail";
import { useCancelBusinessEvent } from "../../../src/hooks/useBusinessEvents";
import { formatExperienceDateSubline } from "../../../src/utils/experienceDateSubline";

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
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const detailQuery = useExperienceDetail(
    typeof eventId === "string" ? eventId : null,
  );
  const cancelMutation = useCancelBusinessEvent();

  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });

  const experience = detailQuery.data ?? null;

  const subline = useMemo(() => {
    if (experience === null) return "";
    return formatExperienceDateSubline({
      venueText: experience.venueText,
      dateStartIsos: experience.dates.map((d) => d.startAt),
      whenMode: experience.whenMode,
      recurrenceRule: experience.recurrenceRule,
    });
  }, [experience]);

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
      <View style={styles.headerWrap}>
        <TopBar
          leftKind="back"
          onBack={() => router.back()}
          title={experience.title}
          rightSlot={
            hasPublicPage ? (
              <IconChrome
                icon="share"
                size={36}
                onPress={() => setShareModalVisible(true)}
                accessibilityLabel="Share experience"
              />
            ) : null
          }
        />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
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

        <View style={styles.actionGrid}>
          <ActionTile
            icon="edit"
            label={isDraft ? "Continue editing" : "Edit"}
            primary
            onPress={() =>
              router.push(`/experience/${experience.id}/edit` as never)
            }
          />
          {hasPublicPage ? (
            <ActionTile
              icon="eye"
              label="Public page"
              onPress={() =>
                router.push(
                  `/exp/${experience.brandSlug}/${experience.slug}` as never,
                )
              }
            />
          ) : null}
          {hasPublicPage ? (
            <ActionTile
              icon="user"
              label="Brand page"
              onPress={() =>
                router.push(`/b/${experience.brandSlug}` as never)
              }
            />
          ) : null}
          {hasPublicPage ? (
            <ActionTile
              icon="share"
              label="Share"
              onPress={() => setShareModalVisible(true)}
            />
          ) : null}
        </View>

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

        <Text style={styles.sectionLabelSpacer}>STOPS</Text>
        {experience.stops.length === 0 ? (
          <GlassCard variant="base" radius="md" padding={spacing.md}>
            <Text style={styles.emptySectionText}>No stops yet.</Text>
          </GlassCard>
        ) : (
          <View style={styles.stopList}>
            {experience.stops.map((stop) => (
              <GlassCard
                key={stop.id}
                variant="base"
                radius="md"
                padding={spacing.md}
              >
                <Text style={styles.stopName} numberOfLines={1}>
                  {stop.stopOrder + 1}. {stop.placeName}
                </Text>
                {stop.address.length > 0 ? (
                  <Text style={styles.stopAddress} numberOfLines={1}>
                    {stop.address}
                  </Text>
                ) : null}
              </GlassCard>
            ))}
          </View>
        )}

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

      {hasPublicPage ? (
        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={`https://business.usemingla.com/exp/${experience.brandSlug}/${experience.slug}`}
          title={`${experience.title} on Mingla`}
          description={
            experience.description !== null && experience.description.length > 0
              ? experience.description.slice(0, 200)
              : experience.title
          }
        />
      ) : null}

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
  stopList: { gap: spacing.xs },
  stopName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stopAddress: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  emptySectionText: { fontSize: 13, color: textTokens.tertiary },
  cancelWrap: { marginTop: spacing.xl },
});
