import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EventTicketBox,
  boldFontFamily,
  computeOfferingVariant,
  createThemePalette,
  resolveOfferingCta,
  resolveTheme,
  useResponsiveLayout,
  type PublicBrandProps,
  type PublicEventProps,
} from "@mingla/offering-rendering";

import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import type { MultiDatePricingMode } from "../../services/publicEventsService";
import { useThemeFont } from "../../theme/useThemeFont";
import { scheduleDayChooserFocusAfterNotice } from "../../utils/publicEventDayRecovery";
import { FoundationEventPreview } from "./FoundationEventPreview";
import { MultiDateDayChooser } from "./MultiDateDayChooser";

interface DraftEventFoundationPreviewProps {
  event: PublicEventProps;
  brand: PublicBrandProps | null;
  occurrences: readonly PublicEventOccurrence[];
  isMultiDate: boolean;
  multiDatePricingMode: MultiDatePricingMode;
  onClose: () => void;
  onShare: () => void;
  onCheckout: () => void;
  onBlocked: (message: string) => void;
}

export const DraftEventFoundationPreview: React.FC<
  DraftEventFoundationPreviewProps
> = ({
  event,
  brand,
  occurrences,
  isMultiDate,
  multiDatePricingMode,
  onClose,
  onShare,
  onCheckout,
  onBlocked,
}) => {
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  const resolvedTheme = useMemo(
    () => resolveTheme(brand?.theme ?? null, event.themeOverrides ?? null),
    [brand?.theme, event.themeOverrides],
  );
  const palette = useMemo(() => createThemePalette(resolvedTheme), [resolvedTheme]);
  const boldFamily = boldFontFamily(resolvedTheme);
  useThemeFont(resolvedTheme.fontFamilyValue);
  useThemeFont(boldFamily);

  const [muted, setMuted] = useState(true);
  const [ticketQuantities, setTicketQuantities] = useState<Record<string, number>>({});
  const [selectedOccurrenceIds, setSelectedOccurrenceIds] = useState<readonly string[]>([]);
  const [dayChoiceMissing, setDayChoiceMissing] = useState(false);

  const variant = useMemo(() => computeOfferingVariant(event, true), [event]);
  const offeringCta = useMemo(
    () => resolveOfferingCta({
      variant,
      bookable: true,
      tickets: event.tickets.filter((ticket) => ticket.visibility !== "hidden"),
      currency: event.currency,
    }),
    [event.currency, event.tickets, variant],
  );
  const isPurchaseEntryKind = offeringCta.kind === "buy" || offeringCta.kind === "free";
  const requiresMultiDatePurchase = isMultiDate && isPurchaseEntryKind;
  const dayChooserState = occurrences.length > 1 ? "ready" as const : "error" as const;
  const purchaseReady =
    !requiresMultiDatePurchase ||
    (dayChooserState === "ready" && selectedOccurrenceIds.length > 0);
  const priceMultiplier =
    requiresMultiDatePurchase && multiDatePricingMode === "per_day"
      ? selectedOccurrenceIds.length
      : 1;

  const handleChangeTicketQuantity = useCallback((ticketId: string, qty: number): void => {
    setTicketQuantities((previous) => {
      const next = { ...previous };
      if (qty <= 0) delete next[ticketId];
      else next[ticketId] = qty;
      return next;
    });
  }, []);

  const handleToggleOccurrence = useCallback((occurrenceId: string): void => {
    setSelectedOccurrenceIds((previous) =>
      previous.includes(occurrenceId)
        ? previous.filter((id) => id !== occurrenceId)
        : [...previous, occurrenceId],
    );
    setDayChoiceMissing(false);
  }, []);

  const revealDayChooser = useCallback((): void => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const first = occurrences[0];
    const target = document.getElementById(
      first === undefined
        ? "issue-2399-day-section"
        : `issue-2160-day-row-${first.id}`,
    );
    target?.scrollIntoView({ behavior: "auto", block: "center" });
    target?.focus({ preventScroll: true });
  }, [occurrences]);

  const handleProceed = useCallback((): void => {
    if (!purchaseReady) {
      setDayChoiceMissing(dayChooserState === "ready");
      onBlocked(
        dayChooserState === "ready"
          ? "Choose at least one day you're attending."
          : "We couldn’t load the event days.",
      );
      if (Platform.OS === "web") {
        scheduleDayChooserFocusAfterNotice(revealDayChooser);
      } else {
        revealDayChooser();
      }
      return;
    }
    onCheckout();
  }, [dayChooserState, onBlocked, onCheckout, purchaseReady, revealDayChooser]);

  const dayChooser = requiresMultiDatePurchase ? (
    <MultiDateDayChooser
      timezone={occurrences[0]?.timezone ?? "UTC"}
      palette={palette}
      fontFamily={boldFamily}
      occurrences={occurrences}
      selectedOccurrenceIds={selectedOccurrenceIds}
      pricingMode={multiDatePricingMode}
      isPaid={event.tickets.some((ticket) => !ticket.isFree)}
      highlightUnchosen={dayChoiceMissing}
      state={dayChooserState}
      onToggle={handleToggleOccurrence}
    />
  ) : null;

  const stickyPanel = isDesktop ? (
    <View
      style={[
        styles.desktopPanel,
        { backgroundColor: palette.card, borderColor: palette.panelBorder },
      ]}
    >
      <EventTicketBox
        event={event}
        bookable
        palette={palette}
        theme={resolvedTheme}
        variant={variant}
        ticketQuantities={ticketQuantities}
        onChangeTicketQuantity={handleChangeTicketQuantity}
        onProceedToCart={handleProceed}
        showHeading
        leadingPurchaseSection={dayChooser}
        priceMultiplier={priceMultiplier}
        purchaseReady={purchaseReady}
        purchaseBlockedLabel="Pick at least one day above"
        testID="issue-2399-draft-preview-ticket-box"
      />
    </View>
  ) : null;

  return (
    <FoundationEventPreview
      event={event}
      brand={brand}
      variant={variant}
      bookable
      palette={palette}
      theme={resolvedTheme}
      muted={muted}
      onToggleMute={() => setMuted((previous) => !previous)}
      onClose={onClose}
      onShare={onShare}
      stickyPanel={stickyPanel}
      safeAreaTop={insets.top}
      contentBottomInset={insets.bottom + 24}
      hideTicketBox={isDesktop}
      leadingPurchaseSection={dayChooser}
      priceMultiplier={priceMultiplier}
      purchaseReady={purchaseReady}
      purchaseBlockedLabel="Pick at least one day above"
      ticketQuantities={ticketQuantities}
      onChangeTicketQuantity={handleChangeTicketQuantity}
      onProceedToCart={handleProceed}
      testID="issue-2399-draft-foundation-preview"
    />
  );
};

const styles = StyleSheet.create({
  desktopPanel: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    padding: 20,
  },
});

export default DraftEventFoundationPreview;
