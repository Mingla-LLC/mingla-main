/**
 * #2879 / #2947 slice 3 — device token mint / opt-in fields.
 */
import { describe, expect, it } from "@jest/globals";
import {
  getOrCreateQueueDeviceToken,
  mintQueueDeviceToken,
  queueContractOptInFields,
  QUEUE_CONTRACT_V1,
} from "../queueDeviceToken";

describe("queueDeviceToken", () => {
  it("mints 64 lowercase hex chars", () => {
    const token = mintQueueDeviceToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses the same token per ticket type in storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    const a = getOrCreateQueueDeviceToken("tier-a", storage);
    const b = getOrCreateQueueDeviceToken("tier-a", storage);
    const c = getOrCreateQueueDeviceToken("tier-b", storage);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("opt-in fields omit when disabled or token unavailable", () => {
    expect(queueContractOptInFields("tier", { enabled: false })).toEqual({});
    expect(queueContractOptInFields(null)).toEqual({});
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as Storage;
    expect(queueContractOptInFields("tier", { storage })).toEqual({
      queueContract: QUEUE_CONTRACT_V1,
      queueDeviceToken: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
