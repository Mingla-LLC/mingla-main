/**
 * issue #4271 — writes the door sale draft (shape and reader in doorTapDraft.ts).
 *
 * Door mode hands off to `/event/<id>/door/tap/new?draft=<base64 json>` with
 * `{lines, eventDateId, buyerPhone?, buyerName?}`. The tap route decodes it
 * with `parseTapToPayDraft`. A typed buyer name can be any script, so the
 * payload is encoded as UTF-8 base64 (encodeBase64Utf8), never `btoa`, which
 * throws on anything outside Latin-1. An ASCII payload encodes exactly as
 * before, so `decodeDoorTapDraft` (atob) still reads "Sell another".
 *
 * Only door chunk code (doorSaleScreens.ts) imports this file; keep it that way
 * so it and tapToPayDraft.ts are not hoisted into the eager web __common chunk.
 */

import { encodeBase64Utf8 } from "../../services/terminal/tapToPayDraft";
import type { DoorTapDraft } from "./doorTapDraft";

export const encodeDoorTapDraft = (draft: DoorTapDraft): string =>
  encodeBase64Utf8(
    JSON.stringify({
      lines: draft.lines.map((line) => ({
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
      })),
      eventDateId: draft.eventDateId,
      ...(draft.buyerPhone ? { buyerPhone: draft.buyerPhone } : {}),
      ...(draft.phoneCountryIso ? { phoneCountryIso: draft.phoneCountryIso } : {}),
      ...(draft.buyerName ? { buyerName: draft.buyerName } : {}),
    }),
  );

/** "Sell another": back to Door mode (#4389) with the same tickets. */
export const doorSellAnotherHref = (
  eventId: string,
  draft: DoorTapDraft,
  method?: "pay_code" | "cash",
): string =>
  `/event/${eventId}/door/sell?source=sell_another&draft=${encodeURIComponent(encodeDoorTapDraft(draft))}${
    method !== undefined ? `&method=${method}` : ""
  }`;

export const doorTapNewSaleHref = (eventId: string, draft: DoorTapDraft): string =>
  `/event/${eventId}/door/tap/new?draft=${encodeURIComponent(encodeDoorTapDraft(draft))}`;
