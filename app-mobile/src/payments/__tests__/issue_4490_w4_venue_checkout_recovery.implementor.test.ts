// @ts-nocheck
/**
 * #4490 Explorer W4 — the venue recovery pointer (rule 4, Constitution 6) and
 * the payment leg with stubs for the browser, the card sheet, the store and
 * the server (rules 3, 4, 5).
 *
 *   V-*  pointer: own key, strict parser (extra fields refused), no token or
 *        URL, expiry = holdUntil capped at 24 h, sign-out deletes it, the
 *        ticket pointer key untouched
 *   R-*  recovery on start / Purchases focus: live + own → one call then
 *        cleared; foreign → cleared with no call; expired → cleared; no answer
 *        → kept
 *   L-*  the payment leg: pointer written BEFORE the page opens, page held by
 *        id + key, polls stop on a verdict, pending after the polls keeps the
 *        pointer, already paid → re-read success, already pending → polls,
 *        "abandoned" while the page may be open is not a verdict, Stripe
 *        cancel = not paid, sign-out mid-flow aborts
 *
 * FAILS-ON-REVERT: drop the venue key from `purgeNativeCheckoutRecovery` and
 * V-5 fails; write the pointer after `openBrowser` and L-1 fails; let the
 * parser accept extra fields and V-2 fails.
 */
const mockSecure = new Map<string, string>();
const mockSecureGet = jest.fn(async (k: string) => (mockSecure.has(k) ? mockSecure.get(k) : null));
const mockSecureSet = jest.fn(async (k: string, v: string) => {
  mockSecure.set(k, v);
});
const mockSecureDelete = jest.fn(async (k: string) => {
  mockSecure.delete(k);
});

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: (k: string) => mockSecureGet(k),
  secureSetItem: (k: string, v: string) => mockSecureSet(k, v),
  secureDeleteItem: (k: string) => mockSecureDelete(k),
}));
jest.mock("../../services/postHogService", () => ({ postHogService: { capture: () => undefined } }));
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

import {
  clearAllHeldHandoffs,
  readHeldHandoff,
} from "@mingla/payments-native/paystackHeldHandoff";

import {
  clearVenueCheckoutRecoveryFor,
  createVenueCheckoutRecoveryPointer,
  parseVenueCheckoutRecoveryPointer,
  persistVenueCheckoutRecovery,
  purgeNativeCheckoutRecovery,
  readVenueCheckoutRecovery,
} from "../nativeCheckoutRecovery";
import {
  pollVenueConfirm,
  recoverVenueCheckout,
  runVenuePayment,
} from "../venueOfferCheckoutRunner";

const VENUE_KEY = "mingla_venue_checkout_recovery_v1";
const TICKET_KEY = "mingla_checkout_recovery_v1";
const GROUP = "00000000-4490-4000-8000-0000000004b1";
const SUB = "00000000-4490-4000-8000-0000000004c1";
const ACCOUNT = "account-4490";
const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const HOLD = "2026-11-22T12:15:00.000Z";
const PAY_URL = "https://checkout.paystack.test/w4-secret-page";

const pointer = (over = {}) =>
  createVenueCheckoutRecoveryPointer({
    kind: "venue_offer",
    id: GROUP,
    accountId: ACCOUNT,
    provider: "paystack",
    holdUntil: HOLD,
    now: NOW,
    ...over,
  });

beforeEach(() => {
  mockSecure.clear();
  jest.clearAllMocks();
  clearAllHeldHandoffs();
});

