// ORCH-1384 — implementor regression: partnerBrandLinksService verbs + read
// contract (T-2 / T-2b / T-5 / T-9 service leg).
//
// fails-on-revert (SPEC §9 proof 2): with the service reverted to the
// pre-1384 shape (no includeCancelled handling / no cancelled_reason in the
// select), the T-2/T-2b asserts below FAIL — the select-string assert and
// the include-cancelled filter-skip assert both pin the new contract.
//
// House mock pattern: brandsService.orch_1081_switcher_membership.test.ts
// (jest.mock("../supabase") + captured builder chain).

/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

interface CapturedCall {
  m: string;
  a: unknown[];
}

const captured: { table: string | null; calls: CapturedCall[] } = {
  table: null,
  calls: [],
};
let queryResult: { data: unknown; error: unknown } = { data: [], error: null };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let invokeResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
const invokeCalls: Array<{ name: string; body: unknown }> = [];

class MockBuilder {
  select(...a: unknown[]): MockBuilder {
    captured.calls.push({ m: "select", a });
    return this;
  }
  eq(...a: unknown[]): MockBuilder {
    captured.calls.push({ m: "eq", a });
    return this;
  }
  is(...a: unknown[]): MockBuilder {
    captured.calls.push({ m: "is", a });
    return this;
  }
  order(...a: unknown[]): Promise<{ data: unknown; error: unknown }> {
    captured.calls.push({ m: "order", a });
    return Promise.resolve(queryResult);
  }
}

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "partner-1" } },
          error: null,
        }),
    },
    from: (table: string) => {
      captured.table = table;
      return new MockBuilder();
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        invokeCalls.push({ name, body: opts.body });
        return Promise.resolve(invokeResult);
      },
    },
  },
}));

import {
  cancelPendingLink,
  disconnectLink,
  INVITE_EXPIRY_DAYS,
  isInviteExpired,
  listPartnerBrandLinks,
  partnerBrandLinksKeys,
  reissueInvitation,
  type PartnerBrandLinkWithStatus,
} from "../partnerBrandLinksService";

beforeEach(() => {
  captured.table = null;
  captured.calls = [];
  queryResult = { data: [], error: null };
  rpcResult = { data: null, error: null };
  rpcCalls.length = 0;
  invokeResult = { data: null, error: null };
  invokeCalls.length = 0;
});

const isCall = (c: CapturedCall): boolean => c.m === "is";

describe("T-2 — default read is byte-compatible (cancelled excluded)", () => {
  test("default: filters cancelled_at IS NULL and selects cancelled_reason", async () => {
    await listPartnerBrandLinks();
    expect(captured.table).toBe("partner_brand_links");
    const isCalls = captured.calls.filter(isCall);
    expect(isCalls).toHaveLength(1);
    expect(isCalls[0].a).toEqual(["cancelled_at", null]);
    const select = captured.calls.find((c) => c.m === "select");
    expect(select).toBeDefined();
    const selectStr = String(select?.a[0] ?? "");
    // fails-on-revert proof 2 anchor: the new column rides the select.
    expect(selectStr).toContain("cancelled_reason");
    // T-9 service leg: the brand embed is UNFILTERED on deleted_at so a
    // cancelled row keeps rendering its soft-deleted brand's name (D-5).
    expect(selectStr).toContain("brand:brands(");
    expect(selectStr).not.toContain("deleted_at");
  });

  test("T-2b: includeCancelled=true SKIPS the cancelled filter (distinct query)", async () => {
    await listPartnerBrandLinks({ includeCancelled: true });
    expect(captured.calls.filter(isCall)).toHaveLength(0);
  });

  test("query keys: the includeCancelled flag IS part of the key; brand key exists", () => {
    expect(partnerBrandLinksKeys.list(false)).not.toEqual(
      partnerBrandLinksKeys.list(true),
    );
    expect(partnerBrandLinksKeys.list(true)).toContain(true);
    expect(partnerBrandLinksKeys.brand("b-1")).toEqual([
      "partnerBrandLinks",
      "brand",
      "b-1",
    ]);
    // Root retained for invalidation.
    expect(partnerBrandLinksKeys.list(false)[0]).toBe(
      partnerBrandLinksKeys.all[0],
    );
  });
});

