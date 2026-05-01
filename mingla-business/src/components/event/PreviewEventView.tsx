/**
 * PreviewEventView — in-app preview of a draft event.
 *
 * MID-fidelity port of designer screens-extra.jsx PublicEventScreen
 * (lines 7-262). Cycle 3 ships hero + title + brand chip + venue card +
 * about + tickets list + PREVIEW ribbon + back. Skips: organiser block,
 * share modal (Cycle 7), full address-after-checkout flow (Cycle 6).
 *
 * The full mingla-web public event page lands Cycle 6 (TRANS-CYCLE-3-8).
 *
 * Per Cycle 3 spec §3.10.
 */

import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { formatGbpRound } from "../../utils/currency";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
  formatDraftDatesList,
} from "../../utils/eventDateDisplay";
import {
  formatTicketBadges,
  formatTicketButtonLabel,
  formatTicketSubline,
  sortTicketsByDisplayOrder,
} from "../../utils/ticketDisplay";

import { EventCover } from "../ui/EventCover";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Pill } from "../ui/Pill";

interface PreviewEventViewProps {
  draft: DraftEvent;
  brand: Brand | null;
  onBack: () => void;
  onShareTap: () => void;
  /**
   * Tap-to-jump from a preview section to the wizard step that owns
   * that field. Cycle 3 ships this thinner version of inline editing;
   * full inline-edit-in-preview defers to Cycle 9 J-E11.
   */
  onEditStep: (step: number) => void;
  /**
   * Tap-to-edit a per-date override from the multi-date accordion.
   * Cycle 4 Q-5 user-revised — opens MultiDateOverrideSheet directly
   * (route handler owns sheet state for I-13 portal compliance).
   * Only relevant for whenMode === "multi_date"; recurring rows are
   * read-only (no per-occurrence overrides supported).
   */
  onEditMultiDateOverride?: (entryId: string) => void;
}

