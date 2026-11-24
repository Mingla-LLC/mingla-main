/**
 * issue #3281 S3 (§6.4) — an event draft's add-ons as one list: each once,
 * naming the ticket it comes with by the draft's own ticket id, priced in
 * minor units.
 *
 *   liftTicketAddOns  — tickets carrying `extras` → one list
 *   ticketsWithAddOns — the list → `tickets[].extras`
 * Lifting then lowering returns the same tickets: `addOnTicketIds` remembers
 * which tickets carried an `extras` key (even an empty one), so a ticket that
 * never had one still sends none.
 *
 * The draft itself keeps today's per-ticket JSON (`tickets[].extras`, major
 * units), which the server blob and publish read. The unified editor works on
 * the one-list view this file lifts from it and lowers back. Only the editor's
 * on-use chunk imports this file, so none of it joins the Host web boot payload.
 */

import type { TicketExtraStub, TicketStub } from "../store/draftEventStore";

export interface DraftAddOn {
  id: string;
  name: string;
  description: string | null;
  /** Integer minor units; 0 is a free add-on. */
  priceMinor: number;
  isUnlimited: boolean;
  /** Null when unlimited. Per date when the add-on is limited to dates. */
  capacity: number | null;
  maxPerTicket: number;
  /** Draft date ids (MultiDateEntry.id); null means every date its ticket admits. */
  validDayIds: string[] | null;
  /** The draft ticket ids it comes with. One while the server links one ticket. */
  targets: string[];
  /** Live-only fields a ticket may have carried; kept so nothing is lost. */
  soldCount?: number;
  capacityFloor?: number;
  soldDayIds?: string[];
}

export interface DraftAddOnFields {
  addOns?: DraftAddOn[];
  /** Tickets whose server JSON carries an `extras` key (an empty list included). */
  addOnTicketIds?: string[];
}

const toMinor = (major: number): number => Math.round(major * 100);

const fromExtra = (extra: TicketExtraStub, ticketId: string): DraftAddOn => ({
  id: extra.id,
  name: extra.name,
  description: extra.description,
  priceMinor: toMinor(extra.priceGbp),
  isUnlimited: extra.isUnlimited,
  capacity: extra.capacity,
  maxPerTicket: extra.maxPerTicket,
  validDayIds: extra.validDayIds,
  targets: [ticketId],
  ...(extra.soldCount !== undefined ? { soldCount: extra.soldCount } : {}),
  ...(extra.capacityFloor !== undefined ? { capacityFloor: extra.capacityFloor } : {}),
  ...(extra.soldDayIds !== undefined ? { soldDayIds: extra.soldDayIds } : {}),
});

const toExtra = (addOn: DraftAddOn): TicketExtraStub => ({
  id: addOn.id,
  name: addOn.name,
  description: addOn.description,
  priceGbp: addOn.priceMinor / 100,
  isUnlimited: addOn.isUnlimited,
  capacity: addOn.capacity,
  maxPerTicket: addOn.maxPerTicket,
  validDayIds: addOn.validDayIds,
  ...(addOn.soldCount !== undefined ? { soldCount: addOn.soldCount } : {}),
  ...(addOn.capacityFloor !== undefined ? { capacityFloor: addOn.capacityFloor } : {}),
  ...(addOn.soldDayIds !== undefined ? { soldDayIds: addOn.soldDayIds } : {}),
});

/**
 * Moves every `tickets[].extras` list to the top level. A ticket without the key
 * keeps the add-ons it already had (`previous`); a ticket that left the draft
 * takes its add-ons with it, as a deleted ticket's extras always did.
 */
export const liftTicketAddOns = (
  tickets: readonly TicketStub[],
  previous: DraftAddOnFields = {},
): { tickets: TicketStub[] } & DraftAddOnFields => {
  const prevAddOns = previous.addOns ?? [];
  const prevIds = previous.addOnTicketIds ?? [];
  const addOns: DraftAddOn[] = [];
  const ticketIds: string[] = [];
  const out: TicketStub[] = [];
  for (const ticket of tickets) {
    if (Array.isArray(ticket.extras)) {
      for (const extra of ticket.extras) addOns.push(fromExtra(extra, ticket.id));
      ticketIds.push(ticket.id);
      const { extras: _moved, ...rest } = ticket;
      out.push(rest);
      continue;
    }
    for (const addOn of prevAddOns) if (addOn.targets[0] === ticket.id) addOns.push(addOn);
    if (prevIds.includes(ticket.id)) ticketIds.push(ticket.id);
    if ("extras" in ticket) {
      const { extras: _none, ...rest } = ticket;
      out.push(rest);
    } else {
      out.push(ticket);
    }
  }
  if (addOns.length === 0 && ticketIds.length === 0) return { tickets: out };
  return { tickets: out, addOns, addOnTicketIds: ticketIds };
};

/** The draft's tickets with their add-ons back on them, as the server reads them. */
export const ticketsWithAddOns = (
  draft: { tickets: readonly TicketStub[] } & DraftAddOnFields,
): TicketStub[] => {
  const addOns = draft.addOns ?? [];
  const ids = draft.addOnTicketIds ?? [];
  if (addOns.length === 0 && ids.length === 0) return draft.tickets.slice();
  return draft.tickets.map((ticket) => {
    const own = addOns.filter((addOn) => addOn.targets[0] === ticket.id);
    if (own.length === 0 && !ids.includes(ticket.id)) return ticket;
    return { ...ticket, extras: own.map(toExtra) };
  });
};
