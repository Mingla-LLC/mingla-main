/**
 * #4271 integration — the client/server hand-offs between the three lanes.
 *
 * Pins:
 *  1. "Show a pay code instead" cancels the open PaymentIntent on the server
 *     (door-tap-intent cancel {paymentIntentId, clientRequestId}) BEFORE the
 *     pay code is made; a failed cancel is reported and never blocks the code;
 *     a PaymentIntent that already succeeded is recorded, never replaced.
 *  2. Tap setup fetches the brand's Terminal Location (door-tap-intent
 *     location) and connects the reader there during setup, so Apple's terms
 *     and How to Tap run before the first sale.
 *  3. The exact request/response shapes the server lane ships: location,
 *     cancel, refusal codes (payment_succeeded, tap_not_available with
 *     reason address_missing), text_link 429, team-names 42501.
 *
 * fails-on-revert: deleting the cancelIntent call (or calling it after the
 * code is made), dropping the location fetch / reader connect from setup,
 * dropping payment_succeeded from the known codes, or reading only `detail`
 * off a refusal fails an assertion here.
 */
import fs from "node:fs";
import path from "node:path";
import { Platform } from "react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();
const mockRpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<unknown>>();

jest.mock("../../supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
    rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
  },
}));

import {
  cancelDoorTapIntent,
  DoorTapError,
  fetchDoorTapLocation,
  type DoorTapIntent,
} from "../doorTapEdge";
import {
  TapToPaySaleFlow,
  type TapToPayServer,
  type TapToPayTerminalClient,
} from "../tapToPayFlow";
import { runTapToPaySetup, type TapToPaySetupDeps } from "../tapToPaySetup";
import { doorPayTextLinkErrorMessage } from "../../../components/door/doorPayCodeState";
import { listBrandTeamMemberDirectory } from "../../brandTeamDirectoryService";

const BIZ_ROOT = path.join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

/** A FunctionsHttpError as supabase-js hands it back (context is the Response). */
const httpError = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: {
    message: "Edge Function returned a non-2xx status code",
    context: { status, text: async () => JSON.stringify(body), json: async () => body },
  },
});

const INTENT: DoorTapIntent = {
  paymentIntentId: "pi_123",
  clientSecret: "pi_123_secret_abc",
  totalCents: 3000,
  currency: "GBP",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

// ---- 1. Show a pay code instead --------------------------------------------

const makeFlow = (opts: {
  cancelIntent?: TapToPayServer["cancelIntent"];
  confirmSucceeds?: boolean;
} = {}) => {
  const calls: string[] = [];
  const report = jest.fn();
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: async () => ({}),
    retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_123", status: "requires_payment_method" } }),
    // A guest who never taps: the collect is pending until cancelled.
    collectPaymentMethod: async () => {
      calls.push("collect");
      return { error: { code: "CANCELED" } };
    },
    confirmPaymentIntent: async () => ({ paymentIntent: { id: "pi_123", status: "succeeded" } }),
    cancelCollectPaymentMethod: async () => {
      calls.push("cancel_collect");
      return {};
    },
  };
  const server: TapToPayServer = {
    createIntent: async () => {
      calls.push("create");
      return INTENT;
    },
    completeIntent: async (input) => {
      calls.push(`complete:${input.paymentIntentId}:${input.clientRequestId}`);
      return { orderId: "ord_1", ticketIds: [], receiptQueued: false, replayed: true };
    },
    cancelIntent:
      opts.cancelIntent ??
      (async (input) => {
        calls.push(`cancel_intent:${input.paymentIntentId}:${input.clientRequestId}`);
      }),
  };
  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft: { lines: [{ ticketTypeId: "tt", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null },
    clientRequestId: "req-1",
    terminal,
    server,
    onState: () => {},
    report,
  });
  return { flow, calls, report };
};

