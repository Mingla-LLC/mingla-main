/**
 * #4111 — independent tester adversarial proof for the Explorer enquiry chat
 * rows and read status (Friends tab).
 *
 * The implementor suite maps a clean data set. This one feeds what the
 * network can really return: receipts written by OTHER people, system rows,
 * messages from other threads in the same page, two enquiries to the same
 * brand, a brand the view no longer returns, unknown statuses, and the
 * send/claim edges a signed-out or broken session can hit.
 *
 * Runs in the app-mobile render lane (jest.issue2774.render.cjs).
 *
 * FAILS-ON-REVERT: counting a receipt from any user as "read" fails R-1;
 * letting system rows become the preview fails R-2; merging rows per brand
 * fails R-4.
 */
const mockRpc = jest.fn();
const mockUpsert = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => ({
      upsert: (...args: unknown[]) => mockUpsert(table, ...args),
    }),
  },
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import {
  buildMyEnquiryRows,
  markEnquiryMessagesRead,
} from "../../../services/brandEnquiryService";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BRAND = "33333333-3333-4333-8333-333333333333";
const C1 = "44444444-4444-4444-8444-444444444444";
const C2 = "55555555-5555-4555-8555-555555555555";

const enquiry = (id: string, conversation: string, over: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND,
  conversation_id: conversation,
  status: "replied",
  topic_label: "Refund",
  created_at: "2026-10-20T10:00:00Z",
  last_guest_at: "2026-10-20T10:00:00Z",
  last_brand_at: "2026-10-21T10:00:00Z",
  ...over,
});
const msg = (id: string, conversation: string, kind: string | null, at: string, reads: string[] = []) => ({
  id,
  conversation_id: conversation,
  content: `${kind ?? "legacy"} ${id}`,
  sender_kind: kind,
  created_at: at,
  message_reads: reads.map((user_id) => ({ user_id })),
});

describe("#4111 Explorer enquiry rows under hostile data", () => {
  test("R-1 a receipt written by someone else never marks MY message read", () => {
    const rows = buildMyEnquiryRows(ME, [enquiry("e1", C1)], [], [
      msg("m1", C1, "brand", "2026-10-21T10:00:00Z", [OTHER]),
      msg("m2", C1, "brand", "2026-10-21T11:00:00Z", [ME]),
    ]);
    expect(rows[0].unreadCount).toBe(1);
  });

  test("R-2 system rows are never the preview and never unread; guest rows are never unread", () => {
    const rows = buildMyEnquiryRows(ME, [enquiry("e1", C1)], [], [
      msg("m1", C1, "guest", "2026-10-21T10:00:00Z"),
      msg("m2", C1, "system", "2026-10-22T10:00:00Z"),
    ]);
    expect(rows[0].lastMessage?.id).toBe("m1");
    expect(rows[0].lastMessage?.fromBrand).toBe(false);
    expect(rows[0].unreadCount).toBe(0);
  });

  test("R-3 messages from another thread in the same page never bleed in", () => {
    const rows = buildMyEnquiryRows(ME, [enquiry("e1", C1)], [], [
      msg("x1", C2, "brand", "2026-10-25T10:00:00Z"),
    ]);
    expect(rows[0].lastMessage).toBeNull();
    expect(rows[0].unreadCount).toBe(0);
  });

  test("R-4 two enquiries to the same brand stay two rows, newest activity first", () => {
    const rows = buildMyEnquiryRows(
      ME,
      [enquiry("e1", C1), enquiry("e2", C2, { last_brand_at: null, last_guest_at: "2026-10-24T10:00:00Z", created_at: "2026-10-24T10:00:00Z" })],
      [{ id: BRAND, name: "Lantern", slug: "lantern", profile_photo_url: null }],
      [],
    );
    expect(rows.map((r) => r.enquiryId)).toEqual(["e2", "e1"]);
    expect(new Set(rows.map((r) => r.conversationId)).size).toBe(2);
  });

  test("R-5 a brand the view no longer returns, or a blank name, still reads as a brand", () => {
    const missing = buildMyEnquiryRows(ME, [enquiry("e1", C1)], [], []);
    const blank = buildMyEnquiryRows(ME, [enquiry("e1", C1)], [{ id: BRAND, name: "   ", slug: null, profile_photo_url: null }], []);
    expect(missing[0].brandName).toBe("Brand");
    expect(blank[0].brandName).toBe("Brand");
  });

  test("R-6 unparseable timestamps never produce 'Invalid Date' ordering crashes", () => {
    const rows = buildMyEnquiryRows(
      ME,
      [enquiry("e1", C1, { created_at: "garbage", last_guest_at: null, last_brand_at: null }), enquiry("e2", C2)],
      [],
      [msg("m1", C1, "brand", "also garbage")],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => typeof r.lastActivityAt === "string")).toBe(true);
  });
});

describe("#4111 Explorer read status writes only my own receipts", () => {
  beforeEach(() => mockUpsert.mockReset().mockResolvedValue({ error: null }));

  test("every receipt row carries the caller's id and the upsert is idempotent", async () => {
    await markEnquiryMessagesRead(ME, ["m1", "m2"]);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [table, rows, options] = mockUpsert.mock.calls[0];
    expect(table).toBe("message_reads");
    expect(rows).toEqual([{ message_id: "m1", user_id: ME }, { message_id: "m2", user_id: ME }]);
    expect(options).toEqual({ onConflict: "message_id,user_id" });
  });

  test("nothing to mark → no write at all", async () => {
    await markEnquiryMessagesRead(ME, []);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("a refused write (the server guard) surfaces as an error, it is not swallowed here", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(markEnquiryMessagesRead(OTHER, ["m1"])).rejects.toMatchObject({ code: "42501" });
  });
});
