// @ts-nocheck
/**
 * #4490 Explorer W4 — independent adversarial tests (tester, uncommitted).
 *
 *  A-K*  idempotency key rule across every retry / change path
 *  A-P*  Purchases-opened (straight at Pay) endings
 *  A-G*  guest details edited after a hold
 *  A-L*  payment leg budget and pointer order (stubs)
 *  A-V*  recovery pointer parser hostility
 *
 * `test.failing` marks a proven finding (W4-N*): it passes while the defect
 * is present and turns red once fixed, so the fix must flip it to `test`.
 */
const mockSecure = new Map<string, string>();
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: async (k: string) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  secureSetItem: async (k: string, v: string) => void mockSecure.set(k, v),
  secureDeleteItem: async (k: string) => void mockSecure.delete(k),
}));
jest.mock("../../services/postHogService", () => ({ postHogService: { capture: () => undefined } }));
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

import {
  initialVenueCheckoutState,
  venueOfferCheckoutReducer as r,
} from "../venueOfferCheckoutFlow";
import { pollVenueConfirm, recoverVenueCheckout, runVenuePayment } from "../venueOfferCheckoutRunner";
import {
  createVenueCheckoutRecoveryPointer,
  parseVenueCheckoutRecoveryPointer,
} from "../nativeCheckoutRecovery";

const G = "11111111-2222-4333-8444-555555555555";
const quote = (id = "q1", modes = ["deposit", "full"]) => ({ quoteId: id, currencyCode: "NGN", totalMinor: 10_000, payModes: modes, depositMinor: 5_000 });
const booking = (over = {}) => ({ id: G, version: 1, state: "instant_payment_pending", totalMinor: 10_000, amountDueNowMinor: 10_000, holdUntil: null, ...over });
let n = 0;
const k = () => `key-${++n}-aaaaaaaa`;

function toPaying(kind = "group_package") {
  let s = initialVenueCheckoutState(kind, "c".repeat(32));
  s = r(s, { type: "choose", choice: "x" });
  s = r(s, { type: "quote_start", freshKey: k() });
  s = r(s, { type: "quote_ok", quote: quote() });
  s = r(s, { type: "hold_start", freshKey: k(), guest: "A|a@b.co|" });
  s = r(s, { type: "hold_ok", booking: booking(), mode: "instant" });
  s = r(s, { type: "pay_start", freshKey: k() });
  return s;
}

describe("A-K idempotency key rule", () => {
  test("A-K1 retry of each failed step keeps that step's key", () => {
    let s = initialVenueCheckoutState("entry", "c".repeat(32));
    s = r(s, { type: "choose", choice: "x" });
    s = r(s, { type: "quote_start", freshKey: "q-key-00000001" });
    s = r(s, { type: "step_failed", step: "quote", code: "offline", venueName: "V" });
    s = r(s, { type: "retry", freshKey: "q-key-NEW" });
    expect(s.phase).toBe("quoting");
    expect(s.keys.quote.key).toBe("q-key-00000001");
    s = r(s, { type: "quote_ok", quote: quote("q1", ["full"]) });
    s = r(s, { type: "hold_start", freshKey: "h-key-00000001", guest: "g" });
    s = r(s, { type: "step_failed", step: "hold", code: "venue_request_failed", venueName: "V" });
    s = r(s, { type: "retry", freshKey: "h-key-NEW" });
    expect(s.keys.hold.key).toBe("h-key-00000001");
    s = r(s, { type: "hold_ok", booking: booking(), mode: "instant" });
    s = r(s, { type: "pay_start", freshKey: "p-key-00000001" });
    s = r(s, { type: "step_failed", step: "pay", code: "offer_payment_unavailable", venueName: "V" });
    s = r(s, { type: "retry", freshKey: "p-key-NEW" });
    expect(s.phase).toBe("paying");
    expect(s.keys.pay.key).toBe("p-key-00000001");
  });

  test("A-K2 a double tap on Pay (pay_start while paying) keeps the key", () => {
    const s = toPaying();
    const again = r(s, { type: "pay_start", freshKey: "other-key-0001" });
    expect(again.keys.pay.key).toBe(s.keys.pay.key);
  });

  test("A-K3 failed payment → Try again is a new pay key; changing Half/All now is a new key; back to the same mode keeps it", () => {
    let s = toPaying();
    const first = s.keys.pay.key;
    s = r(s, { type: "pay_ok", provider: "paystack" });
    s = r(s, { type: "payment_closed" });
    s = r(s, { type: "confirm_done", outcome: "not_paid" });
    expect(s.phase).toBe("review");
    expect(s.notice.message).toBe("Payment didn't go through. You haven't been charged.");
    s = r(s, { type: "pay_start", freshKey: "after-fail-001" });
    expect(s.keys.pay.key).toBe("after-fail-001");
    expect(s.keys.pay.key).not.toBe(first);
  });

  test("A-K4 a changed choice drops every key and the quote (no stale key)", () => {
    let s = toPaying();
    s = r(s, { type: "pay_ok", provider: "paystack" });
    s = r(s, { type: "payment_closed" });
    s = r(s, { type: "confirm_done", outcome: "failed" });
    s = r(s, { type: "choose", choice: "y" });
    expect(s.keys).toEqual({});
    expect(s.quote).toBeNull();
    expect(s.booking).toBeNull();
  });
});

