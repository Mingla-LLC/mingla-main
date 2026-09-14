/**
 * Issue #3284 — refund terms on events and experiences: the shared policy module.
 *
 * Implementor happy-path regression for spec C1 (`refundPolicyService.ts`):
 *   1. The event/experience presets are the approved numbers and every one passes
 *      a line-for-line JS mirror of the server's `validate_refund_policy`
 *      (20260612000000_tr4_refund_tiers_booking_deadline.sql). The trip presets
 *      are untouched.
 *   2. `realizedRefundPct` applies the server's tier rule: the tier with the largest
 *      `days_before_start <= daysRemaining` wins, otherwise 0; null is 0 everywhere.
 *   3. `setOfferingRefundPolicy` sends exactly the gated writer's arguments and maps
 *      every server outcome to a typed result — including `unavailable` for
 *      PGRST202 and `refund_policy_downgrade_with_sales` with `affectedOrderCount`.
 *   4. The trip writer `updateRefundPolicy` still writes trips only and never
 *      reaches the event/experience RPC.
 *
 * Fails-on-revert: restore the pre-#3284 `refundPolicyService.ts` and this suite
 * fails (the presets, `realizedRefundPct` and `setOfferingRefundPolicy` are gone).
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type RpcReply = { data: unknown; error: { code?: string; message?: string } | null };

const mockRpc = jest.fn<(...args: unknown[]) => Promise<RpcReply>>();
const mockFrom = jest.fn<(...args: unknown[]) => unknown>();
const mockEq = jest.fn<(...args: unknown[]) => unknown>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  EVENT_FLEXIBLE_POLICY,
  EVENT_STANDARD_POLICY,
  EVENT_STRICT_POLICY,
  FLEXIBLE_POLICY,
  NO_REFUNDS_POLICY,
  STANDARD_POLICY,
  STRICT_POLICY,
  realizedRefundPct,
  setOfferingRefundPolicy,
  updateRefundPolicy,
  type RefundPolicy,
} from "../refundPolicyService";

const EVENT_ID = "32840000-0000-4000-8000-000000000001";

/**
 * JS mirror of `public.validate_refund_policy(p_policy jsonb)`, statement for
 * statement. Returns null when the SQL function would return true, or the text of
 * the exception it would RAISE.
 */
function mirrorValidateRefundPolicy(policy: unknown): string | null {
  if (policy === null) return null;
  const record = policy as { kind?: unknown; tiers?: unknown };
  const kind = record.kind;
  if (!["flexible", "standard", "strict", "custom"].includes(String(kind))) {
    return `refund_policy.kind must be flexible|standard|strict|custom (got ${String(kind)})`;
  }
  if (!Array.isArray(record.tiers)) return "refund_policy.tiers must be a JSONB array";
  if (record.tiers.length === 0) return "refund_policy.tiers must contain at least 1 tier";
  if (record.tiers.length > 8) {
    return `refund_policy.tiers max 8 tiers (got ${record.tiers.length})`;
  }
  let prevDays = -1;
  let prevPct = 101;
  for (const raw of record.tiers) {
    const tier = raw as { days_before_start?: unknown; refund_pct?: unknown };
    const days = tier.days_before_start;
    const pct = tier.refund_pct;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0) {
      return `tier days_before_start must be int >= 0 (got ${String(days)})`;
    }
    if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > 100) {
      return `tier refund_pct must be int 0-100 (got ${String(pct)})`;
    }
    if (prevDays >= 0 && days >= prevDays) {
      return `tier days_before_start must be strictly descending (${prevDays} then ${days})`;
    }
    if (pct > prevPct) {
      return `I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY: tier refund_pct must be non-increasing (${prevPct} then ${pct})`;
    }
    prevDays = days;
    prevPct = pct;
  }
  return null;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockEq.mockReset();
});