describe("V: the venue pointer", () => {
  it("V-1 shape: ids and expiry only (no token, no URL); expiry = holdUntil", () => {
    const p = pointer();
    expect(Object.keys(p).sort()).toEqual(["accountId", "createdAt", "expiresAt", "id", "kind", "provider", "version"]);
    expect(p.expiresAt).toBe(Date.parse(HOLD));
    expect(JSON.stringify(p)).not.toContain("http");
    expect(JSON.stringify(p)).not.toContain("token");
  });

  it("V-2 the parser is strict: extra fields, bad kind, non-uuid id, over-TTL, expiry before creation are refused", () => {
    const good = JSON.stringify(pointer());
    expect(parseVenueCheckoutRecoveryPointer(good)).toEqual(pointer());
    const bad = [
      { ...pointer(), buyerStatusToken: "t" },
      { ...pointer(), authorizationUrl: PAY_URL },
      { ...pointer(), kind: "ticket" },
      { ...pointer(), id: "not-a-uuid" },
      { ...pointer(), version: 2 },
      { ...pointer(), provider: "cash" },
      { ...pointer(), expiresAt: NOW + 25 * 60 * 60 * 1000 },
      { ...pointer(), expiresAt: NOW - 1 },
      { ...pointer(), accountId: "" },
    ];
    for (const row of bad) expect(parseVenueCheckoutRecoveryPointer(JSON.stringify(row))).toBeNull();
    expect(parseVenueCheckoutRecoveryPointer("{")).toBeNull();
    expect(parseVenueCheckoutRecoveryPointer("[]")).toBeNull();
    expect(parseVenueCheckoutRecoveryPointer(null)).toBeNull();
  });

  it("V-3 expiry: capped at 24 h; no hold → 24 h; a hold already run out → no pointer", () => {
    expect(pointer({ holdUntil: "2026-11-30T00:00:00Z" }).expiresAt).toBe(NOW + 24 * 60 * 60 * 1000);
    expect(pointer({ holdUntil: null }).expiresAt).toBe(NOW + 24 * 60 * 60 * 1000);
    expect(pointer({ holdUntil: "2026-11-22T11:59:00Z" })).toBeNull();
  });

  it("V-4 own key: written under mingla_venue_checkout_recovery_v1, the ticket key untouched", async () => {
    mockSecure.set(TICKET_KEY, "ticket-pointer");
    await persistVenueCheckoutRecovery(pointer());
    expect(mockSecure.get(VENUE_KEY)).toBe(JSON.stringify(pointer()));
    expect(mockSecure.get(TICKET_KEY)).toBe("ticket-pointer");
    await clearVenueCheckoutRecoveryFor(GROUP);
    expect(mockSecure.has(VENUE_KEY)).toBe(false);
    expect(mockSecure.get(TICKET_KEY)).toBe("ticket-pointer");
  });

  it("V-5 sign-out (purgeNativeCheckoutRecovery) deletes the venue pointer too", async () => {
    await persistVenueCheckoutRecovery(pointer());
    await purgeNativeCheckoutRecovery();
    expect(mockSecure.has(VENUE_KEY)).toBe(false);
    expect(mockSecureDelete).toHaveBeenCalledWith(VENUE_KEY);
  });

  it("V-6 clearFor deletes only this booking's pointer", async () => {
    await persistVenueCheckoutRecovery(pointer());
    await clearVenueCheckoutRecoveryFor("00000000-4490-4000-8000-000000000999");
    expect(mockSecure.has(VENUE_KEY)).toBe(true);
  });

  it("V-7 read: an expired or unreadable pointer is deleted and reads as none", async () => {
    await persistVenueCheckoutRecovery(pointer());
    expect(await readVenueCheckoutRecovery(NOW + 1000)).toEqual(pointer());
    expect(await readVenueCheckoutRecovery(Date.parse(HOLD) + 1)).toBeNull();
    expect(mockSecure.has(VENUE_KEY)).toBe(false);
    mockSecure.set(VENUE_KEY, "{not json");
    expect(await readVenueCheckoutRecovery(NOW)).toBeNull();
    expect(mockSecure.has(VENUE_KEY)).toBe(false);
  });
});