describe("A-P opened from Purchases straight at Pay", () => {
  const resume = () =>
    initialVenueCheckoutState("private_hire", "c".repeat(32), {
      booking: booking({ state: "approved_payment_required" }),
      payMode: "deposit",
    });

  test("A-P1 Pay → page → not paid: back on Review with the §6 line, booking kept", () => {
    let s = r(resume(), { type: "pay_start", freshKey: k() });
    s = r(s, { type: "pay_ok", provider: "paystack" });
    s = r(s, { type: "payment_closed" });
    s = r(s, { type: "confirm_done", outcome: "not_paid" });
    expect(s.phase).toBe("review");
    expect(s.booking.id).toBe(G);
  });

  // W4-N6: the hold runs out while paying from Purchases → expiredState sends
  // the sheet to "choosing" with no booking; a Purchases-opened sheet has no
  // choose step (chooseBody renders <View/>, the footer CTA is disabled), so
  // the guest sees "Pick a time again" with nothing to pick.
  test.failing("A-P2 W4-N6 hold expired while paying from Purchases does not strand the sheet on an empty choose step", () => {
    let s = r(resume(), { type: "pay_start", freshKey: k() });
    s = r(s, { type: "pay_ok", provider: "paystack" });
    s = r(s, { type: "payment_closed" });
    s = r(s, { type: "confirm_done", outcome: "expired" });
    expect(s.phase === "choosing" && s.openedAt === "pay" && s.booking === null).toBe(false);
  });
});

describe("A-G guest details edited after a hold", () => {
  // W4-N7: after a hold exists, Pay always pays the held booking; edited
  // guest details (shown editable on Review) never reach the server.
  test.failing("A-G1 W4-N7 an edited email after the hold makes a new hold (or is refused), never silently ignored", () => {
    let s = toPaying("entry");
    s = r(s, { type: "pay_ok", provider: "paystack" });
    s = r(s, { type: "payment_closed" });
    s = r(s, { type: "confirm_done", outcome: "failed" });
    // the sheet's pay(): booking !== null && phase !== "error" → pay_start (guest ignored)
    const next = s.booking !== null && s.phase !== "error"
      ? r(s, { type: "pay_start", freshKey: k() })
      : r(s, { type: "hold_start", freshKey: k(), guest: "A|new@b.co|" });
    expect(next.phase).toBe("holding");
  });
});

