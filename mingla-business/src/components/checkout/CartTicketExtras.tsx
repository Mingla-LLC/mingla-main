/**
 * issue #3281 — Extras on the Host web cart step. One ticket's extras, under
 * its quantity row, revealed once the guest has at least one of that ticket
 * (#3283 §2.6). Lives in the deferred checkout route, so the public page pays
 * nothing for it.
 *
 * The cart line is the authority: extras ride `line.addOns`, the quote prices
 * them, and a ticket change that lowers what the line may carry trims them
 * here before the next quote.
 */

import React, { useCallback, useEffect, useMemo } from "react";

import type { CheckoutAddOnRequest } from "@mingla/offering-rendering/ticketCheckoutContract";

import {
  TicketExtrasPicker,
  type TicketExtrasPickerTheme,
} from "@mingla/offering-rendering/TicketExtrasPicker";
import {
  extraCap,
  extraDatesOnLine,
  extrasLineDates,
  extrasParentCount,
  extraSoldOutOnLine,
  fitExtrasToLine,
  parsePublicTicketExtras,
  withExtraQuantity,
  type PublicTicketExtra,
} from "@mingla/offering-rendering/ticketExtrasCart";

import { accent, glass, text as textTokens } from "../../constants/designSystem";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import type { TicketStub } from "../../store/draftEventStore";
import { formatCurrency } from "../../utils/currency";
import { useCart, type CartLine } from "./CartContext";

const THEME: TicketExtrasPickerTheme = {
  accent: accent.warm,
  textPrimary: textTokens.primary,
  textSecondary: textTokens.secondary,
  textTertiary: textTokens.tertiary,
  border: glass.border.chrome,
};

export interface CartTicketExtrasProps {
  ticket: TicketStub;
  line: CartLine | undefined;
  eventDateIds: readonly string[];
  occurrences: readonly PublicEventOccurrence[];
  currency: string;
}

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

export const CartTicketExtras: React.FC<CartTicketExtrasProps> = ({
  ticket,
  line,
  eventDateIds,
  occurrences,
  currency,
}) => {
  const { setLineQuantity } = useCart();
  // The line's own fields, with new extras; an empty list clears them.
  const setLineAddOns = useCallback(
    (next: readonly CheckoutAddOnRequest[] | undefined): void => {
      if (line !== undefined) setLineQuantity({ ...line, addOns: next ?? [] });
    },
    [line, setLineQuantity],
  );
  const extras = useMemo(
    () => parsePublicTicketExtras(ticket.buyerExtras),
    [ticket.buyerExtras],
  );
  const parentCount = extrasParentCount(line);
  const lineDates = useMemo(
    () => extrasLineDates(line, ticket.validOccurrenceIds, eventDateIds),
    [line, ticket.validOccurrenceIds, eventDateIds],
  );
  const caps = useMemo(() => {
    const out: Record<string, number> = {};
    for (const extra of extras) out[extra.id] = extraCap(extra, parentCount, lineDates);
    return out;
  }, [extras, parentCount, lineDates]);

  // Fewer tickets, other dates, or an extra taken off sale: bring the line's
  // extras down to what it can carry, so the quote never sees an over-ask.
  const addOns = line?.addOns;
  useEffect(() => {
    if (line === undefined) return;
    const fitted = fitExtrasToLine(addOns, extras, parentCount, lineDates);
    if (fitted !== addOns) setLineAddOns(fitted);
  }, [addOns, extras, line, lineDates, parentCount, setLineAddOns]);

  if (extras.length === 0 || line === undefined || parentCount === 0) return null;

  const dateCaption = (extra: PublicTicketExtra): string | null => {
    const dates = extraDatesOnLine(extra, lineDates);
    // Only worth saying when it covers fewer dates than the ticket does.
    if (dates === null || dates.length === 0 || dates.length === lineDates.length) {
      return null;
    }
    const labels = occurrences
      .filter((occurrence) => dates.includes(occurrence.id))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((occurrence) => shortDay(occurrence.startAt));
    return labels.length === 0 ? null : `${labels.join(", ")} only`;
  };

  return (
    <TicketExtrasPicker
      ticketName={ticket.name}
      extras={extras}
      selected={line.addOns}
      caps={caps}
      onChange={(addOnId, quantity) =>
        setLineAddOns(withExtraQuantity(line.addOns, addOnId, quantity))
      }
      formatMoney={(cents) => formatCurrency(cents, currency, true)}
      dateCaption={dateCaption}
      soldOut={(extra) => extraSoldOutOnLine(extra, lineDates)}
      theme={THEME}
      testID={`issue-3281-cart-extras-${ticket.id}`}
    />
  );
};