describe("R: recovery on app start and Purchases focus", () => {
  const deps = (over = {}) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        readPointer: async () => pointer(),
        clearPointer: async () => {
          calls.push("clear");
        },
        confirmOffer: async (id: string) => {
          calls.push(`confirm:${id}`);
          return {};
        },
        readMember: async (id: string) => {
          calls.push(`member:${id}`);
          return {};
        },
        onAnswered: () => calls.push("refresh"),
        ...over,
      },
    };
  };

  it("R-1 a live pointer for this account: confirm_return once, then cleared and Purchases refreshed", async () => {
    const { calls, d } = deps();
    expect(await recoverVenueCheckout(d, ACCOUNT)).toBe("answered");
    expect(calls).toEqual([`confirm:${GROUP}`, "clear", "refresh"]);
  });

  it("R-2 a plan pointer reads the plan (membership_get)", async () => {
    const { calls, d } = deps({ readPointer: async () => pointer({ kind: "venue_membership", id: SUB }) });
    await recoverVenueCheckout(d, ACCOUNT);
    expect(calls[0]).toBe(`member:${SUB}`);
  });

  it("R-3 another account's pointer is cleared with no call", async () => {
    const { calls, d } = deps();
    expect(await recoverVenueCheckout(d, "someone-else")).toBe("foreign");
    expect(calls).toEqual(["clear"]);
  });

  it("R-4 no answer keeps the pointer; signed out does nothing", async () => {
    const { calls, d } = deps({
      confirmOffer: async () => {
        throw { code: "venue_unreachable" };
      },
    });
    expect(await recoverVenueCheckout(d, ACCOUNT)).toBe("no_answer");
    expect(calls).toEqual([]);
    expect(await recoverVenueCheckout(deps().d, null)).toBe("none");
  });

  it("R-5 not found / not yours clears without retrying forever", async () => {
    const { calls, d } = deps({
      confirmOffer: async () => {
        throw { code: "offer_booking_not_found" };
      },
    });
    expect(await recoverVenueCheckout(d, ACCOUNT)).toBe("answered");
    expect(calls).toEqual(["clear"]);
  });
});