describe("#3284 event and experience presets", () => {
  test("the four presets carry exactly the approved tiers", () => {
    expect(EVENT_FLEXIBLE_POLICY).toEqual({
      kind: "flexible",
      tiers: [
        { days_before_start: 7, refund_pct: 100 },
        { days_before_start: 2, refund_pct: 50 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    });
    expect(EVENT_STANDARD_POLICY).toEqual({
      kind: "standard",
      tiers: [
        { days_before_start: 14, refund_pct: 100 },
        { days_before_start: 7, refund_pct: 50 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    });
    expect(EVENT_STRICT_POLICY).toEqual({
      kind: "strict",
      tiers: [
        { days_before_start: 30, refund_pct: 100 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    });
    expect(NO_REFUNDS_POLICY).toEqual({
      kind: "custom",
      tiers: [{ days_before_start: 0, refund_pct: 0 }],
    });
  });

  test.each([
    ["EVENT_FLEXIBLE_POLICY", EVENT_FLEXIBLE_POLICY],
    ["EVENT_STANDARD_POLICY", EVENT_STANDARD_POLICY],
    ["EVENT_STRICT_POLICY", EVENT_STRICT_POLICY],
    ["NO_REFUNDS_POLICY", NO_REFUNDS_POLICY],
  ])("%s passes the validate_refund_policy mirror", (_name, preset) => {
    expect(mirrorValidateRefundPolicy(preset)).toBeNull();
  });

  test("the mirror is not vacuous: it refuses each shape the SQL validator refuses", () => {
    expect(mirrorValidateRefundPolicy({ kind: "lenient", tiers: [] })).toMatch(/kind must be/);
    expect(mirrorValidateRefundPolicy({ kind: "custom", tiers: {} })).toMatch(/JSONB array/);
    expect(mirrorValidateRefundPolicy({ kind: "custom", tiers: [] })).toMatch(/at least 1 tier/);
    expect(
      mirrorValidateRefundPolicy({
        kind: "custom",
        tiers: Array.from({ length: 9 }, (_, i) => ({ days_before_start: 9 - i, refund_pct: 0 })),
      }),
    ).toMatch(/max 8 tiers/);
    expect(
      mirrorValidateRefundPolicy({ kind: "custom", tiers: [{ days_before_start: -1, refund_pct: 0 }] }),
    ).toMatch(/days_before_start must be int >= 0/);
    expect(
      mirrorValidateRefundPolicy({ kind: "custom", tiers: [{ days_before_start: 1, refund_pct: 101 }] }),
    ).toMatch(/refund_pct must be int 0-100/);
    expect(
      mirrorValidateRefundPolicy({
        kind: "custom",
        tiers: [
          { days_before_start: 2, refund_pct: 50 },
          { days_before_start: 2, refund_pct: 50 },
        ],
      }),
    ).toMatch(/strictly descending/);
    expect(
      mirrorValidateRefundPolicy({
        kind: "custom",
        tiers: [
          { days_before_start: 7, refund_pct: 50 },
          { days_before_start: 2, refund_pct: 80 },
        ],
      }),
    ).toMatch(/MONOTONICITY/);
  });

  test("presets are ordered most to least generous at every threshold", () => {
    for (let days = -1; days <= 40; days += 1) {
      const flexible = realizedRefundPct(EVENT_FLEXIBLE_POLICY, days);
      const standard = realizedRefundPct(EVENT_STANDARD_POLICY, days);
      const strict = realizedRefundPct(EVENT_STRICT_POLICY, days);
      const none = realizedRefundPct(NO_REFUNDS_POLICY, days);
      expect([days, flexible >= standard, standard >= strict, strict >= none]).toEqual([
        days,
        true,
        true,
        true,
      ]);
    }
  });

  test("the trip presets keep their month-scaled numbers", () => {
    expect(FLEXIBLE_POLICY.tiers.map((t) => t.days_before_start)).toEqual([30, 14, 0]);
    expect(STANDARD_POLICY.tiers.map((t) => t.days_before_start)).toEqual([60, 30, 0]);
    expect(STRICT_POLICY.tiers.map((t) => t.days_before_start)).toEqual([90, 0]);
  });
});

describe("#3284 realizedRefundPct uses the server tier rule", () => {
  test.each<[string, RefundPolicy | null, number, number]>([
    ["Flexible, 10 days out", EVENT_FLEXIBLE_POLICY, 10, 100],
    ["Flexible, exactly 7 days out", EVENT_FLEXIBLE_POLICY, 7, 100],
    ["Flexible, 6 days out", EVENT_FLEXIBLE_POLICY, 6, 50],
    ["Flexible, 6.5 days out (whole-day floor gives the same tier)", EVENT_FLEXIBLE_POLICY, 6.5, 50],
    ["Flexible, exactly 2 days out", EVENT_FLEXIBLE_POLICY, 2, 50],
    ["Flexible, 1 day out", EVENT_FLEXIBLE_POLICY, 1, 0],
    ["Flexible, start day", EVENT_FLEXIBLE_POLICY, 0, 0],
    ["Flexible, after the start", EVENT_FLEXIBLE_POLICY, -1, 0],
    ["Standard, 14 days out", EVENT_STANDARD_POLICY, 14, 100],
    ["Standard, 13 days out", EVENT_STANDARD_POLICY, 13, 50],
    ["Standard, 7 days out", EVENT_STANDARD_POLICY, 7, 50],
    ["Standard, 6 days out", EVENT_STANDARD_POLICY, 6, 0],
    ["Strict, 30 days out", EVENT_STRICT_POLICY, 30, 100],
    ["Strict, 29 days out", EVENT_STRICT_POLICY, 29, 0],
    ["No refunds, 365 days out", NO_REFUNDS_POLICY, 365, 0],
    ["no policy, 365 days out", null, 365, 0],
    ["Flexible, NaN days", EVENT_FLEXIBLE_POLICY, Number.NaN, 0],
  ])("%s", (_label, policy, days, expected) => {
    expect(realizedRefundPct(policy, days)).toBe(expected);
  });

  test("the largest qualifying tier wins even if tiers arrive out of order", () => {
    const shuffled: RefundPolicy = {
      kind: "custom",
      tiers: [
        { days_before_start: 0, refund_pct: 0 },
        { days_before_start: 14, refund_pct: 100 },
        { days_before_start: 7, refund_pct: 50 },
      ],
    };
    expect(realizedRefundPct(shuffled, 10)).toBe(50);
    expect(realizedRefundPct(shuffled, 20)).toBe(100);
  });

  test("a policy whose first tier starts later than the time left refunds 0", () => {
    const noZeroTier: RefundPolicy = {
      kind: "custom",
      tiers: [{ days_before_start: 3, refund_pct: 100 }],
    };
    expect(realizedRefundPct(noZeroTier, 2)).toBe(0);
    expect(realizedRefundPct(noZeroTier, 3)).toBe(100);
  });
});

describe("#3284 setOfferingRefundPolicy maps every server outcome", () => {
  test("sends exactly the gated writer's arguments and returns the written terms", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: true, refundPolicy: EVENT_STANDARD_POLICY, changed: true },
      error: null,
    });
    await expect(
      setOfferingRefundPolicy(EVENT_ID, EVENT_STANDARD_POLICY, "Guests asked for clearer terms"),
    ).resolves.toEqual({ ok: true, refundPolicy: EVENT_STANDARD_POLICY });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("business_patch_offering_refund_policy", {
      p_event_id: EVENT_ID,
      p_policy: EVENT_STANDARD_POLICY,
      p_reason: "Guests asked for clearer terms",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("a draft save sends a null reason, and clearing terms returns refundPolicy null", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, refundPolicy: null, changed: true }, error: null });
    await expect(setOfferingRefundPolicy(EVENT_ID, null, null)).resolves.toEqual({
      ok: true,
      refundPolicy: null,
    });
    expect(mockRpc).toHaveBeenCalledWith("business_patch_offering_refund_policy", {
      p_event_id: EVENT_ID,
      p_policy: null,
      p_reason: null,
    });
  });

  test("PGRST202 (the server does not have the function yet) maps to unavailable", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST202",
        message:
          "Could not find the function public.business_patch_offering_refund_policy(p_event_id, p_policy, p_reason) in the schema cache",
      },
    });
    await expect(
      setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null),
    ).resolves.toMatchObject({ ok: false, reason: "unavailable" });
  });

  test("a downgrade after sales carries affectedOrderCount", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, reason: "refund_policy_downgrade_with_sales", affected_order_count: 3 },
      error: null,
    });
    const result = await setOfferingRefundPolicy(
      EVENT_ID,
      EVENT_STRICT_POLICY,
      "Tightening terms after sales",
    );
    expect(result).toEqual({
      ok: false,
      reason: "refund_policy_downgrade_with_sales",
      affectedOrderCount: 3,
    });
  });

  test.each([
    "missing_edit_reason",
    "invalid_edit_reason",
    "offering_not_found",
    "offering_type_not_supported",
    "offering_not_editable_status",
  ])("server reason %s passes through verbatim", async (reason) => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, reason }, error: null });
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, "short")).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  test("an unrecognised server reason is internal_error, never a guessed reason", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false, reason: "something_new" }, error: null });
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null)).resolves.toEqual({
      ok: false,
      reason: "internal_error",
      detail: "something_new",
    });
  });

  test("the RAISEd permission and auth exceptions map to their own reasons", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "insufficient_event_permission" },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, null, null)).resolves.toMatchObject({
      ok: false,
      reason: "insufficient_event_permission",
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "authentication_required" },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, null, null)).resolves.toMatchObject({
      ok: false,
      reason: "authentication_required",
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for function business_patch_offering_refund_policy",
      },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, null, null)).resolves.toMatchObject({
      ok: false,
      reason: "authentication_required",
    });
  });

  test("the shape validator and its CHECK constraint map to policy_invalid", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "refund_policy.tiers must contain at least 1 tier" },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, NO_REFUNDS_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "policy_invalid",
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0001",
        message:
          "I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY: tier refund_pct must be non-increasing (50 then 80)",
      },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, NO_REFUNDS_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "policy_invalid",
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23514",
        message: 'new row for relation "events" violates check constraint "events_refund_policy_valid"',
      },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, NO_REFUNDS_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "policy_invalid",
    });
  });

  test("an unrelated error that merely names the function is not read as bad terms", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42883",
        message: "function public.business_patch_offering_refund_policy(uuid, jsonb, text) does not exist",
      },
    });
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "internal_error",
    });
  });

  test("a request that never reaches the server is network_error", async () => {
    mockRpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null)).resolves.toEqual({
      ok: false,
      reason: "network_error",
      detail: "Failed to fetch",
    });
  });

  test("an unreadable reply is internal_error, never a silent success", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "internal_error",
    });

    mockRpc.mockResolvedValueOnce({ data: { ok: true, refundPolicy: { kind: "flexible" } }, error: null });
    await expect(setOfferingRefundPolicy(EVENT_ID, EVENT_FLEXIBLE_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "internal_error",
    });
  });

  test("a missing event id never calls the server", async () => {
    await expect(setOfferingRefundPolicy("", EVENT_FLEXIBLE_POLICY, null)).resolves.toMatchObject({
      ok: false,
      reason: "offering_not_found",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("#3284 the trip writer stays trip-only", () => {
  test("updateRefundPolicy still scopes its write to event_type trip and never uses the offering RPC", async () => {
    interface UpdateChain {
      update: (...args: unknown[]) => UpdateChain;
      eq: (...args: unknown[]) => UpdateChain;
      select: (...args: unknown[]) => UpdateChain;
      maybeSingle: () => Promise<{ data: { id: string }; error: null }>;
    }
    const chain: UpdateChain = {
      update: () => chain,
      eq: (...args: unknown[]) => {
        mockEq(...args);
        return chain;
      },
      select: () => chain,
      maybeSingle: () => Promise.resolve({ data: { id: EVENT_ID }, error: null }),
    };
    mockFrom.mockReturnValue(chain);
    await expect(updateRefundPolicy(EVENT_ID, STANDARD_POLICY)).resolves.toBeUndefined();
    expect(mockFrom).toHaveBeenCalledWith("events");
    expect(mockEq).toHaveBeenCalledWith("id", EVENT_ID);
    expect(mockEq).toHaveBeenCalledWith("event_type", "trip");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