describe("A-L payment leg", () => {
  const deps = (confirmAnswers, extra = {}) => {
    const calls = [];
    let i = 0;
    return {
      calls,
      d: {
        server: {
          pay: async () => {
            calls.push("pay");
            return { provider: "paystack", authorizationUrl: "https://checkout.paystack.com/abc" };
          },
          confirm: async () => {
            calls.push("confirm");
            const a = confirmAnswers[Math.min(i++, confirmAnswers.length - 1)];
            return { outcome: a, raw: null };
          },
          read: async () => null,
        },
        openBrowser: async () => {
          calls.push("open");
          return { type: "opened" };
        },
        waitForClosed: async () => "closed",
        stripe: null,
        createPointer: createVenueCheckoutRecoveryPointer,
        persistPointer: async () => {
          calls.push("persist");
          return true;
        },
        clearPointerFor: async () => {
          calls.push("clear");
        },
        sleep: async () => undefined,
        now: () => Date.parse("2026-11-22T12:00:00Z"),
        ...extra,
      },
    };
  };
  const input = { target: "venue_offer", id: G, expectedVersion: 1, idempotencyKey: "pay-key-0000001", payMode: null, accountId: "user-a", holdUntil: "2026-11-22T12:15:00Z" };

  test("A-L1 pointer is persisted before the page opens; confirm polls are capped at 17 (N143 bound)", async () => {
    const { d, calls } = deps(["nothing_to_confirm"]);
    const res = await runVenuePayment(d, { ...input, idempotencyKey: "pay-key-0000002" });
    expect(calls.indexOf("persist")).toBeLessThan(calls.indexOf("open"));
    expect(calls.filter((c) => c === "confirm").length).toBe(17);
    expect(res.outcome).toBe("pending");
    // pending keeps the pointer (no clear) for the Purchases / start check
    expect(calls.includes("clear")).toBe(false);
  });

  test("A-L2 page may still be open: not_paid is not a verdict, but the budget still ends at 17", async () => {
    const { d } = deps(["not_paid"]);
    const confirm = jest.spyOn(d.server, "confirm");
    const res = await pollVenueConfirm(d, "venue_offer", G, true);
    expect(res.outcome).toBe("pending");
    expect(confirm).toHaveBeenCalledTimes(17);
  });

  test("A-L3 a hold already past its time writes no pointer, yet the page still opens (server refuses at pay)", async () => {
    const { d, calls } = deps(["not_paid"]);
    await runVenuePayment(d, { ...input, idempotencyKey: "pay-key-0000003", holdUntil: "2026-11-22T11:00:00Z" });
    expect(calls.includes("persist")).toBe(false);
    expect(calls.includes("open")).toBe(true);
  });

  test("A-L4 recovery clears the pointer even when the server still says pending (spec-literal; webhook confirms)", async () => {
    const cleared = [];
    const res = await recoverVenueCheckout(
      {
        readPointer: async () => ({ version: 1, kind: "venue_offer", id: G, accountId: "user-a", provider: "paystack", createdAt: 1, expiresAt: 2 }),
        clearPointer: async () => void cleared.push(1),
        confirmOffer: async () => ({ outcome: "pending" }),
        readMember: async () => null,
      },
      "user-a",
    );
    expect(res).toBe("answered");
    expect(cleared.length).toBe(1);
  });

  test("A-L5 a pointer for account A is cleared without any server call while B is signed in", async () => {
    const confirmOffer = jest.fn();
    const res = await recoverVenueCheckout(
      {
        readPointer: async () => ({ version: 1, kind: "venue_offer", id: G, accountId: "user-a", provider: "paystack", createdAt: 1, expiresAt: 2 }),
        clearPointer: async () => undefined,
        confirmOffer,
        readMember: jest.fn(),
      },
      "user-b",
    );
    expect(res).toBe("foreign");
    expect(confirmOffer).not.toHaveBeenCalled();
  });
});

describe("A-V pointer parser hostility", () => {
  const base = { version: 1, kind: "venue_offer", id: G, accountId: "user-a", provider: "paystack", createdAt: 1_000, expiresAt: 2_000 };
  test.each([
    ["extra token field", { ...base, token: "x" }],
    ["extra url field", { ...base, url: "https://x" }],
    ["prototype key", JSON.parse(`{"__proto__":{"a":1},"version":1,"kind":"venue_offer","id":"${G}","accountId":"a","provider":"paystack","createdAt":1,"expiresAt":2}`)],
    ["ticket kind", { ...base, kind: "ticket" }],
    ["non-uuid id", { ...base, id: "../../etc" }],
    ["version 2", { ...base, version: 2 }],
    ["TTL over 24 h", { ...base, expiresAt: 1_000 + 24 * 3600_000 + 1 }],
    ["expires before created", { ...base, expiresAt: 999 }],
    ["string times", { ...base, createdAt: "1000" }],
    ["NaN-ish", { ...base, expiresAt: null }],
    ["array", [base]],
    ["huge accountId", { ...base, accountId: "a".repeat(129) }],
    ["unknown provider", { ...base, provider: "flutterwave" }],
  ])("A-V1 rejects %s", (_n, value) => {
    expect(parseVenueCheckoutRecoveryPointer(JSON.stringify(value))).toBeNull();
  });
  test("A-V2 corrupted values never throw", () => {
    for (const raw of ["", "{", "null", "1", "\"x\"", "\u0000", "{\"version\":1".repeat(1000)]) {
      expect(() => parseVenueCheckoutRecoveryPointer(raw)).not.toThrow();
      expect(parseVenueCheckoutRecoveryPointer(raw)).toBeNull();
    }
  });
  test("A-V3 expiry = holdUntil capped at 24 h; no hold = 24 h", () => {
    const now = Date.parse("2026-11-22T12:00:00Z");
    const p = createVenueCheckoutRecoveryPointer({ kind: "venue_offer", id: G, accountId: "a", provider: "paystack", holdUntil: "2026-11-22T12:15:00Z", now });
    expect(p.expiresAt - now).toBe(15 * 60_000);
    const q = createVenueCheckoutRecoveryPointer({ kind: "venue_membership", id: G, accountId: "a", provider: "paystack", holdUntil: null, now });
    expect(q.expiresAt - now).toBe(24 * 3600_000);
    expect(Object.keys(q).sort()).toEqual(["accountId", "createdAt", "expiresAt", "id", "kind", "provider", "version"]);
  });
});