const SectionEditPencil: React.FC<{
  onPress: () => void;
  label: string;
}> = ({ onPress, label }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Edit ${label}`}
    hitSlop={8}
    style={styles.sectionEditPencil}
  >
    <Icon name="edit" size={14} color={textTokens.tertiary} />
  </Pressable>
);

const PublicTicketRow: React.FC<{ ticket: TicketStub; isLast: boolean }> = ({
  ticket,
  isLast,
}) => {
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? formatGbpRound(ticket.priceGbp)
      : "—";
  const subLine = formatTicketSubline(ticket);
  const badges = formatTicketBadges(ticket);
  const buttonLabel = formatTicketButtonLabel(ticket);
  const isDisabled = ticket.visibility === "disabled";
  const capacityLine = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? `${ticket.capacity} available`
      : "Available";

  return (
    <View
      style={[
        styles.ticketRow,
        !isLast && styles.ticketRowDivider,
        isDisabled && styles.ticketRowDisabled,
      ]}
    >
      <View style={styles.ticketTextCol}>
        <Text style={styles.ticketName}>{ticket.name}</Text>
        {/* Sub-line uses ticketDisplay helper (modifiers) — fall back
            to capacity-only when no modifiers stack. */}
        <Text style={styles.ticketSub}>
          {subLine.length > 0 && subLine !== priceLabel
            ? subLine
            : capacityLine}
        </Text>
        {badges.length > 0 ? (
          <View style={styles.ticketBadgesRow}>
            {badges.map((b) => (
              <Pill
                key={b.label}
                variant={
                  b.variant === "warning"
                    ? "warn"
                    : b.variant === "muted"
                      ? "draft"
                      : b.variant === "accent"
                        ? "accent"
                        : "info"
                }
              >
                {b.label}
              </Pill>
            ))}
          </View>
        ) : null}
        {/* Buyer button — Cycle 5 ships UI label only; real buyer flow
            (Stripe checkout, password gate, approval submit) lands
            Cycles 8/B3 + Cycle 10/B4 + B5. */}
        <View
          style={[
            styles.ticketBuyerBtn,
            isDisabled && styles.ticketBuyerBtnDisabled,
          ]}
        >
          <Text
            style={[
              styles.ticketBuyerBtnLabel,
              isDisabled && styles.ticketBuyerBtnLabelDisabled,
            ]}
          >
            {buttonLabel}
          </Text>
        </View>
      </View>
      <Text style={styles.ticketPrice}>{priceLabel}</Text>
    </View>
  );
};

const SHOW_INITIAL_DATES = 10;

export const PreviewEventView: React.FC<PreviewEventViewProps> = ({
  draft,
  brand,
  onBack,
  onShareTap,
  onEditStep,
  onEditMultiDateOverride,
}) => {
  const insets = useSafeAreaInsets();
  const dateLine = formatDraftDateLine(draft);
  const subline = formatDraftDateSubline(draft);
  const datesList = formatDraftDatesList(draft);
  const titleLine = draft.name.length > 0 ? draft.name : "Untitled event";
  const brandLetter = (brand?.displayName?.charAt(0) ?? "?").toUpperCase();
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [showOverflowDates, setShowOverflowDates] = useState<boolean>(false);

  const isMultiDate = draft.whenMode === "multi_date";
  const visibleDatesList: string[] = (() => {
    if (!showAllDates) return [];
    if (datesList.length <= SHOW_INITIAL_DATES || showOverflowDates) {
      return datesList;
    }
    return datesList.slice(0, SHOW_INITIAL_DATES);
  })();

  return (
    <View style={styles.host}>
      {/* Hero cover — taps route to Step 4 (Cover) */}
      <View style={styles.heroWrap}>
        <EventCover hue={draft.coverHue} radius={0} label="" height={380} />
        <View style={styles.heroOverlay} pointerEvents="none" />
      </View>
      <View
        style={[styles.coverEditAnchor, { top: insets.top + 56 + 36 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={() => onEditStep(3)}
          accessibilityRole="button"
          accessibilityLabel="Edit cover"
          hitSlop={8}
          style={styles.coverEditPencil}
        >
          <Icon name="edit" size={14} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Floating chrome */}
      <View
        style={[
          styles.floatingChrome,
          { top: insets.top + spacing.sm },
        ]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="chevL"
          size={40}
          onPress={onBack}
          accessibilityLabel="Back"
        />
        <IconChrome
          icon="share"
          size={40}
          onPress={onShareTap}
          accessibilityLabel="Share"
        />
      </View>

      {/* PREVIEW ribbon */}
      <View
        style={[styles.previewRibbon, { top: insets.top + 56 }]}
        pointerEvents="none"
      >
        <Text style={styles.previewRibbonLabel}>
          PREVIEW · NOT YET PUBLISHED
        </Text>
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl * 2 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bodyContent}>
          {/* Title block — taps route to Step 1 (Basics) */}
          <View style={styles.titleBlock}>
            <View style={styles.titleBlockText}>
              <Text style={styles.dateLine}>{dateLine}</Text>
              <Text style={styles.titleLine}>{titleLine}</Text>
              {/* Recurring / multi-date pill + accordion expand */}
              {subline !== null ? (
                <View style={styles.recurrencePillRow}>
                  <Pressable
                    onPress={() => setShowAllDates((s) => !s)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showAllDates ? "Collapse date list" : "Show all dates"
                    }
                    style={styles.recurrencePill}
                  >
                    <Text style={styles.recurrencePillLabel}>
                      {subline} · {showAllDates ? "Hide" : "Show all"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {showAllDates && visibleDatesList.length > 0 ? (
                <View style={styles.expandedDatesList}>
                  {visibleDatesList.map((label, i) => {
                    const entry =
                      isMultiDate && draft.multiDates !== null
                        ? draft.multiDates[i]
                        : null;
                    return (
                      <View key={i} style={styles.expandedDateRow}>
                        <Text style={styles.expandedDateText}>{label}</Text>
                        {isMultiDate &&
                        entry !== null &&
                        onEditMultiDateOverride !== undefined ? (
                          <Pressable
                            onPress={() => onEditMultiDateOverride(entry.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit date ${i + 1}`}
                            hitSlop={8}
                            style={styles.expandedRowEditBtn}
                          >
                            <Icon
                              name="edit"
                              size={14}
                              color={textTokens.tertiary}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                  {datesList.length > SHOW_INITIAL_DATES &&
                  !showOverflowDates ? (
                    <Pressable
                      onPress={() => setShowOverflowDates(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`Show all ${datesList.length} dates`}
                      style={styles.showAllBtn}
                    >
                      <Text style={styles.showAllLabel}>
                        Show all {datesList.length} dates
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            <SectionEditPencil onPress={() => onEditStep(0)} label="title" />
          </View>

          {/* Brand chip — not editable; brand is wizard context */}
          <View style={styles.brandRow}>
            <View style={styles.brandTile}>
              <Text style={styles.brandLetter}>{brandLetter}</Text>
            </View>
            <Text style={styles.brandName}>{brand?.displayName ?? "Brand"}</Text>
          </View>

          {/* Venue card — taps route to Step 3 (Where).
              Address visibility honors draft.hideAddressUntilTicket. */}
          {draft.format !== "online" && draft.venueName !== null ? (
            <View style={styles.venueWrap}>
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={styles.venueCard}
              >
                <View style={styles.venueRow}>
                  <Icon name="location" size={18} color={accent.warm} />
                  <View style={styles.venueTextCol}>
                    <Text style={styles.venueName}>{draft.venueName}</Text>
                    <Text style={styles.venueAddress}>
                      {draft.hideAddressUntilTicket
                        ? "Address shown after checkout"
                        : draft.format === "hybrid" && draft.address !== null
                          ? `${draft.address} · also online`
                          : (draft.address ?? "Address shown after checkout")}
                    </Text>
                  </View>
                </View>
              </GlassCard>
              <View style={styles.sectionEditAnchor}>
                <SectionEditPencil
                  onPress={() => onEditStep(2)}
                  label="venue"
                />
              </View>
            </View>
          ) : draft.format === "online" ? (
            <View style={styles.venueWrap}>
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={styles.venueCard}
              >
                <View style={styles.venueRow}>
                  <Icon name="globe" size={18} color={accent.warm} />
                  <View style={styles.venueTextCol}>
                    <Text style={styles.venueName}>Online</Text>
                    <Text style={styles.venueAddress}>
                      Conferencing link shared with ticketed guests.
                    </Text>
                  </View>
                </View>
              </GlassCard>
              <View style={styles.sectionEditAnchor}>
                <SectionEditPencil
                  onPress={() => onEditStep(2)}
                  label="venue"
                />
              </View>
            </View>
          ) : null}

          {/* About — taps route to Step 1 (Basics, where Description lives) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>About</Text>
            <SectionEditPencil
              onPress={() => onEditStep(0)}
              label="description"
            />
          </View>
          <Text style={styles.aboutBody}>
            {draft.description.length > 0
              ? draft.description
              : "No description yet — add one in Step 1."}
          </Text>

          {/* Tickets — taps route to Step 5 (Tickets) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Tickets</Text>
            <SectionEditPencil
              onPress={() => onEditStep(4)}
              label="tickets"
            />
          </View>
          {draft.tickets.length === 0 ? (
            <GlassCard variant="base" padding={spacing.md}>
              <Text style={styles.aboutBody}>
                Add tickets in Step 5 to see them here.
              </Text>
            </GlassCard>
          ) : (
            <View style={styles.ticketsCol}>
              {/* Cycle 5 — render in displayOrder. The real public page
                  (Cycle 6) will skip visibility="hidden" tickets entirely;
                  this preview renders them WITH a badge so organisers can
                  see what they configured. */}
              {sortTicketsByDisplayOrder(draft.tickets).map((t, i, arr) => (
                <PublicTicketRow
                  key={t.id}
                  ticket={t}
                  isLast={i === arr.length - 1}
                />
              ))}
            </View>
          )}

          {/* Footer note */}
          <Text style={styles.footerNote}>
            PREVIEW · Full public page lands Cycle 6.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  heroWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 380,
    zIndex: 0,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  floatingChrome: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  previewRibbon: {
    position: "absolute",
    left: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    zIndex: 3,
  },
  previewRibbonLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
  },
  scroll: {
    flex: 1,
    zIndex: 2,
  },
  scrollContent: {
    paddingTop: 280,
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: "#0c0e12",
  },
  titleBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleBlockText: {
    flex: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  venueWrap: {
    position: "relative",
  },
  sectionEditAnchor: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
  },
  sectionEditPencil: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  coverEditAnchor: {
    position: "absolute",
    right: spacing.md,
    zIndex: 4,
  },
  coverEditPencil: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  dateLine: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 8,
  },
  recurrencePillRow: {
    flexDirection: "row",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  recurrencePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  recurrencePillLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  expandedDatesList: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  expandedDateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  expandedDateText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  expandedRowEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  showAllBtn: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  showAllLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  titleLine: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: {
    fontWeight: "700",
    fontSize: 13,
    color: "#fff",
  },
  brandName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  venueCard: {
    marginBottom: spacing.md,
  },
  venueRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  venueTextCol: {
    flex: 1,
  },
  venueName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  venueAddress: {
    fontSize: 12,
    color: textTokens.secondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  aboutBody: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 24,
  },
  ticketsCol: {
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "hidden",
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  ticketRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  ticketRowDisabled: {
    opacity: 0.5,
  },
  ticketTextCol: {
    flex: 1,
  },
  ticketName: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  ticketSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  ticketBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  ticketBuyerBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignSelf: "flex-start",
  },
  ticketBuyerBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  ticketBuyerBtnLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  ticketBuyerBtnLabelDisabled: {
    color: textTokens.tertiary,
  },
  ticketPrice: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  footerNote: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.lg,
    fontStyle: "italic",
  },
});

void semantic;
