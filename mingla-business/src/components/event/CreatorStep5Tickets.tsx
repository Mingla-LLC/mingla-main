/**
 * Wizard Step 5 — Tickets.
 *
 * Cycle 3 baseline: inline ticket creation + edit (name + Free toggle +
 * Unlimited toggle + price + capacity).
 *
 * Cycle 5 expansion:
 *   - 6 new modifier toggles/inputs in the sheet
 *   - Up/down arrow reorder column on each TicketCard (Q-3 web-safe pick)
 *   - Pure modifier toggles, NO segmented type picker (Q-1)
 *   - All ticket display flows through `ticketDisplay.ts` helpers
 *
 * Cycle 17d Stage 2 (§F.3) — sub-components extracted:
 *   - `TicketTierCard` → `./TicketTierCard.tsx` (memoized per-tier row)
 *   - `TicketTierEditSheet` → `./TicketTierEditSheet.tsx` (add/edit sheet
 *     + Visibility/Available-at picker sub-sheets + ToggleRow)
 *
 * Free events bypass the publish-gate Stripe requirement (Cycle 3).
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTurnoutFocusTarget } from "../intel/useTurnoutFocusTarget";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import type { NewTicketPreset } from "../../utils/ticketLinkEligibility";
import { generateTicketId } from "../../utils/draftEventId";
import { formatCurrencyRound } from "../../utils/currency";
import { effectiveDraftCurrency } from "../../utils/moneySummary";
import {
  moveTicketDown,
  moveTicketUp,
  nextDisplayOrder,
  sortTicketsByDisplayOrder,
} from "../../utils/ticketDisplay";

import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TurnoutForecastCard } from "../intel/TurnoutForecastCard";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { WhoCoversCostsSection } from "../pricing/LazyWhoCoversCostsSection";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";

import { TicketTierCard } from "./TicketTierCard";
import {
  coverageCaution,
  eventHasDayScope,
  formatDraftDayScopeLabel,
  isDayLimited,
} from "../../utils/ticketDayScope";
// META-ORCH-1255(R2) [web bundle budget] — the ~25 KB TicketTierEditSheet is a
// tap-to-open sheet (renders NOTHING until `visible`), and this step body is
// shared by the compose + edit route chunks, so a STATIC import hoisted the
// sheet into the EAGER `__common` boot chunk (ORCH-1083 budget breach).
// React.lazy + Suspense defers it to its own on-demand chunk — the ORCH-1083
// house pattern (Stripe Connect bodies / QR renderer). fallback={null} is
// behavior-identical: the sheet itself renders null while closed.
const TicketTierEditSheet = React.lazy(() =>
  import("./TicketTierEditSheet").then((m) => ({
    default: m.TicketTierEditSheet,
  })),
);
import { errorForKey, type StepBodyProps } from "./types";
import { isPerNightCapacity } from "../../utils/perNightCapacity";
import { PayoutCountryInlinePrompt } from "../brand/PayoutCountryInlinePrompt";
import { usesConfiguredVat } from "../../utils/pricingTaxContext";

// ---- Main component (Step 5 body) -----------------------------------

export const CreatorStep5Tickets: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  editMode,
  eventStartsAtIso = null,
  eventEndsAtIso = null,
  canEditTicketPrice = true,
  coverMediaEventId,
  brandDefaultCurrency,
  openNewTicketPreset = null,
}) => {
  const intelPriceHighlight = useTurnoutFocusTarget("price");
  const intelCapacityHighlight = useTurnoutFocusTarget("capacity");
  // ORCH-0704 v2 — sold-count map. Empty in create-flow + ORCH-0704 stub mode.
  const soldCountByTier = editMode?.soldCountByTier ?? {};
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // issue #3827 — preset for a NEW ticket opened from the private-link sheet.
  const [newTicketPreset, setNewTicketPreset] = useState<NewTicketPreset | null>(null);
  const openedPresetRef = useRef<NewTicketPreset | null>(null);
  useEffect(() => {
    // Open once per arrival; closing the sheet must not reopen it.
    if (openNewTicketPreset === null || openedPresetRef.current === openNewTicketPreset) return;
    openedPresetRef.current = openNewTicketPreset;
    setEditingTicketId(null);
    setNewTicketPreset(openNewTicketPreset);
    setSheetVisible(true);
  }, [openNewTicketPreset]);

  const emptyError = showErrors
    ? errorForKey(errors, "tickets.empty")
    : undefined;

  const editingTicket: TicketStub | null =
    editingTicketId === null
      ? null
      : (draft.tickets.find((t) => t.id === editingTicketId) ?? null);

  // Sorted tickets — single source of truth for render order.
  const sortedTickets = sortTicketsByDisplayOrder(draft.tickets);
  const displayCurrency = effectiveDraftCurrency(
    draft.currency,
    brandDefaultCurrency,
  );
  const hasDisplayCurrency = displayCurrency.length > 0;

  const handleAddTicket = useCallback((): void => {
    setEditingTicketId(null);
    setNewTicketPreset(null);
    setSheetVisible(true);
  }, []);

  const handleEditTicket = useCallback((ticketId: string): void => {
    setEditingTicketId(ticketId);
    setSheetVisible(true);
  }, []);

  const handleDuplicateTicket = useCallback(
    (ticketId: string): void => {
      const original = draft.tickets.find((t) => t.id === ticketId);
      if (original === undefined) return;
      // displayOrder is OWNED by ticketDisplay.ts helpers — use nextDisplayOrder.
      const copy: TicketStub = {
        ...original,
        id: generateTicketId(),
        name:
          original.name.length > 0
            ? `${original.name} (copy)`
            : "Untitled (copy)",
        displayOrder: nextDisplayOrder(draft.tickets),
      };
      updateDraft({ tickets: [...draft.tickets, copy] });
    },
    [draft.tickets, updateDraft],
  );

  const handleRequestDelete = useCallback((ticketId: string): void => {
    setPendingDeleteId(ticketId);
  }, []);

  const handleConfirmDelete = useCallback((): void => {
    if (pendingDeleteId === null) return;
    // After delete, renormalize is handled implicitly — sortTicketsByDisplayOrder
    // tolerates gaps, but renormalize keeps storage tidy on next save.
    updateDraft({
      tickets: draft.tickets.filter((t) => t.id !== pendingDeleteId),
    });
    setPendingDeleteId(null);
  }, [pendingDeleteId, draft.tickets, updateDraft]);

  const handleCancelDelete = useCallback((): void => {
    setPendingDeleteId(null);
  }, []);

  const pendingDeleteTicket =
    pendingDeleteId === null
      ? null
      : (draft.tickets.find((t) => t.id === pendingDeleteId) ?? null);

  const handleSaveTicket = useCallback(
    (ticket: TicketStub): void => {
      if (editingTicketId !== null) {
        const next = draft.tickets.map((t) =>
          t.id === editingTicketId ? ticket : t,
        );
        updateDraft({ tickets: next });
      } else {
        updateDraft({ tickets: [...draft.tickets, ticket] });
      }
      setSheetVisible(false);
      setEditingTicketId(null);
      setNewTicketPreset(null);
    },
    [draft.tickets, editingTicketId, updateDraft],
  );

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
    setEditingTicketId(null);
    setNewTicketPreset(null);
  }, []);

  // displayOrder is OWNED by ticketDisplay.ts helpers — never set inline.
  const handleMoveUp = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketUp(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  const handleMoveDown = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketDown(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  // Summary computations — handle unlimited + free-only correctly.
  const hasUnlimitedCapacity = draft.tickets.some((t) => t.isUnlimited);
  const hasUnlimitedPaidTicket = draft.tickets.some(
    (t) => t.isUnlimited && !t.isFree,
  );
  const allTicketsFree = draft.tickets.every((t) => t.isFree);

  // issue #3281 — a listed ticket's capacity is per date, so it can't be summed
  // with a shared pool, and its revenue ceiling counts each of its dates.
  const dayEntries = eventHasDayScope(draft.whenMode, draft.multiDates)
    ? (draft.multiDates ?? [])
    : null;
  const anyDayLimited =
    dayEntries !== null && draft.tickets.some((t) => isDayLimited(t));
  const dayCaution =
    dayEntries !== null ? coverageCaution(draft.tickets, dayEntries) : null;
  const totalAvailable = anyDayLimited
    ? "Varies by day"
    : hasUnlimitedCapacity
    ? "Unlimited"
    : (() => {
        const sum = draft.tickets.reduce(
          (acc, t) => acc + (t.capacity ?? 0),
          0,
        );
        return sum.toString();
      })();

  const maxRevenue = allTicketsFree
    ? "Free event"
    : hasUnlimitedPaidTicket
      ? "Unlimited"
      : !hasDisplayCurrency
        ? "Currency not set"
        : formatCurrencyRound(
            draft.tickets.reduce(
              (sum, t) =>
                sum +
                (t.isFree ? 0 : (t.priceGbp ?? 0) * (t.capacity ?? 0)) *
                  (dayEntries !== null ? (t.validDayIds?.length ?? 1) : 1),
              0,
            ),
            displayCurrency,
          );

  // Find the next available displayOrder for the new-ticket sheet.
  const nextOrder = nextDisplayOrder(draft.tickets);

  // ORCH-1006 — "Who covers the costs?" section state.
  const brand = useCurrentBrand();
  const router = useRouter();
  // #3645 — the payout country prompt also appears INSIDE the add/edit ticket
  // sheet, as soon as a price above zero is typed on a brand with no currency.
  // (It used to appear only on this step, after the ticket had been saved.)
  const renderTicketSheetPayoutCountryPrompt = useCallback(
    (priced: boolean): React.ReactNode => (
      <PayoutCountryInlinePrompt
        brand={brand}
        priced={priced}
        testID="ticket-sheet-payout-country-prompt"
      />
    ),
    [brand],
  );
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);
  const pricingSwitches = draft.pricingSwitches ?? {
    passTax: null,
    passMinglaFee: null,
    passServiceFee: null,
  };
  // Representative single-ticket base for the live preview = the lowest paid
  // tier (mirrors the buyer's "From £X"). Major-units → cents.
  const lowestPaidMajor = draft.tickets.reduce<number | null>((min, t) => {
    if (t.isFree || typeof t.priceGbp !== "number" || t.priceGbp <= 0)
      return min;
    return min === null ? t.priceGbp : Math.min(min, t.priceGbp);
  }, null);
  const previewBaseCents =
    lowestPaidMajor === null ? 0 : Math.round(lowestPaidMajor * 100);
  // Post-sale lock (Surface 3): the server stamps pricing_locked_at on the
  // first order; any sold tier is the UI proxy.
  // issue #3281 — a listed ticket's floor is its busiest date.
  const editingDaySold =
    editingTicket !== null && isDayLimited(editingTicket)
      ? editMode?.soldCountByTierDay?.[editingTicket.id]
      : undefined;
  const editingDayFloor =
    editingDaySold !== undefined
      ? Math.max(0, ...Object.values(editingDaySold))
      : undefined;
  const pricingLocked = Object.values(soldCountByTier).some(
    (n) => (n ?? 0) > 0,
  );
  // #962 G12 — never fabricate GBP for the fee/tax preview; pass null when the
  // brand has no established currency so WhoCoversCostsSection shows plain numbers.
  const switchesCurrency = hasDisplayCurrency ? displayCurrency : null;

  const handleSwitchesChange = useCallback(
    (next: typeof pricingSwitches): void => {
      updateDraft({ pricingSwitches: next });
    },
    [updateDraft],
  );

  return (
    <View
      style={
        intelPriceHighlight || intelCapacityHighlight
          ? {
              borderColor: accent.warm,
              borderWidth: 2,
              borderRadius: radiusTokens.md,
              padding: spacing.xs,
            }
          : undefined
      }
    >
      {/* Existing tickets — sorted by displayOrder */}
      {sortedTickets.length > 0 ? (
        <View style={styles.ticketsCol}>
          {sortedTickets.map((t, i) => {
            // Find the original index for error lookup (errors keyed by
            // original tickets[i] index from validation, not sorted index)
            const origIdx = draft.tickets.findIndex((x) => x.id === t.id);
            const nameError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].name`)
              : undefined;
            const priceError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].price`)
              : undefined;
            const capacityError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].capacity`)
              : undefined;
            const passwordError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].password`)
              : undefined;
            const waitlistConflictError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].waitlistConflict`)
              : undefined;
            const minQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].minPurchaseQty`)
              : undefined;
            const maxQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].maxPurchaseQty`)
              : undefined;
            const firstError =
              nameError ??
              priceError ??
              capacityError ??
              passwordError ??
              waitlistConflictError ??
              minQtyError ??
              maxQtyError;
            return (
              <TicketTierCard
                key={t.id}
                ticket={t}
                index={i}
                isFirst={i === 0}
                isLast={i === sortedTickets.length - 1}
                onEdit={() => handleEditTicket(t.id)}
                onDuplicate={() => handleDuplicateTicket(t.id)}
                onDelete={() => handleRequestDelete(t.id)}
                onMoveUp={() => handleMoveUp(t.id)}
                onMoveDown={() => handleMoveDown(t.id)}
                errorMessage={firstError}
                soldCount={soldCountByTier[t.id] ?? 0}
                eventCurrency={hasDisplayCurrency ? displayCurrency : undefined}
                dayScopeLabel={
                  dayEntries !== null && isDayLimited(t)
                    ? (formatDraftDayScopeLabel(dayEntries, t.validDayIds) ?? "No days")
                    : null
                }
              />
            );
          })}
        </View>
      ) : null}

      {emptyError !== undefined ? (
        <Text style={styles.helperError}>{emptyError}</Text>
      ) : null}

      {dayCaution !== null ? (
        <Text style={styles.dayCaution} testID="issue-3281-coverage-caution">
          {dayCaution}
        </Text>
      ) : null}

      <Pressable
        onPress={handleAddTicket}
        accessibilityRole="button"
        accessibilityLabel="Add ticket type"
        style={styles.addCta}
      >
        <Icon name="plus" size={16} color={accent.warm} />
        <Text style={styles.addCtaLabel}>Add ticket type</Text>
      </Pressable>

      {draft.tickets.length > 0 ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
          style={styles.summaryCard}
        >
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tickets available</Text>
            <Text style={styles.summaryValue}>{totalAvailable}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Max revenue</Text>
            <Text style={styles.summaryValue}>{maxRevenue}</Text>
          </View>
        </GlassCard>
      ) : null}

      {/* #3645 — a price on a brand with no currency asks for the payout
          country here, in place. */}
      <PayoutCountryInlinePrompt
        brand={brand}
        priced={lowestPaidMajor !== null}
        testID="event-tickets-payout-country-prompt"
      />

      {brand !== null ? (
        <WhoCoversCostsSection
          format="event"
          overrides={pricingSwitches}
          defaults={{
            passTax: brand.defaultPassTax ?? false,
            passMinglaFee: brand.defaultPassMinglaFee ?? false,
            passServiceFee: brand.defaultPassServiceFee ?? false,
          }}
          onChange={handleSwitchesChange}
          previewBaseCents={previewBaseCents}
          currency={switchesCurrency}
          effectiveTakeRateBps={
            brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS
          }
          paymentProvider={brand.paymentProvider}
          paymentCountry={brand.paymentCountry}
          locked={pricingLocked}
          disabled={
            !canEditTicketPrice ||
            (!usesConfiguredVat(brand) && taxRegistration.isLoading)
          }
          disabledReason={
            !usesConfiguredVat(brand) && taxRegistration.isLoading
              ? "Checking your tax registration…"
              : "A finance manager or above can change pricing settings."
          }
          onEditDefaults={() =>
            router.push(`/brand/${brand.id}/pricing-defaults` as never)
          }
          // Surface 4 — Stripe markets require an active registration. The
          // configured Nigeria rail is interactive without a Stripe detour.
          vatRegistered={taxRegistration.data?.hasActiveRegistration === true}
          onSetupVat={() => router.push("/connect-tax-registrations" as never)}
        />
      ) : null}

      {/* META-ORCH-1255(R2) — lazy body (own chunk); null fallback matches the
          sheet's own closed state (it renders null until `visible`). */}
      <Suspense fallback={null}>
        <TicketTierEditSheet
          visible={sheetVisible}
          onClose={handleCloseSheet}
          onSave={handleSaveTicket}
          initial={editingTicket}
          newTicketPreset={editingTicket === null ? newTicketPreset : null}
          nextOrder={nextOrder}
          soldCount={
            editingTicket !== null
              ? (soldCountByTier[editingTicket.id] ?? 0)
              : 0
          }
          // issue #3313 — on a recurring event capacity is PER NIGHT: the
          // label says so and the floor is the busiest night, not the run.
          capacityPerNight={isPerNightCapacity(draft.whenMode)}
          capacityFloor={
            editingTicket !== null
              ? editingDayFloor ?? editMode?.capacityFloorByTier?.[editingTicket.id]
              : undefined
          }
          dayScopeEntries={dayEntries}
          // Undefined on the edit screen, which does not carry the mode yet.
          dayScopePricingMode={draft.multiDatePricingMode}
          soldByDay={
            editingTicket === null || editMode === undefined
              ? {}
              : editMode.soldCountByTierDay === null ||
                  editMode.soldCountByTierDay === undefined
                ? null
                : (editMode.soldCountByTierDay[editingTicket.id] ?? {})
          }
          canEditPrice={canEditTicketPrice}
          brandId={draft.brandId}
          eventCurrency={hasDisplayCurrency ? displayCurrency : undefined}
          eventId={coverMediaEventId}
          privateLinksEnabled={editMode !== undefined}
          eventTitle={draft.name}
          allTickets={draft.tickets}
          eventStartsAtIso={eventStartsAtIso}
          eventEndsAtIso={eventEndsAtIso}
          renderUnderPrice={renderTicketSheetPayoutCountryPrompt}
        />
      </Suspense>

      <ConfirmDialog
        visible={pendingDeleteId !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete this ticket?"
        description={
          pendingDeleteTicket !== null && pendingDeleteTicket.name.length > 0
            ? `"${pendingDeleteTicket.name}" will be removed from this event.`
            : "This ticket will be removed from this event."
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
      />
      <TurnoutForecastCard surface="tickets" />
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  ticketsCol: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayCaution: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    marginTop: spacing.sm,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  addCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderStyle: "dashed",
    backgroundColor: glass.tint.profileBase,
  },
  addCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  summaryCard: {
    marginTop: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  summaryValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