describe("Show a pay code instead cancels the open PaymentIntent first", () => {
  test("cancel is sent with the intent's ids; the switch goes ahead", async () => {
    const h = makeFlow();
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("cancelled");
    await expect(h.flow.abandonForPayCode()).resolves.toBe("switch");
    expect(h.calls).toContain("cancel_intent:pi_123:req-1");
    expect(h.calls.filter((c) => c.startsWith("complete"))).toEqual([]);
  });

  test("a failed cancel is reported and does not block the pay code", async () => {
    const h = makeFlow({
      cancelIntent: async () => {
        throw new DoorTapError("network_error", "offline");
      },
    });
    await h.flow.start();
    await expect(h.flow.abandonForPayCode()).resolves.toBe("switch");
    expect(h.report).toHaveBeenCalledWith(
      "door-tap.cancel-intent",
      expect.any(DoorTapError),
      expect.objectContaining({ payment_intent_id: "pi_123", code: "network_error" }),
    );
  });

  test("payment_succeeded: the tap is recorded and no pay code is made", async () => {
    const h = makeFlow({
      cancelIntent: async () => {
        throw new DoorTapError("payment_succeeded");
      },
    });
    await h.flow.start();
    await expect(h.flow.abandonForPayCode()).resolves.toBe("already_paid");
    expect(h.calls).toContain("complete:pi_123:req-1");
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.report).not.toHaveBeenCalled();
  });

  test("no intent yet: nothing to cancel, switch", async () => {
    const h = makeFlow();
    await expect(h.flow.abandonForPayCode()).resolves.toBe("switch");
    expect(h.calls).toEqual([]);
  });

  test("the sale screen cancels BEFORE it creates the pay code", () => {
    const src = read("src/components/door/tap/TapToPaySaleScreen.tsx");
    const body = src.slice(src.indexOf("const showPayCodeInstead"));
    const abandonAt = body.indexOf("abandonForPayCode()");
    const createAt = body.indexOf("createDoorPayCodeForLines(");
    expect(abandonAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(abandonAt);
    expect(body.slice(0, createAt)).toContain('if (outcome === "already_paid" || outcome === "blocked") return;');
    expect(src).toContain("cancelIntent: cancelDoorTapIntent");
  });
});

// ---- 2. Setup connects the reader at the brand's Location -------------------

const makeSetup = (over: Partial<TapToPaySetupDeps> = {}) => {
  const calls: string[] = [];
  const deps: TapToPaySetupDeps = {
    os: "ios",
    checkDeviceSupport: async () => {
      calls.push("support");
      return { supported: true };
    },
    fetchLocation: async () => {
      calls.push("location");
      return "tml_brand_gb";
    },
    ensureReaderConnected: async (locationId) => {
      calls.push(`connect:${locationId}`);
      return {};
    },
    showHowToTap: async () => {
      calls.push("how_to_tap");
      return "shown";
    },
    markComplete: async () => {
      calls.push("mark");
    },
    ...over,
  };
  return { deps, calls };
};

describe("Tap setup runs Apple's terms and How to Tap before the first sale", () => {
  test("iPhone: device check → location → reader connect → How to Tap → done", async () => {
    const h = makeSetup();
    await expect(runTapToPaySetup(h.deps)).resolves.toEqual({ kind: "done", locationId: "tml_brand_gb" });
    expect(h.calls).toEqual(["support", "location", "connect:tml_brand_gb", "how_to_tap", "mark"]);
  });

  test("Android: same order without Apple's education", async () => {
    const h = makeSetup({ os: "android" });
    await runTapToPaySetup(h.deps);
    expect(h.calls).toEqual(["support", "location", "connect:tml_brand_gb", "mark"]);
  });

  test("an unsupported phone never asks the server for a Location", async () => {
    const h = makeSetup({ checkDeviceSupport: async () => ({ supported: false }) });
    await expect(runTapToPaySetup(h.deps)).resolves.toEqual({ kind: "device_rejected" });
    expect(h.calls).toEqual([]);
  });

  test("tap_not_available address_missing → tells the host to add the address; not marked done", async () => {
    const h = makeSetup({
      fetchLocation: async () => {
        throw new DoorTapError("tap_not_available", "address_missing");
      },
    });
    const result = await runTapToPaySetup(h.deps);
    expect(result).toEqual({ kind: "failed", message: expect.stringContaining("brand's full address") });
    expect(h.calls).toEqual(["support"]);
  });

  test("tap_not_available (paystack / country) → not available", async () => {
    const h = makeSetup({
      fetchLocation: async () => {
        throw new DoorTapError("tap_not_available");
      },
    });
    await expect(runTapToPaySetup(h.deps)).resolves.toEqual({ kind: "not_available" });
  });

  test("a reader connect failure (terms declined) is not marked done", async () => {
    const h = makeSetup({
      ensureReaderConnected: async () => ({ error: { code: "STRIPE_API_ERROR", message: "tos not accepted" } }),
    });
    const result = await runTapToPaySetup(h.deps);
    expect(result.kind).toBe("failed");
    expect(h.calls).not.toContain("mark");
    expect(h.calls).not.toContain("how_to_tap");
  });

  test("a device-class connect error → this phone can't take taps", async () => {
    const h = makeSetup({
      ensureReaderConnected: async () => ({ error: { code: "TAP_TO_PAY_UNSUPPORTED_DEVICE" } }),
    });
    await expect(runTapToPaySetup(h.deps)).resolves.toEqual({ kind: "device_rejected" });
  });

  test("the setup screen wires the server Location and the shared reader session", () => {
    const src = read("src/components/door/tap/TapToPaySetupScreen.tsx");
    expect(src).toContain("runTapToPaySetup({");
    expect(src).toContain("fetchLocation: () => fetchDoorTapLocation({ brandId, eventId })");
    expect(src).toContain("client.ensureReaderConnected(locationId, { mayAcceptTerms: allowTerms })");
  });
});

