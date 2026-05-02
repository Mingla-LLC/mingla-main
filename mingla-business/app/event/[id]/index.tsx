/**
 * J-E13 — Event Detail screen.
 *
 * Route: /event/{id} (id = LiveEvent.id `le_<ts36>` or DraftEvent.id `de_<ts36>`)
 *
 * Founder-side screen showing event KPIs, ticket types, and recent
 * activity. Drafts redirect to /event/{id}/edit (drafts have no detail).
 *
 * Hero (cover band + status pill + name + date+venue) → action grid (5
 * tiles: Scan, Orders, Guests, Public page, Brand page) → revenue card
 * → ticket types section → recent activity section.
 *
 * 9a renders zero KPIs / empty activity feed (orderStore lands in 9c).
 *
 * Per Cycle 9 spec §3.A.2.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import { useDraftById } from "../../../src/store/draftEventStore";
import type { TicketStub } from "../../../src/store/draftEventStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { formatGbp } from "../../../src/utils/currency";

import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCover } from "../../../src/components/ui/EventCover";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import type { IconName } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Pill } from "../../../src/components/ui/Pill";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";

import { EndSalesSheet } from "../../../src/components/event/EndSalesSheet";
import { EventDetailKpiCard } from "../../../src/components/event/EventDetailKpiCard";
import { EventManageMenu } from "../../../src/components/event/EventManageMenu";

const CANCEL_PROCESSING_MS = 1200;
const cancelSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ----- Status derivation (mirrors EventListCard) -------------------

type EventStatus = "live" | "upcoming" | "past";

const deriveLiveStatus = (event: LiveEvent): EventStatus => {
  if (event.status === "cancelled") return "past";
  if (event.endedAt !== null) return "past";
  if (event.date === null) return "upcoming";
  const eventTime = new Date(event.date).getTime();
  if (!Number.isFinite(eventTime)) return "upcoming";
  const liveWindowStart = eventTime - 4 * 60 * 60 * 1000;
  const liveWindowEnd = eventTime + 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now >= liveWindowStart && now < liveWindowEnd) return "live";
  if (now < liveWindowStart) return "upcoming";
  return "past";
};

const canonicalUrl = (event: LiveEvent): string =>
  `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`;

export default function EventDetailScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : null;

  // ----- Resolve event -------------------------------------------
  const liveEvent = useLiveEventStore((s) =>
    id === null ? null : s.events.find((e) => e.id === id) ?? null,
  );
  const draftEvent = useDraftById(id);
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (liveEvent !== null) {
      return brands.find((b) => b.id === liveEvent.brandId) ?? null;
    }
    if (draftEvent !== null) {
      return brands.find((b) => b.id === draftEvent.brandId) ?? null;
    }
    return null;
  }, [liveEvent, draftEvent, brands]);

  // ----- Defensive: draft → redirect to edit ---------------------
  useEffect(() => {
    if (id === null) return;
    if (liveEvent === null && draftEvent !== null) {
      router.replace(`/event/${id}/edit` as never);
    }
  }, [id, liveEvent, draftEvent, router]);

  // ----- State ---------------------------------------------------
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [manageMenuVisible, setManageMenuVisible] = useState<boolean>(false);
  const [endSalesVisible, setEndSalesVisible] = useState<boolean>(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // ----- Mutations ----------------------------------------------
  const updateLifecycle = useLiveEventStore((s) => s.updateLifecycle);

  // ----- Handlers -------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/events" as never);
    }
  }, [router]);

  const handleShareOpen = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  const handleManageOpen = useCallback((): void => {
    setManageMenuVisible(true);
  }, []);

  const handleManageClose = useCallback((): void => {
    setManageMenuVisible(false);
  }, []);

  const handleEdit = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/edit` as never);
    }
  }, [id, router]);

  const handleViewPublic = useCallback((): void => {
    if (liveEvent !== null) {
      router.push(
        `/e/${liveEvent.brandSlug}/${liveEvent.eventSlug}` as never,
      );
    }
  }, [liveEvent, router]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ----- Action grid handlers -----------------------------------
  const handleScanTickets = useCallback((): void => {
    showToast("Scanner lands Cycle 11.");
  }, [showToast]);

  const handleOrders = useCallback((): void => {
    showToast("Orders ledger lands Cycle 9c.");
  }, [showToast]);

  const handleGuests = useCallback((): void => {
    showToast("Guests + approval flow lands Cycle 10 + B4.");
  }, [showToast]);

  const handleBrandPage = useCallback((): void => {
    if (brand !== null) {
      router.push(`/brand/${brand.id}` as never);
    }
  }, [brand, router]);

  // ----- Lifecycle handlers (9b-1) -------------------------------
  const handleEndSalesOpen = useCallback((): void => {
    setEndSalesVisible(true);
  }, []);

  const handleEndSalesConfirm = useCallback((): void => {
    if (id !== null) {
      updateLifecycle(id, { endedAt: new Date().toISOString() });
    }
    setEndSalesVisible(false);
    showToast("Ticket sales ended.");
  }, [id, updateLifecycle, showToast]);

  const handleCancelDialogOpen = useCallback((): void => {
    setCancelDialogVisible(true);
  }, []);

  const handleCancelConfirm = useCallback(async (): Promise<void> => {
    if (id === null) return;
    // 1.2s simulated processing per spec §3.0.1 Q-9-3.
    await cancelSleep(CANCEL_PROCESSING_MS);
    updateLifecycle(id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    });
    setCancelDialogVisible(false);
    // [TRANSITIONAL] Buyer email cascade is a no-op stub — B-cycle
    // wires Resend + auto-refund triggers.
    showToast(
      "Event cancelled. Buyers will be refunded when emails wire up (B-cycle).",
    );
    router.replace("/(tabs)/events" as never);
  }, [id, updateLifecycle, router, showToast]);

  const handleDeleteDraftStub = useCallback((): void => {
    // Cycle 9b-1 EventDetail is for LIVE events only — draft delete is
    // wired in events.tsx parent. EventDetail's manage menu wiring sees
    // status !== "draft" so this won't be invoked, but the prop is
    // required by the menu's interface.
    showToast(
      "Draft delete not available from Event Detail. Use Events tab.",
    );
  }, [showToast]);

  // ----- Render not-found shell -----------------------------------
  if (id === null || (liveEvent === null && draftEvent === null)) {
    return (
      <View style={styles.host}>
        <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
          <TopBar leftKind="back" onBack={handleBack} title="Event" />
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="This event may have been deleted or moved."
            cta={{ label: "Back to events", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // Drafts → redirected via useEffect; render empty shell briefly
  if (liveEvent === null) {
    return <View style={styles.host} />;
  }

  const event = liveEvent;
  const status = deriveLiveStatus(event);
  const dateLine = formatDraftDateLine(event);

  // Stub KPIs in 9a — populate from useOrderStore in 9c
  const revenueGbp = 0; // [Cycle 9c]
  const payoutGbp = 0; // [Cycle 9c] revenueGbp × 0.96 stub Stripe fee retention

  return (
    <View style={styles.host}>
      {/* Header */}
      <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title="Event"
          rightSlot={
            <View style={styles.headerRightRow}>
              <IconChrome
                icon="share"
                size={36}
                onPress={handleShareOpen}
                accessibilityLabel="Share event"
              />
              <IconChrome
                icon="moreH"
                size={36}
                onPress={handleManageOpen}
                accessibilityLabel="Manage event"
              />
            </View>
          }
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — cover band + status pill + name + date+venue */}
        <View style={styles.hero}>
          <View style={styles.heroCoverWrap}>
            <EventCover hue={event.coverHue} radius={24} label="" height={200} />
          </View>
          <View style={styles.heroOverlay} pointerEvents="none">
            <View style={styles.heroPillRow}>
              <HeroStatusPill status={status} />
            </View>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {event.name.trim().length > 0 ? event.name : "Untitled event"}
            </Text>
            <Text style={styles.heroSubline} numberOfLines={1}>
              {dateLine}
              {event.venueName !== null && event.venueName.length > 0
                ? ` · ${event.venueName}`
                : ""}
            </Text>
          </View>
        </View>

        {/* Action grid */}
        <View style={styles.actionGrid}>
          <ActionTile
            icon="qr"
            label="Scan tickets"
            primary
            onPress={handleScanTickets}
          />
          <ActionTile
            icon="ticket"
            label="Orders"
            sub={`${0} sold`}
            onPress={handleOrders}
          />
          <ActionTile
            icon="user"
            label="Guests"
            sub="0 pending"
            onPress={handleGuests}
          />
          <ActionTile
            icon="eye"
            label="Public page"
            onPress={handleViewPublic}
          />
          {brand !== null ? (
            <ActionTile
              icon="user"
              label="Brand page"
              sub={`@${brand.slug}`}
              onPress={handleBrandPage}
            />
          ) : null}
        </View>

        {/* Revenue card */}
        <EventDetailKpiCard revenueGbp={revenueGbp} payoutGbp={payoutGbp} />

        {/* Ticket types section */}
        <Text style={styles.sectionLabel}>TICKET TYPES</Text>
        {event.tickets.length === 0 ? (
          <GlassCard variant="base" radius="md" padding={spacing.md}>
            <Text style={styles.emptySectionText}>No ticket types yet.</Text>
          </GlassCard>
        ) : (
          <View style={styles.ticketTypesList}>
            {event.tickets
              .filter((t) => t.visibility !== "hidden")
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((ticket) => (
                <TicketTypeRow key={ticket.id} ticket={ticket} />
              ))}
          </View>
        )}

        {/* Recent activity section */}
        <Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          <Text style={styles.emptySectionText}>No activity yet.</Text>
        </GlassCard>

        {/* Cancel event CTA — opens ConfirmDialog with typeToConfirm
            (case-sensitive match on event.name; ConfirmDialog primitive
            default per DEC-079 — no kit extension for case folding). */}
        {status === "live" || status === "upcoming" ? (
          <View style={styles.cancelCtaWrap}>
            <Button
              label="Cancel event"
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleCancelDialogOpen}
              accessibilityLabel="Cancel event"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Share modal — Cycle 7 reuse */}
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        title={`${event.name} on Mingla`}
        description={event.description.slice(0, 200) || event.name}
      />

      {/* Manage menu — Sheet primitive */}
      {brand !== null ? (
        <EventManageMenu
          visible={manageMenuVisible}
          onClose={handleManageClose}
          event={event}
          status={status}
          brand={brand}
          onShare={() => {
            setManageMenuVisible(false);
            setShareModalVisible(true);
          }}
          onEdit={() => {
            setManageMenuVisible(false);
            handleEdit();
          }}
          onViewPublic={() => {
            setManageMenuVisible(false);
            handleViewPublic();
          }}
          onEndSales={() => {
            setManageMenuVisible(false);
            handleEndSalesOpen();
          }}
          onCancelEvent={() => {
            setManageMenuVisible(false);
            handleCancelDialogOpen();
          }}
          onDeleteDraft={() => {
            setManageMenuVisible(false);
            handleDeleteDraftStub();
          }}
          onTransitionalToast={showToast}
        />
      ) : null}

      {/* End sales sheet — opens from manage menu's "End ticket sales" */}
      <EndSalesSheet
        visible={endSalesVisible}
        onClose={() => setEndSalesVisible(false)}
        onConfirm={handleEndSalesConfirm}
        eventName={event.name.trim().length > 0 ? event.name : "this event"}
      />

      {/* Cancel event ConfirmDialog — typeToConfirm variant */}
      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => setCancelDialogVisible(false)}
        onConfirm={handleCancelConfirm}
        title="Cancel this event?"
        description="This is serious. Buyers will be notified by email and refunded automatically when those wire up (B-cycle). You can't undo this."
        variant="typeToConfirm"
        confirmText={event.name.trim().length > 0 ? event.name : event.eventSlug}
        confirmLabel="Cancel event"
        cancelLabel="Keep event live"
        destructive
      />


      {/* TRANSITIONAL toast wrap — top-anchored per memory rule */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ---- Action tile (composed inline — NOT a kit primitive) ----------

interface ActionTileProps {
  icon: IconName;
  label: string;
  sub?: string;
  primary?: boolean;
  onPress: () => void;
}

const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  sub,
  primary = false,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [
      tileStyles.host,
      primary && tileStyles.hostPrimary,
      pressed && tileStyles.hostPressed,
    ]}
  >
    <Icon
      name={icon}
      size={20}
      color={primary ? accent.warm : textTokens.primary}
    />
    <Text style={tileStyles.label} numberOfLines={1}>
      {label}
    </Text>
    {sub !== undefined ? (
      <Text style={tileStyles.sub} numberOfLines={1}>
        {sub}
      </Text>
    ) : null}
  </Pressable>
);

