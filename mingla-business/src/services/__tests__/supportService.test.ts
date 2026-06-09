/* eslint-disable import/first */
/**
 * META-ORCH-1104 Phase 1 — supportService regression.
 *
 * Happy path (T-1.1):
 *   - createSupportTicket trims the subject, calls the LIVE create_support_ticket
 *     RPC with { p_subject, p_brand_id }, and returns the new ticket id.
 *   - notifyNewSupportTicket is best-effort: a missing/404 notify-support edge fn
 *     is swallowed (no throw) so the requester flow never breaks pre-deploy.
 *
 * Adversarial (T-1.3 boundary):
 *   - An empty / whitespace-only subject is REJECTED client-side BEFORE any RPC
 *     call (never mint a blank ticket).
 *   - listOwnSupportTickets / getOwnSupportTicket THROW on a DB error (no silent
 *     [] / null fallback — Prime Directive #5).
 *
 * # Fails-on-revert
 * Remove the empty-subject guard in createSupportTicket → the "empty subject"
 * test goes RED (the RPC would be called with a blank subject). Change the RPC
 * name passed to supabase.rpc → the happy-path assertion goes RED.
 *
 * New sibling file (append-only safe).
 */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

type DbResult = Promise<{ data: unknown; error: unknown }>;
const rpcMock = jest.fn<(...args: unknown[]) => DbResult>();
const invokeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const orderMock = jest.fn<(...args: unknown[]) => DbResult>();
const maybeSingleMock = jest.fn<(...args: unknown[]) => DbResult>();
const eqMock = jest.fn((..._a: unknown[]) => ({ maybeSingle: maybeSingleMock }));
const selectMock = jest.fn((..._a: unknown[]) => ({
  order: orderMock,
  eq: eqMock,
}));
const fromMock = jest.fn((..._a: unknown[]) => ({ select: selectMock }));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  createSupportTicket,
  notifyNewSupportTicket,
  listOwnSupportTickets,
  getOwnSupportTicket,
} from "../supportService";

describe("META-ORCH-1104 supportService — create + list (happy)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    orderMock.mockReset();
    maybeSingleMock.mockReset();
  });

  test("createSupportTicket trims subject, calls create_support_ticket RPC, returns id", async () => {
    rpcMock.mockResolvedValue({ data: "ticket-abc", error: null });
    const id = await createSupportTicket("  Payouts are stuck  ", null);
    expect(id).toBe("ticket-abc");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_support_ticket", {
      p_subject: "Payouts are stuck",
      p_brand_id: null,
    });
  });

  test("createSupportTicket passes brandId through when provided", async () => {
    rpcMock.mockResolvedValue({ data: "ticket-xyz", error: null });
    await createSupportTicket("A question", "brand-123");
    expect(rpcMock).toHaveBeenCalledWith("create_support_ticket", {
      p_subject: "A question",
      p_brand_id: "brand-123",
    });
  });

  test("notifyNewSupportTicket no-ops gracefully when notify-support is unavailable", async () => {
    invokeMock.mockRejectedValue(new Error("Function not found"));
    // Must NOT throw — the ticket already exists; push is best-effort.
    await expect(notifyNewSupportTicket("ticket-abc")).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("notify-support", {
      body: { event: "new_ticket", ticketId: "ticket-abc" },
    });
  });

  test("listOwnSupportTickets returns the RLS-scoped rows newest-first", async () => {
    orderMock.mockResolvedValue({
      data: [{ id: "t1", subject: "Hi", status: "open" }],
      error: null,
    });
    const rows = await listOwnSupportTickets();
    expect(rows).toHaveLength(1);
    expect(selectMock).toHaveBeenCalled();
    expect(orderMock).toHaveBeenCalledWith("last_message_at", {
      ascending: false,
    });
  });
});

describe("META-ORCH-1104 supportService — adversarial", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    maybeSingleMock.mockReset();
    orderMock.mockReset();
  });

  test("empty / whitespace subject is rejected BEFORE any RPC call", async () => {
    await expect(createSupportTicket("   ", null)).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("createSupportTicket throws when the RPC returns an error (no silent fallback)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(createSupportTicket("Real subject", null)).rejects.toThrow(
      "boom",
    );
  });

  test("listOwnSupportTickets throws on DB error (no silent [])", async () => {
    orderMock.mockResolvedValue({ data: null, error: { message: "rls denied" } });
    await expect(listOwnSupportTickets()).rejects.toThrow("rls denied");
  });

  test("getOwnSupportTicket returns null for an RLS-hidden / absent ticket (no crash)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const row = await getOwnSupportTicket("foreign-ticket");
    expect(row).toBeNull();
  });
});
