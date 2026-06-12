/**
 * ORCH-0874 [Trip surfaces visual parity with Events] — TripListCard.
 *
 * Mirror of `src/components/event/EventListCard.tsx` shape with trip-native
 * content. Shared visual primitives: 76×92 cover (EventCoverMedia is
 * content-agnostic — accepts a coverHue derived from trip.id), status pill,
 * date/destination subline, capacity progress bar when capacity > 0, manage
 * icon right-rail (32×32 glass.tint.chrome.idle), revenue strip bottom-right.
 *
 * Per SPEC_ORCH-0874 §3.3.1 + DESIGN_ORCH-0874 §3.1 (AFTER mockup).
 *
 * Tap navigation MUST use `routeForEventRow` per I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE.
 */

import React, { useMemo } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { Trip } from "../../services/tripsService";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { DraftSelectCheckbox } from "../offering/DraftSelectCheckbox";
import {
  DraftSelectOverlay,
  useDraftHoldRing,
} from "../offering/DraftSelectOverlay";

export interface TripListCardProps {
  trip: Trip;
  /** Tap card body → routes to /trip/{id}/edit (draft) or /trip/{id} (published). */
  onOpen: () => void;
  /** Optional manage icon (right-rail moreH). Only rendered when provided. */
  onManageOpen?: () => void;
  // ORCH-1123 [Hub multi-select draft delete] — additive selection props.
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  selectable?: boolean;
}

const COVER_W = 76;
const COVER_H = 92;

type TripCardStatus = "live" | "upcoming" | "ended" | "draft" | "cancelled";

function deriveTripCardStatus(trip: Trip): TripCardStatus {
  if (trip.status === "draft") return "draft";
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "ended") return "ended";
  // status === "scheduled" or "live": derive from dates if available.
  const now = Date.now();
  const start = trip.businessTrip.startAt
    ? new Date(trip.businessTrip.startAt).getTime()
    : Number.NaN;
  const end = trip.businessTrip.endAt
    ? new Date(trip.businessTrip.endAt).getTime()
    : Number.NaN;
  if (Number.isFinite(end) && now > end) return "ended";
  if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
    return "live";
  }
  return "upcoming";
}

function formatDateRange(startIso: string | null, endIso: string | null): string {
  if (startIso === null) return "Date TBD";
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    const start = fmt.format(new Date(startIso));
    if (endIso === null) return start;
    const end = fmt.format(new Date(endIso));
    return `${start}–${end}`;
  } catch {
    return "Date TBD";
  }
}

