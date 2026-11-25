/**
 * #4596 fix pass 3 — the event Blasts roster.
 *  1. A guest row says "Going", never an order count or an amount (Constitution
 *     #9); a buyer and a person who is both keep the buyer line.
 *  2. The roster is the count's own list: every person the count includes,
 *     from biz_marketing_event_roster_v1 (the same de-dup owner).
 *  3. A guest waiting on a duplicate check is never "marketing OK": the line
 *     comes from the server's decision.
 */
const rpc = jest.fn();
jest.mock("../../../services/supabase", () => ({ supabase: { rpc, from: jest.fn() } }));

import { buyerRowConsentLine, buyerRowMetaLine } from "../BuyerRow";
import { getEventRoster } from "../../../services/marketing/eventRosterService";
import type { BuyerRowData } from "../../../types/marketing";

const ACTOR = "45960000-0000-4000-8000-000000000007";
const BRAND = "45960000-0000-4000-8000-0000000000b1";
const EVENT = "45960000-0000-4000-8000-0000000000e3";

const SERVER_ROWS = [
  { key: "buyer:aa", name: "Buyer Only", role: "buyer", email: "buyonly@example.test", phone: null,
    orderCount: 2, totalSpendMinor: 3000, currency: "USD", lastAt: "2026-11-01T00:00:00Z",
    emailOk: true, emailRefused: false, smsOk: false },
  { key: "book:bb", name: "Mix Shared", role: "both", email: "mix@example.test", phone: "+2348031259621",
    orderCount: 1, totalSpendMinor: 1000, currency: "USD", lastAt: "2026-11-02T00:00:00Z",
    emailOk: true, emailRefused: false, smsOk: true },
  { key: "book:cc", name: "Mix Guest Only", role: "guest", email: "g22@example.test", phone: null,
    orderCount: null, totalSpendMinor: null, currency: null, lastAt: "2026-11-03T00:00:00Z",
    emailOk: true, emailRefused: false, smsOk: false },
  { key: "rsvp:dd", name: "Kim Unlinked", role: "pending", email: "kim@example.test", phone: null,
    orderCount: null, totalSpendMinor: null, currency: null, lastAt: "2026-11-04T00:00:00Z",
    emailOk: false, emailRefused: false, smsOk: false },
];

async function roster(): Promise<BuyerRowData[]> {
  rpc.mockResolvedValueOnce({ data: { eventTitle: "Mixed Party", rows: SERVER_ROWS }, error: null });
  return getEventRoster({ actor_id: ACTOR, brand_id: BRAND, event_id: EVENT });
}
const byName = (rows: BuyerRowData[], name: string): BuyerRowData => {
  const row = rows.find((r) => r.display_name === name);
  if (row === undefined) throw new Error(`no row ${name}`);
  return row;
};

beforeEach(() => rpc.mockReset());

describe("#4596 FP3-1 guests show Going, never orders or money", () => {
  it("a guest-only and a pending guest read Going", async () => {
    const rows = await roster();
    expect(buyerRowMetaLine(byName(rows, "Mix Guest Only"))).toBe("g22**@example.test · Going");
    expect(buyerRowMetaLine(byName(rows, "Kim Unlinked"))).toBe("kim**@example.test · Going");
    for (const name of ["Mix Guest Only", "Kim Unlinked"]) {
      expect(buyerRowMetaLine(byName(rows, name))).not.toMatch(/order|\$/);
    }
  });
  it("a buyer and a person who is both keep the buyer line", async () => {
    const rows = await roster();
    expect(buyerRowMetaLine(byName(rows, "Buyer Only"))).toBe("buy**@example.test · 2 orders · $30.00");
    expect(buyerRowMetaLine(byName(rows, "Mix Shared"))).toBe("mix**@example.test · 1 order · $10.00");
  });
  it("a row with no role (brand customers) is unchanged", () => {
    const legacy = {
      contact_key: "k", display_name: "Legacy", masked_email: "leg**@x.test", raw_email: null,
      masked_phone: null, raw_phone: null, order_count: 1, total_spend_minor: 500,
      total_spend_currency: "USD", last_event_id: null, last_event_name: null, last_purchase_at: null,
      consent: { email_marketing_ok: true, sms_marketing_ok: false, unsubscribed_brand_scope: false, unsubscribed_global_scope: false },
    } as BuyerRowData;
    expect(buyerRowMetaLine(legacy)).toBe("leg**@x.test · 1 order · $5.00");
  });
});

describe("#4596 FP3-2 the roster lists every person the count includes", () => {
  it("reads the server roster for this event and keeps all four rows", async () => {
    const rows = await roster();
    expect(rpc).toHaveBeenCalledWith("biz_marketing_event_roster_v1", {
      p_actor_id: ACTOR, p_brand_id: BRAND, p_event_id: EVENT,
    });
    expect(rows.map((r) => r.display_name)).toEqual(["Buyer Only", "Mix Shared", "Mix Guest Only", "Kim Unlinked"]);
    expect(rows.filter((r) => r.audience_role !== "pending")).toHaveLength(3);
  });
  it("a failed read is an error, never an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("forbidden") });
    await expect(getEventRoster({ actor_id: ACTOR, brand_id: BRAND, event_id: EVENT })).rejects.toThrow("forbidden");
  });
});

describe("#4596 FP3-3 consent is the server's decision", () => {
  it("a guest waiting on a duplicate check is never marketing OK", async () => {
    const rows = await roster();
    expect(buyerRowConsentLine(byName(rows, "Kim Unlinked"))).toEqual({ text: "waiting on a duplicate check", tone: "muted" });
    expect(buyerRowConsentLine(byName(rows, "Mix Shared"))).toEqual({ text: "marketing OK · SMS OK", tone: "ok" });
    expect(buyerRowConsentLine(byName(rows, "Mix Guest Only"))).toEqual({ text: "marketing OK", tone: "ok" });
  });
  it("a guest the Book refuses reads unsubscribed", () => {
    const refused = { ...SERVER_ROWS[2], emailOk: false, emailRefused: true };
    rpc.mockResolvedValueOnce({ data: { eventTitle: "x", rows: [refused] }, error: null });
    return getEventRoster({ actor_id: ACTOR, brand_id: BRAND, event_id: EVENT }).then((rows) => {
      expect(buyerRowConsentLine(rows[0])).toEqual({ text: "unsubscribed", tone: "muted" });
    });
  });
});
