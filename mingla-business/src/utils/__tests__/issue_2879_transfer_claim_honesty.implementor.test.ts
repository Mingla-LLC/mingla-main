/**
 * #2879 Ilashe P0 — transfer capability does not exist; host/buyer copy must not promise it.
 */
import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import type { TicketStub } from "../../store/draftEventStore";
import { formatTicketBadges, formatTicketSubline } from "../ticketDisplay";

const FORBIDDEN = [
  "Allow ticket transfers",
  "Allow transfers",
  "Buyers can send to friends",
  "Buyers can transfer this ticket to someone else",
  "Transfers disabled",
  "non-transferable",
];

const SURFACES = [
  "mingla-business/src/components/event/CreatorStep6Settings.tsx",
  "mingla-business/src/components/event/TicketTierEditSheet.tsx",
  "mingla-business/src/utils/ticketDisplay.ts",
];

function stub(overrides: Partial<TicketStub> = {}): TicketStub {
  return {
    id: "t1",
    name: "GA",
    priceGbp: 1000,
    currency: "NGN",
    isUnlimited: false,
    capacity: 100,
    isFree: false,
    visibility: "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    passwordConfigured: false,
    waitlistEnabled: false,
    allowTransfers: false,
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    availableAt: "both",
    ...overrides,
  };
}

describe("issue #2879 transfer claim honesty", () => {
  it("host and buyer surfaces do not promise transfers", () => {
    const root = path.resolve(__dirname, "../../../../");
    for (const rel of SURFACES) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      for (const phrase of FORBIDDEN) {
        expect(src.includes(phrase)).toBe(false);
      }
    }
  });

  it("ticket display never emits transfer badges or modifiers", () => {
    expect(/transfer/i.test(formatTicketSubline(stub()))).toBe(false);
    expect(formatTicketBadges(stub()).some((b) => /transfer/i.test(b.label))).toBe(false);

    const on = stub({ allowTransfers: true });
    expect(/transfer/i.test(formatTicketSubline(on))).toBe(false);
    expect(formatTicketBadges(on).some((b) => /transfer/i.test(b.label))).toBe(false);
  });

  it("Ari upsert_ticket_tier schema no longer advertises allow_transfers", () => {
    const root = path.resolve(__dirname, "../../../../");
    const src = fs.readFileSync(
      path.join(root, "supabase/functions/_shared/agentDomainTools.ts"),
      "utf8",
    );
    const start = src.indexOf('"upsert_ticket_tier"');
    expect(start).toBeGreaterThan(-1);
    const schemaSlice = src.slice(start, start + 1200);
    expect(/\ballow_transfers\s*:/.test(schemaSlice)).toBe(false);
  });
});