function daysUntil(iso: string | null): number | null {
  if (iso === null) return null;
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

export const TripListCard: React.FC<TripListCardProps> = ({
  trip,
  onOpen,
  onManageOpen,
  selectionMode = false,
  selected = false,
  onLongPress,
  selectable = true,
}) => {
  const title = trip.title.trim().length > 0 ? trip.title : "Untitled trip";
  const status = deriveTripCardStatus(trip);
  const dateLine = useMemo<string>(
    () =>
      formatDateRange(trip.businessTrip.startAt, trip.businessTrip.endAt),
    [trip.businessTrip.startAt, trip.businessTrip.endAt],
  );
  const destination = trip.businessTrip.destinationLocationText;
  const subline = destination !== null && destination.length > 0
    ? `${dateLine} · ${destination}`
    : dateLine;

  // Deterministic cover hue from trip.id when coverHue not set on Trip.
  // EventCoverMedia accepts hue:number; derive a stable hue from id hash.
  const coverHue = useMemo<number>((): number => {
    let h = 0;
    for (let i = 0; i < trip.id.length; i += 1) {
      h = (h * 31 + trip.id.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 360;
  }, [trip.id]);

  const cardAccessibilityLabel = `${title}, ${status}, ${subline}`;
  const isFaded = status === "ended" || status === "cancelled";

  // ORCH-1123 — selection affordances.
  const holdRing = useDraftHoldRing(selectable);
  const dimmedInert = selectionMode && !selectable;
  const showCheckbox = selectionMode && selectable;
  const isCheckboxRow = selectionMode && selectable;

  // Capacity / sold ratio: not directly on Trip; show capacity-only label if set.
  // (True sold-count would require useTripOrders, which is too heavy for a list
  // card and not in scope per SPEC §3.3.1; capacity label only is honest.)
  const capacityLabel = useMemo<string | null>((): string | null => {
    const cap = trip.businessTrip.capacity;
    if (cap === null || cap === undefined) return null;
    return `${cap} ${cap === 1 ? "spot" : "spots"}`;
  }, [trip.businessTrip.capacity]);

  return (
    <Animated.View
      style={[
        styles.host,
        isFaded && styles.hostFaded,
        selected && styles.hostSelected,
        dimmedInert && styles.hostDimmedInert,
        { transform: [{ translateX: holdRing.shakeX }] },
      ]}
      pointerEvents={dimmedInert ? "none" : "auto"}
      {...(dimmedInert
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants" as const,
          }
        : {})}
    >
      <Pressable
        onPress={onOpen}
        onLongPress={
          selectable ? onLongPress : () => holdRing.playNullShake()
        }
        delayLongPress={350}
        onPressIn={holdRing.pressHandlers.onPressIn}
        onPressOut={holdRing.pressHandlers.onPressOut}
        accessibilityRole={isCheckboxRow ? "checkbox" : "button"}
        accessibilityLabel={cardAccessibilityLabel}
        accessibilityState={isCheckboxRow ? { checked: selected } : undefined}
        accessibilityHint={
          selectable && !selectionMode
            ? "Double tap and hold to select multiple"
            : undefined
        }
        style={({ pressed }) => [
          styles.cardBody,
          pressed && styles.cardBodyPressed,
        ]}
      >
        <View style={styles.coverWrap}>
          <EventCoverMedia
            hue={coverHue}
            mediaUrl={null}
            mediaType={null}
            radius={12}
            label=""
            height={COVER_H}
            width={COVER_W}
          />
          {status === "draft" ? (
            <View style={styles.draftOverlay}>
              <Text style={styles.draftOverlayText}>DRAFT</Text>
            </View>
          ) : null}
          {showCheckbox ? (
            <View style={styles.checkboxSlot} pointerEvents="none">
              <DraftSelectCheckbox selected={selected} />
            </View>
          ) : null}
        </View>

        <View style={styles.bodyCol}>
          <View style={styles.pillRow}>
            <TripStatusPill status={status} startAt={trip.businessTrip.startAt} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.dateVenue} numberOfLines={1}>
            {subline}
          </Text>
          {capacityLabel !== null ? (
            <Text style={styles.subText}>{capacityLabel}</Text>
          ) : status === "draft" ? (
            <Text style={styles.subText}>Not published</Text>
          ) : null}
        </View>

        <View style={styles.tapAffordance} pointerEvents="none">
          <Icon name="chevR" size={18} color={textTokens.tertiary} />
        </View>
      </Pressable>

      {/* ORCH-1123 — manage hidden while in selection mode. */}
      {onManageOpen !== undefined && !selectionMode ? (
        <View style={styles.rightRail} pointerEvents="box-none">
          <Pressable
            onPress={onManageOpen}
            accessibilityRole="button"
            accessibilityLabel={`Manage ${title}`}
            style={({ pressed }) => [
              styles.manageBtn,
              pressed && styles.manageBtnPressed,
            ]}
            hitSlop={6}
          >
            <Icon name="moreH" size={16} color={textTokens.primary} />
          </Pressable>
        </View>
      ) : null}

      {/* ORCH-1123 — selected wash + press-and-hold ring overlays. */}
      {selectionMode || selected ? (
        <DraftSelectOverlay
          selected={selected}
          selectable={selectable}
          ringOpacity={holdRing.ringOpacity}
          ringScale={holdRing.ringScale}
        />
      ) : null}
    </Animated.View>
  );
};

interface TripStatusPillProps {
  status: TripCardStatus;
  startAt: string | null;
}

const TripStatusPill: React.FC<TripStatusPillProps> = ({ status, startAt }) => {
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        <Text style={styles.pillText}>LIVE</Text>
      </Pill>
    );
  }
  if (status === "upcoming") {
    const d = daysUntil(startAt);
    const label =
      d !== null && d > 0
        ? `UPCOMING · ${d}D`
        : d === 0
          ? "TODAY"
          : "UPCOMING";
    return (
      <Pill variant="accent">
        <Text style={styles.pillText}>{label}</Text>
      </Pill>
    );
  }
  if (status === "draft") {
    return (
      <Pill variant="draft">
        <Text style={styles.pillText}>DRAFT</Text>
      </Pill>
    );
  }
  if (status === "cancelled") {
    return (
      <View style={styles.pastPill}>
        <Text style={styles.pastPillText}>CANCELLED</Text>
      </View>
    );
  }
  return (
    <View style={styles.pastPill}>
      <Text style={styles.pastPillText}>ENDED</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "relative",
    // META-ORCH-1002 Sub-1 (S6): opaque frosted fill on Android (the translucent
    // rgba(255,255,255,0.04) let the corner ring show); kit-consistent rgba(20,22,26,0.92).
    // iOS keeps the translucent profileBase. All children are positioned inside host
    // bounds (no intentional overflow), so clipping to the radius is safe.
    backgroundColor: Platform.select({
      ios: glass.tint.profileBase,
      android: "rgba(20, 22, 26, 0.92)",
      default: glass.tint.profileBase,
    }),
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "hidden",
  },
  hostFaded: {
    opacity: 0.7,
  },
  // ORCH-1123 — selection visuals.
  hostSelected: {
    borderColor: accent.border,
    borderWidth: 1.5,
  },
  hostDimmedInert: {
    opacity: 0.4,
  },
  cardBody: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    alignItems: "stretch",
  },
  cardBodyPressed: {
    opacity: 0.85,
  },
  coverWrap: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  checkboxSlot: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    zIndex: 2,
  },
  draftOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12, 14, 18, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  draftOverlayText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "rgba(255, 255, 255, 0.7)",
  },
  bodyCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: "space-between",
    paddingRight: 44,
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 36,
  },
  pillRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  pillText: {
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
  pastPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginBottom: 2,
  },
  dateVenue: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  subText: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: textTokens.tertiary,
  },
  rightRail: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
  },
  manageBtn: {
    width: 32,
    height: 32,
    borderRadius: radiusTokens.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  manageBtnPressed: {
    opacity: 0.7,
  },
});

export default TripListCard;