describe("T-5 — expiry derivation boundary", () => {
  const rowAt = (invitedAtMsAgo: number): PartnerBrandLinkWithStatus => ({
    id: "l1",
    partner_account_id: "partner-1",
    brand_id: "b1",
    invited_owner_email: "o@example.com",
    personal_note: null,
    invited_at: new Date(Date.now() - invitedAtMsAgo).toISOString(),
    accepted_at: null,
    owner_stripe_connected_at: null,
    first_split_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    status: "awaiting_owner",
  });

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  test("flips exactly at the 7-day boundary (±1min)", () => {
    expect(isInviteExpired(rowAt(SEVEN_DAYS - MINUTE))).toBe(false);
    expect(isInviteExpired(rowAt(SEVEN_DAYS + MINUTE))).toBe(true);
  });

  test("non-awaiting_owner rows never derive expired", () => {
    const active = { ...rowAt(SEVEN_DAYS * 2), status: "active" as const };
    expect(isInviteExpired(active)).toBe(false);
  });

  test("INVITE_EXPIRY_DAYS === 7, pinned to the edge fn's EXPIRY_DAYS", () => {
    expect(INVITE_EXPIRY_DAYS).toBe(7);
    // Cross-runtime pin: read the shared edge module and assert its constant
    // (uniqueness companion per COMMS-0106 — the declaration must appear
    // EXACTLY once so a shadowing redefinition can't fool this).
    const edgeSrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../supabase/functions/_shared/brandInviteEmail.ts",
      ),
      "utf8",
    );
    const decls = edgeSrc.match(/export const EXPIRY_DAYS = (\d+);/g) ?? [];
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBe(`export const EXPIRY_DAYS = ${INVITE_EXPIRY_DAYS};`);
  });
});

describe("verb error contracts (§5.6 typed codes — never silent)", () => {
  test("cancelPendingLink maps has_upcoming_events → workflow REJECTION with the DETAIL count", async () => {
    rpcResult = {
      data: null,
      error: { message: "has_upcoming_events", details: "3" },
    };
    const result = await cancelPendingLink("l1");
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reason).toBe("has_upcoming_events");
      expect(result.upcomingEventCount).toBe(3);
    }
    expect(rpcCalls[0]).toEqual({
      name: "partner_cancel_pending_link",
      args: { p_link_id: "l1" },
    });
  });

  test("cancelPendingLink success carries the quad-outcome flags", async () => {
    rpcResult = {
      data: {
        link_id: "l1",
        brand_id: "b1",
        brand_deleted: true,
        invitation_revoked: true,
      },
      error: null,
    };
    const result = await cancelPendingLink("l1");
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.brandDeleted).toBe(true);
      expect(result.invitationRevoked).toBe(true);
      expect(result.brandId).toBe("b1");
    }
  });

  test("cancelPendingLink throws typed codes (link_not_pending)", async () => {
    rpcResult = { data: null, error: { message: "link_not_pending" } };
    await expect(cancelPendingLink("l1")).rejects.toThrow("link_not_pending");
  });

  test("disconnectLink calls the RPC and throws typed codes", async () => {
    rpcResult = { data: { link_id: "l1" }, error: null };
    await disconnectLink("l1");
    expect(rpcCalls[0]).toEqual({
      name: "partner_disconnect_link",
      args: { p_link_id: "l1" },
    });
    rpcResult = { data: null, error: { message: "link_not_active" } };
    await expect(disconnectLink("l1")).rejects.toThrow("link_not_active");
  });

  test("reissueInvitation invokes the edge fn; omits new_email when absent; parses invoke errors", async () => {
    invokeResult = { data: { invitation_id: "inv-9" }, error: null };
    const ok = await reissueInvitation("l1");
    expect(ok.invitationId).toBe("inv-9");
    expect(invokeCalls[0].name).toBe("partner-reissue-invitation");
    expect(invokeCalls[0].body).toEqual({ link_id: "l1" });

    await reissueInvitation("l1", "new@example.com");
    expect(invokeCalls[1].body).toEqual({
      link_id: "l1",
      new_email: "new@example.com",
    });

    invokeResult = {
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { body: JSON.stringify({ error: "email_send_failed" }) },
      },
    };
    await expect(reissueInvitation("l1")).rejects.toThrow("email_send_failed");
  });
});