const tileStyles = StyleSheet.create({
  host: {
    flexBasis: "48%",
    flexGrow: 0,
    minHeight: 76,
    padding: spacing.md - 2,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 4,
  },
  hostPrimary: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  hostPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  sub: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
});

// ---- Hero status pill (composed inline — handles "live"/"upcoming"/"past") ----

interface HeroStatusPillProps {
  status: EventStatus;
}

const HeroStatusPill: React.FC<HeroStatusPillProps> = ({ status }) => {
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        <Text style={pillStyles.text}>LIVE</Text>
      </Pill>
    );
  }
  if (status === "upcoming") {
    return (
      <Pill variant="accent">
        <Text style={pillStyles.text}>UPCOMING</Text>
      </Pill>
    );
  }
  return (
    <View style={pillStyles.pastPill}>
      <Text style={pillStyles.pastText}>ENDED</Text>
    </View>
  );
};

const pillStyles = StyleSheet.create({
  text: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.primary,
  },
  pastPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pastText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
});

// ---- TicketTypeRow (composed inline) -------------------------------

interface TicketTypeRowProps {
  ticket: TicketStub;
}

const TicketTypeRow: React.FC<TicketTypeRowProps> = ({ ticket }) => {
  // soldCount stub = 0 in 9a; populated from useOrderStore in 9c
  const sold = 0;
  const cap = ticket.isUnlimited
    ? Number.POSITIVE_INFINITY
    : (ticket.capacity ?? 0);
  const isSoldOut = !ticket.isUnlimited && cap > 0 && sold >= cap;
  const priceText = ticket.isFree ? "Free" : formatGbp(ticket.priceGbp ?? 0);
  const capText = ticket.isUnlimited
    ? `${sold} sold`
    : `${sold} / ${cap}`;

  return (
    <View style={ticketRowStyles.host}>
      <View style={ticketRowStyles.col}>
        <Text style={ticketRowStyles.name} numberOfLines={1}>
          {ticket.name}
        </Text>
        <Text style={ticketRowStyles.price}>{priceText}</Text>
      </View>
      <View style={ticketRowStyles.right}>
        {isSoldOut ? (
          <View style={ticketRowStyles.soldBadge}>
            <Text style={ticketRowStyles.soldText}>SOLD OUT</Text>
          </View>
        ) : (
          <Text style={ticketRowStyles.cap}>{capText}</Text>
        )}
      </View>
    </View>
  );
};

const ticketRowStyles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  price: {
    fontSize: 12,
    color: textTokens.secondary,
  },
  right: {
    alignItems: "flex-end",
  },
  cap: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  soldBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  soldText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: semantic.error,
  },
});

// ---- Page styles ---------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  headerWrap: {
    paddingHorizontal: spacing.md,
  },
  headerRightRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  hero: {
    position: "relative",
    height: 200,
    borderRadius: radiusTokens.xl,
    overflow: "hidden",
  },
  heroCoverWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  heroPillRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
    marginBottom: 4,
  },
  heroSubline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
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
  ticketTypesList: {
    gap: spacing.xs,
  },
  emptySectionText: {
    fontSize: 13,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  cancelCtaWrap: {
    marginTop: spacing.xl,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
