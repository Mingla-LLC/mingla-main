/* eslint-disable import/first */
/**
 * META-ORCH-1104 Phase 3 — supportStaffService regression.
 *
 * Happy path (SPEC §7.1 / SC-3.2):
 *   - setSupportAvailable calls the LIVE support_set_available RPC with
 *     { p_available } and returns the server-persisted value (the availability
 *     toggle the dispatch requires).
 *   - listSupportQueue reads support_tickets newest-activity-first via RLS.
 *   - claimSupportTicket invokes the support-claim edge fn with { ticketId }.
 *
 * Adversarial (SPEC §3.3 / T-3.1 / T-3.5):
 *   - A non-staff caller's queue read returns the RLS-scoped result and THROWS
 *     on a genuine DB error (no silent [] — Prime Directive #5). RLS itself
 *     returns zero rows for a non-staff user (the real boundary).
 *   - setSupportAvailable THROWS when the RPC RAISEs not_support_staff (a
 *     non-staff caller cannot self-toggle).
 *   - claimSupportTicket degrades gracefully on a 404 (edge fn undeployed) —
 *     returns { ok:false, code:'not_deployed' } and NEVER throws.
 *
 * # Fails-on-revert
 * Change the RPC name in setSupportAvailable from "support_set_available" → the
 * happy-path assertion goes RED. Make listSupportQueue swallow the DB error
 * (return []) → the "throws on DB error" test goes RED.
 *
 * New sibling file (append-only safe).
 */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

type DbResult = Promise<{ data: unknown; error: unknown }>;
const rpcMock = jest.fn<(...args: unknown[]) => DbResult>();
const invokeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const orderMock = jest.fn<(...args: unknown[]) => DbResult>();
const selectMock = jest.fn((..._a: unknown[]) => ({ order: orderMock }));
const fromMock = jest.fn((..._a: unknown[]) => ({ select: selectMock }));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  claimSupportTicket,
  listSupportQueue,
  setSupportAvailable,
  setSupportTicketStatus,
} from "../supportStaffService";

describe("META-ORCH-1104 supportStaffService — happy", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    orderMock.mockReset();
  });

  test("setSupportAvailable calls support_set_available RPC and returns persisted value", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const result = await setSupportAvailable(true);
    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("support_set_available", {
      p_available: true,
    });
  });

  test("setSupportAvailable(false) persists off", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await setSupportAvailable(false)).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("support_set_available", {
      p_available: false,
    });
  });

  test("listSupportQueue reads support_tickets newest-activity-first", async () => {
    orderMock.mockResolvedValue({
      data: [{ id: "t1", subject: "Help", status: "new" }],
      error: null,
    });
    const rows = await listSupportQueue();
    expect(rows).toHaveLength(1);
    expect(fromMock).toHaveBeenCalledWith("support_tickets");
    expect(orderMock).toHaveBeenCalledWith("last_message_at", {
      ascending: false,
    });
  });

  test("claimSupportTicket invokes support-claim with the ticketId", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const res = await claimSupportTicket("ticket-1");
    expect(res.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("support-claim", {
      body: { ticketId: "ticket-1" },
    });
  });

  test("setSupportTicketStatus invokes support-set-status with the status", async () => {
    invokeMock.mockResolvedValue({ data: null, error: null });
    const res = await setSupportTicketStatus("ticket-1", "pending");
    expect(res.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("support-set-status", {
      body: { ticketId: "ticket-1", status: "pending" },
    });
  });
});

describe("META-ORCH-1104 supportStaffService — adversarial", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    invokeMock.mockReset();
    orderMock.mockReset();
  });

  test("listSupportQueue THROWS on a DB/RLS error (no silent [])", async () => {
    orderMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(listSupportQueue()).rejects.toThrow("permission denied");
  });

  test("setSupportAvailable THROWS when the RPC rejects a non-staff caller", async () => {
    // support_set_available RAISEs not_support_staff for a non-staff caller.
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "not_support_staff" },
    });
    await expect(setSupportAvailable(true)).rejects.toThrow("not_support_staff");
  });

  test("claimSupportTicket degrades gracefully on a 404 (edge fn undeployed) — no throw", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { status: 404, message: "not found" },
    });
    const res = await claimSupportTicket("ticket-1");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_deployed");
  });

  test("claimSupportTicket surfaces a 403 as forbidden (non-staff at the edge fn)", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { status: 403, message: "forbidden" },
    });
    const res = await claimSupportTicket("ticket-1");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });
});
