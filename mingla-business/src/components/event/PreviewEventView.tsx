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
  radius as radiusTokens,
  color,
  space,
  type,
  scrim,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import type { DraftEvent, TicketStub } from "../../store/draftEventStore";
import { formatCurrencyRound, currencyCodeOrNull } from "../../utils/currency";
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

import { EventCoverMedia } from "../ui/EventCoverMedia";
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
    <Icon name="edit" size={14} color={color.text3} />
  </Pressable>
);

const PublicTicketRow: React.FC<{
  ticket: TicketStub;
  isLast: boolean;
  eventCurrency: string | null;
}> = ({ ticket, isLast, eventCurrency }) => {
  // #962 G13 — hide the price ("—") when neither the ticket nor the event has an
  // established currency (pre-bank brand); never manufacture GBP.
  const code = currencyCodeOrNull(ticket.currency ?? eventCurrency);
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null && code !== null
      ? formatCurrencyRound(ticket.priceGbp, code)
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
        <EventCoverMedia
          hue={draft.coverHue}
          mediaUrl={draft.coverMediaUrl}
          mediaType={draft.coverMediaType}
          radius={0}
          label=""
          height={380}
        />
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
          <Icon name="edit" size={14} color={color.textStrong} />
        </Pressable>
      </View>

      {/* Floating chrome */}
      <View
        style={[
          styles.floatingChrome,
          { top: insets.top + space[2] },
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + space[7] * 2 }]}
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
                              color={color.text3}
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
                padding={space[4]}
                style={styles.venueCard}
              >
                <View style={styles.venueRow}>
                  <Icon name="location" size={18} color={color.text1} />
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
                padding={space[4]}
                style={styles.venueCard}
              >
                <View style={styles.venueRow}>
                  <Icon name="globe" size={18} color={color.text1} />
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
            <GlassCard variant="base" padding={space[4]}>
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
                  eventCurrency={draft.currency ?? null}
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
    backgroundColor: color.canvas,
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
    backgroundColor: scrim.modal,
  },
  floatingChrome: {
    position: "absolute",
    left: space[4],
    right: space[4],
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },
  previewRibbon: {
    position: "absolute",
    left: space[4],
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
    zIndex: 3,
  },
  previewRibbonLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: color.text1,
  },
  scroll: {
    flex: 1,
    zIndex: 2,
  },
  scrollContent: {
    paddingTop: 280,
  },
  bodyContent: {
    paddingHorizontal: space[6],
    paddingTop: space[4],
    backgroundColor: color.canvas,
  },
  titleBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    marginBottom: space[2],
  },
  titleBlockText: {
    flex: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[4],
    marginBottom: space[2],
  },
  venueWrap: {
    position: "relative",
  },
  sectionEditAnchor: {
    position: "absolute",
    top: space[1],
    right: space[1],
  },
  sectionEditPencil: {
    width: 32,
    height: 32,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  coverEditAnchor: {
    position: "absolute",
    right: space[4],
    zIndex: 4,
  },
  coverEditPencil: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: scrim.modal,
    alignItems: "center",
    justifyContent: "center",
  },
  dateLine: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.text1,
    marginBottom: 8,
  },
  recurrencePillRow: {
    flexDirection: "row",
    marginTop: space[1],
    marginBottom: space[2],
  },
  recurrencePill: {
    paddingHorizontal: space[2],
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  recurrencePillLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  expandedDatesList: {
    marginBottom: space[4],
    gap: space[1],
  },
  expandedDateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  expandedDateText: {
    flex: 1,
    fontSize: type.small.fontSize,
    color: color.text1,
  },
  expandedRowEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  showAllBtn: {
    paddingVertical: space[2],
    alignItems: "center",
  },
  showAllLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  titleLine: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: color.text1,
    marginBottom: space[2],
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginBottom: space[6],
  },
  brandTile: {
    width: 28,
    height: 28,
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.step,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: {
    fontWeight: "700",
    fontSize: 13,
    color: color.textStrong,
  },
  brandName: {
    fontSize: 14,
    fontWeight: "500",
    color: color.text1,
  },
  venueCard: {
    marginBottom: space[4],
  },
  venueRow: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
  },
  venueTextCol: {
    flex: 1,
  },
  venueName: {
    fontSize: 14,
    fontWeight: "500",
    color: color.text1,
  },
  venueAddress: {
    fontSize: 12,
    color: color.text2,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: color.text1,
    marginTop: space[4],
    marginBottom: space[2],
  },
  aboutBody: {
    fontSize: 15,
    color: color.text2,
    lineHeight: 24,
  },
  ticketsCol: {
    backgroundColor: color.fill.inset,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: color.line,
    overflow: "hidden",
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    gap: space[2],
  },
  ticketRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  ticketRowDisabled: {
    opacity: 0.5,
  },
  ticketTextCol: {
    flex: 1,
  },
  ticketName: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  ticketSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  ticketBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginTop: space[1],
  },
  ticketBuyerBtn: {
    marginTop: space[2],
    paddingHorizontal: space[2],
    paddingVertical: 6,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignSelf: "flex-start",
  },
  ticketBuyerBtnDisabled: {
    backgroundColor: color.fill.inset,
    borderColor: color.line,
  },
  ticketBuyerBtnLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  ticketBuyerBtnLabelDisabled: {
    color: color.text3,
  },
  ticketPrice: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  footerNote: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    textAlign: "center",
    marginTop: space[6],
    fontStyle: "italic",
  },
});