describe("L: the payment leg", () => {
  const harness = (script: { pay?: () => Promise<unknown>; confirm?: string[]; read?: unknown; open?: () => Promise<unknown>; pageReturn?: string; stripe?: unknown } = {}) => {
    const events: string[] = [];
    const confirms = [...(script.confirm ?? ["confirmed"])];
    const deps = {
      server: {
        pay: async (input) => {
          events.push(`pay:${input.idempotencyKey}:${input.payMode ?? "server"}`);
          if (script.pay) return script.pay();
          return { provider: "paystack", authorizationUrl: PAY_URL };
        },
        confirm: async () => {
          const next = confirms.length > 1 ? confirms.shift() : confirms[0];
          events.push(`confirm:${next}`);
          if (next === "throw") throw { code: "venue_unreachable" };
          if (next === "expired") throw { code: "offer_hold_expired" };
          return { outcome: next, raw: { state: next === "confirmed" ? "confirmed" : "instant_payment_pending" } };
        },
        read: async () => {
          events.push("read");
          return script.read ?? { state: "confirmed" };
        },
      },
      openBrowser: async (url: string) => {
        events.push(`open:${url === PAY_URL ? "page" : "other"}`);
        if (script.open) return script.open();
        return { type: "dismiss" };
      },
      waitForClosed: async () => {
        events.push("waited");
        return script.pageReturn ?? "closed";
      },
      stripe: script.stripe ?? null,
      createPointer: createVenueCheckoutRecoveryPointer,
      persistPointer: async (p) => {
        events.push(`pointer:${p.id}`);
        return persistVenueCheckoutRecovery(p);
      },
      clearPointerFor: async (id: string) => {
        events.push("pointer-cleared");
        return clearVenueCheckoutRecoveryFor(id);
      },
      sleep: async () => {
        events.push("sleep");
      },
      now: () => NOW,
      pollMaxAttempts: 4,
    };
    return { deps, events };
  };
  const input = (over = {}) => ({
    target: "venue_offer",
    id: GROUP,
    expectedVersion: 2,
    idempotencyKey: "pay-key-0001",
    payMode: null,
    accountId: ACCOUNT,
    holdUntil: HOLD,
    ...over,
  });

  it("L-1 rule 4: the pointer is written BEFORE the page opens; confirmed clears it", async () => {
    const { deps, events } = harness();
    const result = await runVenuePayment(deps, input());
    expect(result).toEqual({ kind: "outcome", outcome: "confirmed", raw: { state: "confirmed" } });
    expect(events.indexOf(`pointer:${GROUP}`)).toBeLessThan(events.indexOf("open:page"));
    expect(events.slice(-1)[0]).toBe("pointer-cleared");
    expect(mockSecure.has(VENUE_KEY)).toBe(false);
  });

  it("L-2 polls stop on the first verdict and sleep between asks", async () => {
    const { deps, events } = harness({ confirm: ["pending", "throw", "failed"] });
    const result = await runVenuePayment(deps, input());
    expect(result.outcome).toBe("failed");
    expect(events.filter((e) => e.startsWith("confirm:"))).toEqual(["confirm:pending", "confirm:throw", "confirm:failed"]);
    expect(events.filter((e) => e === "sleep").length).toBe(2);
  });

  it("L-3 still pending after every poll → pending; the pointer stays for recovery", async () => {
    const { deps, events } = harness({ confirm: ["pending"] });
    const result = await runVenuePayment(deps, input());
    expect(result.outcome).toBe("pending");
    expect(events.filter((e) => e.startsWith("confirm:")).length).toBe(4);
    expect(events).not.toContain("pointer-cleared");
    expect(mockSecure.has(VENUE_KEY)).toBe(true);
  });

  it("L-4 offer_payment_already_paid: no page, re-read, confirmed", async () => {
    const { deps, events } = harness({
      pay: async () => {
        throw { code: "offer_payment_already_paid" };
      },
    });
    const result = await runVenuePayment(deps, input());
    expect(result.outcome).toBe("confirmed");
    expect(events).toContain("read");
    expect(events.some((e) => e.startsWith("open:"))).toBe(false);
  });

  it("L-5 offer_payment_already_pending: no page, the polls decide", async () => {
    const { deps, events } = harness({
      pay: async () => {
        throw { code: "offer_payment_already_pending" };
      },
      confirm: ["confirmed"],
    });
    expect((await runVenuePayment(deps, input())).outcome).toBe("confirmed");
    expect(events.some((e) => e.startsWith("open:"))).toBe(false);
  });

  it("L-6 any other pay refusal is the step's error (no page, no pointer)", async () => {
    const { deps, events } = harness({
      pay: async () => {
        throw { code: "offers_not_enabled" };
      },
    });
    expect(await runVenuePayment(deps, input())).toEqual({ kind: "error", code: "offers_not_enabled" });
    expect(events.some((e) => e.startsWith("pointer:"))).toBe(false);
  });

  it("L-7 hold ran out at pay or during the polls → expired", async () => {
    const atPay = harness({ pay: async () => { throw { code: "offer_hold_expired" }; } });
    expect((await runVenuePayment(atPay.deps, input())).outcome).toBe("expired");
    const inPolls = harness({ confirm: ["expired"] });
    expect((await runVenuePayment(inPolls.deps, input())).outcome).toBe("expired");
  });

  it("L-8 'abandoned' while the page may still be open is not read as leaving", async () => {
    const { deps } = harness({ open: async () => ({ type: "opened" }), pageReturn: "unconfirmed", confirm: ["not_paid", "not_paid", "confirmed"] });
    expect((await runVenuePayment(deps, input())).outcome).toBe("confirmed");
    const closed = harness({ confirm: ["not_paid"] });
    expect((await runVenuePayment(closed.deps, input())).outcome).toBe("not_paid");
  });

  it("L-9 the page is held by booking id + key: a retry with the same key reopens it without a second pay", async () => {
    const first = harness({ open: async () => ({ type: "locked" }) });
    expect(await runVenuePayment(first.deps, input())).toEqual({ kind: "error", code: "offer_payment_unavailable" });
    expect(readHeldHandoff(GROUP, "pay-key-0001")).not.toBeNull();
    const retry = harness();
    await runVenuePayment(retry.deps, input());
    expect(retry.events.some((e) => e.startsWith("pay:"))).toBe(false);
    expect(retry.events).toContain("open:page");
    // A new key (Try again after a failed payment) never reuses it.
    const fresh = harness();
    await runVenuePayment(fresh.deps, input({ idempotencyKey: "pay-key-0002" }));
    expect(fresh.events).toContain("pay:pay-key-0002:server");
  });

  it("L-10 a browser that throws: the page was never shown; nothing held, pointer cleared", async () => {
    const { deps, events } = harness({ open: async () => { throw new Error("no browser"); } });
    expect(await runVenuePayment(deps, input())).toEqual({ kind: "error", code: "offer_payment_unavailable" });
    expect(events).toContain("pointer-cleared");
    expect(readHeldHandoff(GROUP, "pay-key-0001")).toBeNull();
  });

  it("L-11 Stripe: sheet on the venue's account, then polls; closing the sheet = not paid", async () => {
    const stripeCalls: string[] = [];
    const session = { provider: "stripe", clientSecret: "pi_secret", publishableKey: "pk_test", stripeAccountId: "acct_1", amountMinor: 100, currencyCode: "USD" };
    const ok = harness({
      pay: async () => session,
      stripe: {
        init: async (s) => {
          stripeCalls.push(`init:${s.stripeAccountId}`);
          return {};
        },
        present: async () => {
          stripeCalls.push("present");
          return {};
        },
      },
    });
    expect((await runVenuePayment(ok.deps, input())).outcome).toBe("confirmed");
    expect(stripeCalls).toEqual(["init:acct_1", "present"]);
    expect(ok.events.indexOf(`pointer:${GROUP}`)).toBeLessThan(ok.events.indexOf("confirm:confirmed"));
    const cancelled = harness({
      pay: async () => session,
      stripe: { init: async () => ({}), present: async () => ({ error: { code: "Canceled" } }) },
    });
    expect((await runVenuePayment(cancelled.deps, input())).outcome).toBe("not_paid");
    const noSheet = harness({ pay: async () => session });
    expect(await runVenuePayment(noSheet.deps, input())).toEqual({ kind: "error", code: "offer_payment_unavailable" });
  });

  it("L-12 sign-out mid-flow aborts: nothing more is done for the account that left", async () => {
    const { deps, events } = harness({
      open: async () => {
        clearAllHeldHandoffs(); // what sign-out does (bumps the generation)
        return { type: "dismiss" };
      },
    });
    expect(await runVenuePayment(deps, input())).toEqual({ kind: "aborted" });
    expect(events.some((e) => e.startsWith("confirm:"))).toBe(false);
  });

  it("L-13 a plan's first payment: membership target, confirmed when the plan reads active", async () => {
    const { deps } = harness({ confirm: ["nothing_to_confirm"] });
    deps.server.confirm = async () => ({ outcome: "nothing_to_confirm", raw: { status: "active" } });
    expect((await runVenuePayment(deps, input({ target: "venue_membership", id: SUB, holdUntil: null }))).outcome).toBe("confirmed");
  });

  it("L-14 a listener that throws never breaks the payment", async () => {
    const { deps } = harness();
    const result = await runVenuePayment(deps, {
      ...input(),
      onSession: () => {
        throw new Error("ui bug");
      },
      onPageClosed: () => {
        throw new Error("ui bug");
      },
    });
    expect(result.outcome).toBe("confirmed");
  });

  it("L-15 pollVenueConfirm alone: nothing_to_confirm with a confirmed read is confirmed", async () => {
    const out = await pollVenueConfirm(
      { server: { confirm: async () => ({ outcome: "nothing_to_confirm", raw: { state: "confirmed" } }) }, sleep: async () => undefined, pollMaxAttempts: 2 },
      "venue_offer",
      GROUP,
    );
    expect(out.outcome).toBe("confirmed");
  });
});
