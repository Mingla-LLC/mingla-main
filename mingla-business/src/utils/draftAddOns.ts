/**
 * issue #3281 S3 (§6.4) — an event draft's add-ons live once, at the top level
 * (`draft.addOns`), not inside each ticket. Each names the ticket it comes with
 * by the draft's own ticket id and keeps its price in minor units.
 *
 * The server draft blob and the publish step still read the per-ticket shape
 * (`tickets[].extras`, major units), so this module converts at those two
 * boundaries and nowhere else:
 *   liftTicketAddOns  — tickets carrying `extras` → top-level add-ons
 *   ticketsWithAddOns — top-level add-ons → `tickets[].extras` (save, publish,
 *                       and the per-ticket editor while the Add-ons flag is off)
 * Lifting then lowering returns the same tickets: `addOnTicketIds` remembers
 * which tickets carried an `extras` key (even an empty one), so a ticket that
 * never had one still sends none.
 *
 * Type-only imports: the persisted store loads this file, so it pulls in nothing.
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

/** Lifts a whole draft (persisted-store migration and server reads). */
export const liftDraftAddOns = <D extends { tickets: TicketStub[] } & DraftAddOnFields>(
  draft: D,
): D => {
  const lifted = liftTicketAddOns(draft.tickets, draft);
  const { addOns: _a, addOnTicketIds: _b, ...rest } = draft;
  return {
    ...(rest as D),
    tickets: lifted.tickets,
    ...(lifted.addOns !== undefined ? { addOns: lifted.addOns } : {}),
    ...(lifted.addOnTicketIds !== undefined ? { addOnTicketIds: lifted.addOnTicketIds } : {}),
  };
};
