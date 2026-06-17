/* eslint-disable import/first */
/**
 * META-ORCH-1148 e2e-validation gap — venue table SOFT-DELETE hook tests.
 *
 * GAP 2: the Tables module shipped add/edit but NO delete. The fix adds
 * soft-delete (deleted_at column + guarded RPC). These tests prove:
 *   (1) fetchVenueTables EXCLUDES soft-deleted rows (`.is("deleted_at", null)`)
 *       so a deleted table vanishes from the operator list, and
 *   (2) useDeleteVenueTable calls the guarded RPC `biz_venue_table_soft_delete`
 *       with the table id.
 *
 * Fails-on-revert: deleting the `.is("deleted_at", null)` chain call from
 * fetchVenueTables makes T-DEL-1 fail (the filter is no longer recorded);
 * deleting the rpc call makes T-DEL-2 fail (no rpc invocation captured).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// --- supabase mock: record the query-builder chain + rpc calls. ----------
const chainCalls: { method: string; args: unknown[] }[] = [];
const rpcCalls: { fn: string; params: unknown }[] = [];

const makeBuilder = (): Record<string, unknown> => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "returns", "update", "upsert"]) {
    builder[m] = jest.fn((...args: unknown[]) => {
      chainCalls.push({ method: m, args });
      return builder;
    });
  }
  // Terminal `.returns()` resolves to an empty result set.
  builder.returns = jest.fn((..._args: unknown[]) => {
    chainCalls.push({ method: "returns", args: _args });
    return Promise.resolve({ data: [], error: null });
  });
  return builder;
};

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: jest.fn(() => makeBuilder()),
    rpc: jest.fn((fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: null, authStatus: "ready" }),
}));

// Capture the mutation config so we can invoke the real mutationFn body.
let capturedMutation: { mutationFn: (vars: unknown) => Promise<void> } | null =
  null;
jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
    useMutation: (config: { mutationFn: (vars: unknown) => Promise<void> }) => {
      capturedMutation = config;
      return { mutate: jest.fn(), isPending: false };
    },
  };
});

import { fetchVenueTables, useDeleteVenueTable } from "../useVenueTables";
import { supabase } from "../../services/supabase";

describe("META-ORCH-1148 — venue table soft-delete", () => {
  beforeEach(() => {
    chainCalls.length = 0;
    rpcCalls.length = 0;
    jest.clearAllMocks();
  });

  test("T-DEL-1 — fetchVenueTables excludes soft-deleted rows (deleted_at IS NULL)", async () => {
    await fetchVenueTables("brand-1");
    const isCall = chainCalls.find(
      (c) => c.method === "is" && c.args[0] === "deleted_at" && c.args[1] === null,
    );
    expect(isCall).toBeDefined();
  });

  test("T-DEL-2 — the delete mutation calls the guarded RPC with the table id", async () => {
    capturedMutation = null;
    // Calling the hook outside a renderer is safe: it only invokes the (mocked)
    // useQueryClient + useMutation — no useState/useEffect/useRef.
    useDeleteVenueTable("brand-1");
    const mutation = capturedMutation as
      | { mutationFn: (vars: unknown) => Promise<void> }
      | null;
    if (mutation === null) throw new Error("mutation not captured");
    await mutation.mutationFn({ id: "table-9" });
    expect(rpcCalls).toContainEqual({
      fn: "biz_venue_table_soft_delete",
      params: { p_table_id: "table-9" },
    });
    expect(supabase.rpc).toHaveBeenCalledWith("biz_venue_table_soft_delete", {
      p_table_id: "table-9",
    });
  });
});
