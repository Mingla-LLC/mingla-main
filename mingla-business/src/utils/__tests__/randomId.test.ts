/**
 * randomId regression tests — ORCH-0787 P0 fix.
 *
 * Establishes:
 *   1. Returns a non-empty string in every runtime (with or without crypto)
 *   2. Length always satisfies the ORCH-0787 refund-order / cancel-order
 *      edge function Idempotency-Key contract (8..128 chars)
 *   3. Uses crypto.randomUUID() when available (web / Node 19+ / future Hermes)
 *   4. Falls back to a unique-enough Date+Math.random tuple when crypto is
 *      absent (current Hermes runtime — see ReferenceError reported on iOS)
 *   5. Two consecutive calls produce different values
 */
import { randomId } from "../randomId";

describe("randomId", () => {
  const originalCrypto = (globalThis as { crypto?: Crypto }).crypto;

  afterEach(() => {
    if (originalCrypto) {
      (globalThis as { crypto?: Crypto }).crypto = originalCrypto;
    } else {
      delete (globalThis as { crypto?: Crypto }).crypto;
    }
  });

  it("returns a non-empty string", () => {
    const id = randomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("length is inside the Idempotency-Key 8..128 contract", () => {
    for (let i = 0; i < 50; i++) {
      const id = randomId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });

  it("uses crypto.randomUUID() when available", () => {
    const spy = jest.fn(() => "11111111-2222-3333-4444-555555555555");
    (globalThis as { crypto?: Partial<Crypto> }).crypto = { randomUUID: spy } as unknown as Crypto;

    const id = randomId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("falls back when globalThis.crypto is undefined (Hermes case)", () => {
    delete (globalThis as { crypto?: Crypto }).crypto;
    const id = randomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  });

  it("falls back when globalThis.crypto exists but randomUUID is missing", () => {
    (globalThis as { crypto?: Partial<Crypto> }).crypto = {} as unknown as Crypto;
    const id = randomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("does not throw — proves the ORCH-0787 ReferenceError regression cannot recur", () => {
    delete (globalThis as { crypto?: Crypto }).crypto;
    expect(() => randomId()).not.toThrow();
  });

  it("two consecutive calls return different values", () => {
    delete (globalThis as { crypto?: Crypto }).crypto;
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });
});
