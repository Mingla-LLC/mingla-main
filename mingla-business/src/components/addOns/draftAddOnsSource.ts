/**
 * issue #3281 S3 (§6.4) — the Add-ons editor on an event draft.
 *
 * A draft has no ticket rows yet, so the editor reads and writes the draft's own
 * `addOns` (draft ticket ids as targets, minor units) instead of the server.
 * Publishing maps them onto the new tickets through the per-ticket JSON the
 * publish step already reads (`utils/draftAddOns`), so each add-on comes with
 * one ticket on a draft. Photos are added once the event is published (a photo
 * belongs to a saved add-on), so the draft form hides the photo and the public
 * page switch (every draft add-on is shown, the default).
 */

import type { DraftEvent } from "../../store/draftEventStore";
import type { DraftAddOn, DraftAddOnFields } from "../../utils/draftAddOns";
import type {
  AddOnSaveItem,
  AddOnTargetOption,
  OfferingAddOn,
  OfferingAddOnsPayload,
} from "./addOnsEditorModel";

type DraftView = Pick<
  DraftEvent,
  "id" | "tickets" | "currency" | "whenMode" | "multiDates" | "timezone" | "addOns" | "addOnTicketIds"
>;

let localIdSeq = 0;
const newLocalId = (): string => {
  localIdSeq += 1;
  return `x_${Date.now().toString(36)}${localIdSeq.toString(36)}`;
};

/** The draft as the editor's payload: its tickets are the targets, its dates the dates. */
export const draftAddOnsPayload = (draft: DraftView): OfferingAddOnsPayload => {
  const multi = draft.whenMode === "multi_date";
  const targets: AddOnTargetOption[] = draft.tickets.map((ticket) => {
    const priceCents = ticket.priceGbp === null ? 0 : Math.round(ticket.priceGbp * 100);
    return {
      key: `tt:${ticket.id}`,
      target: { kind: "ticket_type", ticketTypeId: ticket.id },
      name: ticket.name.trim().length > 0 ? ticket.name : "Untitled ticket",
      isFree: ticket.isFree || priceCents === 0,
      priceCents,
      validOccurrenceKeys: multi ? (ticket.validDayIds ?? null) : null,
    };
  });
  const dates = multi
    ? (draft.multiDates ?? []).map((entry) => ({
        key: entry.id,
        startsAt: `${entry.date}T${entry.startTime}:00`,
        timezone: draft.timezone,
      }))
    : [];
  const addOns: OfferingAddOn[] = (draft.addOns ?? []).map((addOn, index) => ({
    id: addOn.id,
    name: addOn.name,
    description: addOn.description,
    priceCents: addOn.priceMinor,
    isUnlimited: addOn.isUnlimited,
    quantityTotal: addOn.isUnlimited ? null : addOn.capacity,
    maxPerTicket: addOn.maxPerTicket,
    validOccurrenceKeys: addOn.validDayIds,
    photoPath: null,
    photoThumbPath: null,
    showOnPublicPage: true,
    sortOrder: index,
    soldCount: addOn.soldCount ?? 0,
    soldOccurrenceKeys: addOn.soldDayIds ?? [],
    targets: addOn.targets.map((ticketTypeId) => ({ kind: "ticket_type" as const, ticketTypeId })),
  }));
  return {
    eventId: draft.id,
    eventType: "event",
    revision: 0,
    // Publish links each add-on to one ticket, so a draft offers one.
    multiLinkEnabled: false,
    freeParentEnabled: false,
    currency: draft.currency ?? null,
    dates,
    targets,
    addOns,
  };
};

/** The editor's whole-list save as the draft's add-on fields. */
export const draftAddOnsFromSave = (
  items: readonly AddOnSaveItem[],
  draft: DraftView,
): Required<DraftAddOnFields> => {
  const previous = new Map((draft.addOns ?? []).map((addOn) => [addOn.id, addOn]));
  const addOns: DraftAddOn[] = items.map((item) => {
    const before = item.id !== undefined ? previous.get(item.id) : undefined;
    const targets = item.targets.flatMap((target) =>
      target.kind === "ticket_type" ? [target.ticketTypeId] : [],
    );
    return {
      id: item.id ?? newLocalId(),
      name: item.name,
      description: item.description,
      priceMinor: item.priceCents,
      isUnlimited: item.isUnlimited,
      capacity: item.isUnlimited ? null : item.quantityTotal,
      maxPerTicket: item.maxPerTicket,
      validDayIds: item.validOccurrenceKeys,
      targets,
      ...(before?.soldCount !== undefined ? { soldCount: before.soldCount } : {}),
      ...(before?.capacityFloor !== undefined ? { capacityFloor: before.capacityFloor } : {}),
      ...(before?.soldDayIds !== undefined ? { soldDayIds: before.soldDayIds } : {}),
    };
  });
  const ticketIds = new Set(draft.addOnTicketIds ?? []);
  for (const addOn of addOns) for (const id of addOn.targets) ticketIds.add(id);
  // The draft's tickets keep their order; an add-on follows its ticket's order.
  const order = new Map(draft.tickets.map((ticket, index) => [ticket.id, index]));
  const sorted = addOns
    .map((addOn, index) => ({ addOn, index }))
    .sort(
      (a, b) =>
        (order.get(a.addOn.targets[0] ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.addOn.targets[0] ?? "") ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.addOn);
  return {
    addOns: sorted,
    addOnTicketIds: draft.tickets.map((ticket) => ticket.id).filter((id) => ticketIds.has(id)),
  };
};
