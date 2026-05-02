/**
 * EventListCard — row in the founder Events tab list.
 *
 * 76×92 cover (EventCover, hue from event.coverHue) + DRAFT overlay if
 * status="draft" + body (status pill + title + date+venue + progress bar
 * OR series/no-data sub-text) + right rail (manage IconChrome trigger +
 * revenue/soldDelta footer for non-draft).
 *
 * Past events with soldCount=0 render at opacity 0.7 (Q-9-9).
 *
 * [Cycle 9c] soldCount + revenueGbp will derive from useOrderStore.
 * 9a renders 0/cap and "—" placeholders.
 *
 * Per Cycle 9 spec §3.A.2.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { LiveEvent } from "../../store/liveEventStore";
import type { DraftEvent } from "../../store/draftEventStore";
import type { Brand } from "../../store/currentBrandStore";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";
import { formatGbpRound } from "../../utils/currency";

import { EventCover } from "../ui/EventCover";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";

export type EventCardStatus = "live" | "upcoming" | "draft" | "past";

export interface EventListCardProps {
  event: LiveEvent | DraftEvent;
  kind: "live" | "draft";
  brand: Brand;
  status: EventCardStatus;
  /** Tap card body → open detail (live) or edit wizard (draft). */
  onOpen: () => void;
  /** Tap manage IconChrome → open EventManageMenu. */
  onManageOpen: () => void;
}

const isLiveEvent = (
  e: LiveEvent | DraftEvent,
  kind: "live" | "draft",
): e is LiveEvent => kind === "live";

const COVER_W = 76;
const COVER_H = 92;

export const EventListCard: React.FC<EventListCardProps> = ({
  event,
  kind,
  brand,
  status,
  onOpen,
  onManageOpen,
}) => {
  // ----- Computed display values ------------------------------------
  const title = event.name.trim().length > 0 ? event.name : "Untitled event";
  const dateLine = useMemo<string>((): string => {
    // Drafts have all the same date fields as LiveEvent (whenMode, date, etc.)
    return formatDraftDateLine(event);
  }, [event]);
  const venue = useMemo<string | null>((): string | null => {
    if (kind === "draft") {
      const draft = event as DraftEvent;
      return draft.venueName !== null && draft.venueName.length > 0
        ? draft.venueName
        : null;
    }
    const live = event as LiveEvent;
    return live.venueName !== null && live.venueName.length > 0
      ? live.venueName
      : null;
  }, [event, kind]);

  // ----- Capacity / sold (stub in 9a — populated from useOrderStore in 9c) -----
  const totalCapacity = useMemo<number>((): number => {
    let cap = 0;
    let hasUnlimited = false;
    for (const t of event.tickets) {
      if (t.isUnlimited) hasUnlimited = true;
      else cap += t.capacity ?? 0;
    }
    if (hasUnlimited && cap === 0) return 0;
    return cap;
  }, [event.tickets]);
  const soldCount = 0; // [Cycle 9c] derive from useOrderStore
  const revenueGbp = 0; // [Cycle 9c] derive from useOrderStore
  const pct =
    totalCapacity > 0
      ? Math.min(100, Math.round((soldCount / totalCapacity) * 100))
      : 0;

  // Past + 0 sold → fade per Q-9-9.
  const isFaded = status === "past" && soldCount === 0;

  // ----- Render -----------------------------------------------------
  return (
    <View style={[styles.host, isFaded && styles.hostFaded]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${title}`}
        style={({ pressed }) => [
          styles.cardBody,
          pressed && styles.cardBodyPressed,
        ]}
      >
        {/* Cover */}
        <View style={styles.coverWrap}>
          <EventCover
            hue={event.coverHue}
            radius={12}
            label=""
            height={COVER_H}
            width={COVER_W}
          />
          {kind === "draft" ? (
            <View style={styles.draftOverlay}>
              <Text style={styles.draftOverlayText}>DRAFT</Text>
            </View>
          ) : null}
        </View>

        {/* Body */}
        <View style={styles.bodyCol}>
          {/* Status pill */}
          <View style={styles.pillRow}>
            <StatusPill status={status} />
          </View>

          {/* Title */}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          {/* Date · venue */}
          <Text style={styles.dateVenue} numberOfLines={1}>
            {dateLine}
            {venue !== null ? ` · ${venue}` : ""}
          </Text>

          {/* Progress bar OR sub-text */}
          {totalCapacity > 0 ? (
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${pct}%`,
                      backgroundColor:
                        kind === "draft"
                          ? "rgba(255, 255, 255, 0.2)"
                          : accent.warm,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {soldCount}/{totalCapacity}
              </Text>
            </View>
          ) : kind === "draft" ? (
            <Text style={styles.subText}>
              {(event as DraftEvent).whenMode === "recurring"
                ? "Series template"
                : "Not published"}
            </Text>
          ) : null}
        </View>

        {/* Tap affordance — chevron-right at the inner end of the card
            body (NOT the right rail with manage IconChrome). Tells the
            user the card body is tappable and leads somewhere. */}
        <View style={styles.tapAffordance} pointerEvents="none">
          <Icon name="chevR" size={18} color={textTokens.tertiary} />
        </View>
      </Pressable>

      {/* Right rail: manage icon + revenue/delta footer */}
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

      {/* Revenue strip (non-draft only) */}
      {kind !== "draft" && status !== "past" ? (
        <View style={styles.revenueStrip} pointerEvents="none">
          <Text style={styles.revenueValue}>
            {revenueGbp > 0 ? formatGbpRound(revenueGbp) : "—"}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// ---- StatusPill — composed inline ----------------------------------
// Uses kit Pill primitive for known variants; "past" is composed inline
// (per investigation D-INV-CYCLE9-1 — no kit churn for one-off variant).

interface StatusPillProps {
  status: EventCardStatus;
}

const StatusPill: React.FC<StatusPillProps> = ({ status }) => {
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        <Text style={styles.pillText}>LIVE</Text>
      </Pill>
    );
  }
  if (status === "upcoming") {
    return (
      <Pill variant="accent">
        <Text style={styles.pillText}>UPCOMING</Text>
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
  // past — composed inline (no kit variant for "ended")
  return (
    <View style={styles.pastPill}>
      <Text style={styles.pastPillText}>ENDED</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "relative",
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "visible",
  },
  hostFaded: {
    opacity: 0.7,
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
    paddingRight: 44, // clearance for manage IconChrome on right rail
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 36, // clearance for manage IconChrome on right rail
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
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radiusTokens.full,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.secondary,
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  manageBtnPressed: {
    opacity: 0.7,
  },
  revenueStrip: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
  },
  revenueValue: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
});

export default EventListCard;