// ---- 3. Wire shapes ---------------------------------------------------------

describe("door-tap-intent wire shapes match the server", () => {
  test("location sends {action:'location', eventId} and reads locationId", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { locationId: "tml_9" }, error: null });
    await expect(fetchDoorTapLocation({ brandId: null, eventId: "evt_1" })).resolves.toBe("tml_9");
    expect(mockInvoke).toHaveBeenCalledWith("door-tap-intent", {
      body: { action: "location", eventId: "evt_1", platform: Platform.OS },
    });
  });

  test("cancel sends {action:'cancel', paymentIntentId, clientRequestId} and needs status cancelled", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { status: "cancelled" }, error: null });
    await cancelDoorTapIntent({ paymentIntentId: "pi_1", clientRequestId: "req-1" });
    expect(mockInvoke).toHaveBeenCalledWith("door-tap-intent", {
      body: { action: "cancel", paymentIntentId: "pi_1", clientRequestId: "req-1" },
    });
    mockInvoke.mockResolvedValueOnce({ data: { status: "open" }, error: null });
    await expect(cancelDoorTapIntent({ paymentIntentId: "pi_1", clientRequestId: "req-1" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  test("409 payment_succeeded is a known refusal, not 'unknown'", async () => {
    mockInvoke.mockResolvedValueOnce(httpError(409, { error: "payment_succeeded" }));
    await expect(cancelDoorTapIntent({ paymentIntentId: "pi_1", clientRequestId: "req-1" })).rejects.toMatchObject({
      code: "payment_succeeded",
    });
  });

  test("tap_not_available carries the server's reason as detail", async () => {
    mockInvoke.mockResolvedValueOnce(httpError(400, { error: "tap_not_available", reason: "address_missing" }));
    await expect(fetchDoorTapLocation({ brandId: null, eventId: "evt_1" })).rejects.toMatchObject({
      code: "tap_not_available",
      detail: "address_missing",
    });
  });
});

describe("door-pay-code text_link refusals", () => {
  test("429 text_link_limit_reached says the code was texted 3 times", () => {
    expect(doorPayTextLinkErrorMessage({ code: "text_link_limit_reached", status: 429 })).toContain("3 times");
    expect(doorPayTextLinkErrorMessage({ code: "buyer_phone_invalid", status: 400 })).toContain("doesn't look right");
    expect(doorPayTextLinkErrorMessage(new Error("x"))).toContain("Couldn't send the link");
  });

  test("the host screen uses that copy", () => {
    expect(read("app/event/[id]/door/pay/[codeId].tsx")).toContain("setError(doorPayTextLinkErrorMessage(sendError));");
  });
});

describe("guest page refusals from ticket-checkout-create", () => {
  test("purchase_terms_required and a not_found 409 each have their own copy", () => {
    const src = read("app/pay/door/[code].tsx");
    expect(src).toContain('error.code === "purchase_terms_required"');
    expect(src).toContain("if (error.codeStatus === null) setCodeInvalid(true);");
  });
});

describe("biz_brand_team_members refusal", () => {
  test("42501 brand_access_denied maps to forbidden", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "brand_access_denied" } });
    await expect(listBrandTeamMemberDirectory("brand-1")).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(mockRpc).toHaveBeenCalledWith("biz_brand_team_members", { p_brand_id: "brand-1" });
  });
});

describe("door_pay_codes realtime binding", () => {
  test("the host screen listens on the UNIQUE code column, never the primary key", () => {
    // Supabase realtime silently drops `id=eq.*` bindings on RLS-gated tables
    // (I-PROPOSED-ORCH-0931): the screen would never turn green on payment.
    const src = read("src/hooks/useDoorPayCodes.ts");
    const hook = src.slice(src.indexOf("export function useDoorPayCode("));
    expect(hook).toContain('table: "door_pay_codes"');
    expect(hook).toContain("filter: `code=eq.${code}`");
    expect(hook).not.toMatch(/filter:\s*`id=eq\./);
  });
});
