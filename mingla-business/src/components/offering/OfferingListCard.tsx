/**
 * OfferingListCard — META-ORCH-1059 Pass 1 shared Hub list-card.
 *
 * The single, kind-configurable list-card used by events, trips, AND
 * experiences on the Hub. Generalized from the polished EventListCard (the
 * best-of-breed version): 76×92 cover thumb (+ DRAFT overlay), status pill,
 * title, date·venue subline, the per-kind headcount metric (attendees /
 * travelers / spots sold), a money/revenue strip, a 3-dot manage trigger, and a
 * chevron tap-affordance.
 *
 * Callers pass a normalized OfferingListCardModel (their kind's data, mapped to
 * this shape) plus the OfferingKind. NO kind-specific strings live here — the
 * metric noun comes from offeringKind config via the pre-formatted
 * `metricLabel`. This guarantees events / trips / experiences render with
 * identical structure.
 *
 * Status semantics:
 *   live → LIVE pill (pulsing) · upcoming → UPCOMING pill · draft → DRAFT pill +
 *   cover overlay · past → ENDED pill (faded when zero metric) · cancelled →
 *   CANCELLED pill (faded).
 */

import React from "react";
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
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import { DraftSelectCheckbox } from "./DraftSelectCheckbox";
import { DraftSelectOverlay, useDraftHoldRing } from "./DraftSelectOverlay";
import type { OfferingKind } from "./offeringKind";
import type {
  OfferingCardStatus,
  OfferingListCardModel,
} from "./offeringListCardModel";

export type {
  OfferingCardStatus,
  OfferingListCardModel,
} from "./offeringListCardModel";

export interface OfferingListCardProps {
  kind: OfferingKind;
  model: OfferingListCardModel;
  /** Tap card body → open dashboard (live) or edit (draft) per caller policy. */
  onOpen: () => void;
  /** Tap 3-dot → open the shared manage sheet. Omit to hide the trigger. */
  onManageOpen?: () => void;
  /** Optional testID for QA / Maestro. */
  testID?: string;
  // ORCH-1123 [Hub multi-select draft delete] — additive selection props.
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  selectable?: boolean;
}

const COVER_W = 76;
const COVER_H = 92;

function untitledFor(kind: OfferingKind): string {
  return kind === "trip"
    ? "Untitled trip"
    : kind === "experience"
      ? "Untitled experience"
      : "Untitled event";
}

export const OfferingListCard: React.FC<OfferingListCardProps> = ({
  kind,
  model,
  onOpen,
  onManageOpen,
  testID,
  selectionMode = false,
  selected = false,
  onLongPress,
  selectable = true,
}) => {
  const title = model.title.trim().length > 0 ? model.title : untitledFor(kind);
  const isDraft = model.status === "draft";

  // ORCH-1123 — selection affordances.
  const holdRing = useDraftHoldRing(selectable);
  const dimmedInert = selectionMode && !selectable;
  const showCheckbox = selectionMode && selectable;
  const isCheckboxRow = selectionMode && selectable;

  // Faded: a past offering with no headcount, or a cancelled one (mirrors the
  // events Q-9-9 fade rule generalized across kinds).
  const isFaded =
    model.status === "cancelled" ||
    (model.status === "past" &&
      (model.metricLabel === null || /\b0\b/.test(model.metricLabel)));

  const accessibilityLabel =
    model.revenueLabel !== null
      ? `Open ${title}. ${model.metricLabel ?? ""} ${model.revenueLabel}.`
      : `Open ${title}`;

  return (
    <Animated.View
      style={[
        styles.host,
        isFaded && styles.hostFaded,
        selected && styles.hostSelected,
        dimmedInert && styles.hostDimmedInert,
        { transform: [{ translateX: holdRing.shakeX }] },
      ]}
      testID={testID}
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
        accessibilityLabel={accessibilityLabel}
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
        {/* Cover */}
        <View style={styles.coverWrap}>
          <EventCoverMedia
            hue={model.coverHue}
            mediaUrl={model.coverMediaUrl}
            mediaType={model.coverMediaType}
            radius={12}
            label=""
            height={COVER_H}
            width={COVER_W}
          />
          {isDraft ? (
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

        {/* Body */}
        <View style={styles.bodyCol}>
          <View style={styles.pillRow}>
            <OfferingStatusPill status={model.status} />
          </View>

          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          <Text style={styles.dateVenue} numberOfLines={1}>
            {model.subline}
          </Text>

          {isDraft ? (
            <Text style={styles.subText}>Not published</Text>
          ) : model.capacityPct !== null ? (
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, Math.max(0, model.capacityPct))}%`,
                      backgroundColor: accent.warm,
                    },
                  ]}
                />
              </View>
              {model.metricLabel !== null ? (
                <Text style={styles.progressLabel}>{model.metricLabel}</Text>
              ) : null}
            </View>
          ) : model.metricLabel !== null ? (
            <Text style={styles.subText}>{model.metricLabel}</Text>
          ) : null}
        </View>

        {/* Tap affordance */}
        <View style={styles.tapAffordance} pointerEvents="none">
          <Icon name="chevR" size={18} color={textTokens.tertiary} />
        </View>
      </Pressable>

      {/* Right rail: 3-dot manage trigger.
          ORCH-1123 — hidden while in selection mode. */}
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

      {/* Revenue strip (non-draft, when a money label is present) */}
      {!isDraft && model.revenueLabel !== null ? (
        <View style={styles.revenueStrip} pointerEvents="none">
          <Text style={styles.revenueValue}>{model.revenueLabel}</Text>
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

interface OfferingStatusPillProps {
  status: OfferingCardStatus;
}

const OfferingStatusPill: React.FC<OfferingStatusPillProps> = ({ status }) => {
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
  if (status === "cancelled") {
    return (
      <View style={styles.pastPill}>
        <Text style={styles.pastPillText}>CANCELLED</Text>
      </View>
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
    // META-ORCH-1002 Sub-1 (S6): opaque frosted fill on Android (translucent
    // fills leak the corner ring); kit-consistent rgba(20,22,26,0.92). iOS keeps
    // the translucent profileBase. All children stay inside host bounds.
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
    paddingRight: 44, // clearance for manage trigger on right rail
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 36, // clearance for manage trigger on right rail
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

export default OfferingListCard;
