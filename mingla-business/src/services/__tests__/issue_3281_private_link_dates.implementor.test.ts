/**
 * issue #3281 — a private ticket link's ticket keeps the dates it covers, so
 * the cart keeps the line to those dates instead of meeting checkout's refusal.
 */
import { expect, test } from "@jest/globals";

import { privateTicketFromLink } from "../../hooks/useTicketLinkUnlock";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TIER = "22222222-2222-4222-8222-222222222222";
const FRI = "33333333-3333-4333-8333-333333333333";

const resolved = (tier: Record<string, unknown>) =>
  privateTicketFromLink(
    {
      state: "active",
      kind: "private_ticket",
      eventId: EVENT,
      tier: { id: TIER, name: "Press", priceCents: 2400, currency: "USD", ...tier },
    } as never,
    EVENT,
  );

test("#3281 a listed private ticket keeps its dates", () => {
  expect(resolved({ validOccurrenceIds: [FRI] })?.validOccurrenceIds).toEqual([FRI]);
});

test("#3281 an All dates private ticket, or an older resolver, reads as every date", () => {
  expect(resolved({ validOccurrenceIds: null })?.validOccurrenceIds).toBeNull();
  expect(resolved({})?.validOccurrenceIds).toBeNull();
});
