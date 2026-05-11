// ORCH-0789/0790 REWORK: unit tests for the sessionStorage persistence
// helper. Pure data — no React, no RN — runs in the node-env Jest
// harness. Covers the round-trip (write → read), shape validation,
// missing-key, and malformed-payload paths.

import { describe, expect, test } from "@jest/globals";

import type { BuyerDetails, CartLine } from "../CartContext";
import {
  CHECKOUT_RESUME_STORAGE_PREFIX,
  checkoutResumeStorageKey,
  clearCheckoutResumePayload,
  isCheckoutResumePayload,
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../checkoutPersistence";

// In-memory Storage mock — matches the Web Storage API surface we use.
const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear: (): void => {
      map.clear();
    },
    getItem: (key: string): string | null => map.get(key) ?? null,
    key: (index: number): string | null => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string): void => {
      map.delete(key);
    },
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
  };
};

const sampleBuyer: BuyerDetails = {
  name: "Test Buyer",
  email: "buyer@example.com",
  phone: "+447700900000",
  marketingOptIn: false,
};

const sampleLine: CartLine = {
  ticketTypeId: "tt_1",
  ticketName: "General Admission",
  quantity: 2,
  unitPrice: 20,
  currency: "GBP",
  isFree: false,
};

describe("checkoutPersistence — storage key", () => {
  test("includes the canonical prefix and the eventId", () => {
    expect(checkoutResumeStorageKey("evt_abc")).toBe(
      `${CHECKOUT_RESUME_STORAGE_PREFIX}evt_abc`,
    );
  });
});

describe("checkoutPersistence — isCheckoutResumePayload", () => {
  test("accepts a fully-shaped payload", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "cs_1",
        buyerStatusToken: "tok_1",
        lines: [sampleLine],
        buyer: sampleBuyer,
      }),
    ).toBe(true);
  });

  test("rejects null + non-objects", () => {
    expect(isCheckoutResumePayload(null)).toBe(false);
    expect(isCheckoutResumePayload("foo")).toBe(false);
    expect(isCheckoutResumePayload(42)).toBe(false);
  });

  test("rejects empty checkoutSessionId", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "",
        buyerStatusToken: "tok_1",
        lines: [sampleLine],
        buyer: sampleBuyer,
      }),
    ).toBe(false);
  });

  test("rejects missing buyerStatusToken", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "cs_1",
        lines: [sampleLine],
        buyer: sampleBuyer,
      }),
    ).toBe(false);
  });

  test("rejects malformed line item", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "cs_1",
        buyerStatusToken: "tok_1",
        lines: [{ ticketTypeId: "tt_1", quantity: 2 }],
        buyer: sampleBuyer,
      }),
    ).toBe(false);
  });

  test("rejects malformed buyer", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "cs_1",
        buyerStatusToken: "tok_1",
        lines: [sampleLine],
        buyer: { name: "x" },
      }),
    ).toBe(false);
  });

  test("accepts empty lines array", () => {
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "cs_1",
        buyerStatusToken: "tok_1",
        lines: [],
        buyer: sampleBuyer,
      }),
    ).toBe(true);
  });
});

describe("checkoutPersistence — read / write / clear round-trip", () => {
  test("write → read round-trips the payload exactly", () => {
    const storage = makeStorage();
    const payload = {
      checkoutSessionId: "cs_1",
      buyerStatusToken: "tok_1",
      lines: [sampleLine, { ...sampleLine, ticketTypeId: "tt_2", quantity: 1 }],
      buyer: sampleBuyer,
    };
    writeCheckoutResumePayload(storage, "evt_abc", payload);
    expect(readCheckoutResumePayload(storage, "evt_abc")).toEqual(payload);
  });

  test("read returns null when no entry exists", () => {
    const storage = makeStorage();
    expect(readCheckoutResumePayload(storage, "evt_abc")).toBeNull();
  });

  test("read returns null when entry is malformed JSON", () => {
    const storage = makeStorage();
    storage.setItem(`${CHECKOUT_RESUME_STORAGE_PREFIX}evt_abc`, "{not json");
    expect(readCheckoutResumePayload(storage, "evt_abc")).toBeNull();
  });

  test("read returns null when entry has wrong shape", () => {
    const storage = makeStorage();
    storage.setItem(
      `${CHECKOUT_RESUME_STORAGE_PREFIX}evt_abc`,
      JSON.stringify({ foo: "bar" }),
    );
    expect(readCheckoutResumePayload(storage, "evt_abc")).toBeNull();
  });

  test("clear removes the entry", () => {
    const storage = makeStorage();
    writeCheckoutResumePayload(storage, "evt_abc", {
      checkoutSessionId: "cs_1",
      buyerStatusToken: "tok_1",
      lines: [sampleLine],
      buyer: sampleBuyer,
    });
    expect(readCheckoutResumePayload(storage, "evt_abc")).not.toBeNull();
    clearCheckoutResumePayload(storage, "evt_abc");
    expect(readCheckoutResumePayload(storage, "evt_abc")).toBeNull();
  });

  test("write / read / clear are no-ops when storage is undefined (native)", () => {
    expect(() =>
      writeCheckoutResumePayload(undefined, "evt_abc", {
        checkoutSessionId: "cs_1",
        buyerStatusToken: "tok_1",
        lines: [sampleLine],
        buyer: sampleBuyer,
      }),
    ).not.toThrow();
    expect(readCheckoutResumePayload(undefined, "evt_abc")).toBeNull();
    expect(() => clearCheckoutResumePayload(undefined, "evt_abc")).not.toThrow();
  });

  test("entries are scoped per eventId", () => {
    const storage = makeStorage();
    writeCheckoutResumePayload(storage, "evt_a", {
      checkoutSessionId: "cs_a",
      buyerStatusToken: "tok_a",
      lines: [sampleLine],
      buyer: sampleBuyer,
    });
    writeCheckoutResumePayload(storage, "evt_b", {
      checkoutSessionId: "cs_b",
      buyerStatusToken: "tok_b",
      lines: [],
      buyer: sampleBuyer,
    });
    expect(readCheckoutResumePayload(storage, "evt_a")?.checkoutSessionId).toBe(
      "cs_a",
    );
    expect(readCheckoutResumePayload(storage, "evt_b")?.checkoutSessionId).toBe(
      "cs_b",
    );
    clearCheckoutResumePayload(storage, "evt_a");
    expect(readCheckoutResumePayload(storage, "evt_a")).toBeNull();
    expect(readCheckoutResumePayload(storage, "evt_b")).not.toBeNull();
  });
});
