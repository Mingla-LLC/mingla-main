// META-ORCH-1235 (§5.2) — canonical stored-web-session reader unification.
// The loose substring scan ("access_token") used to accept a stale/partial
// token the strict reader rejected, leaving AuthResolvingScreen lingering. The
// single `hasUsableStoredWebSession` predicate must apply the SAME strict
// `hasUsableBusinessSession` criterion (a usable, non-empty access_token).
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import {
  hasUsableStoredWebSession,
  hasUsableBusinessSession,
} from "../authReadiness";

const KEY = "sb-gqnoajqerqhnvulmnyvv-auth-token";

class MemoryStorage {
  private store: Record<string, string> = {};
  get length(): number {
    return Object.keys(this.store).length;
  }
  key(i: number): string | null {
    return Object.keys(this.store)[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store[k] ?? null;
  }
  setItem(k: string, v: string): void {
    this.store[k] = v;
  }
  clear(): void {
    this.store = {};
  }
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: new MemoryStorage(),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const ls = () =>
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window
    .localStorage;

describe("hasUsableStoredWebSession — META-ORCH-1235 strict criterion", () => {
  test("returns true for a stored session with a usable access_token", () => {
    ls().setItem(KEY, JSON.stringify({ access_token: "a.real.jwt" }));
    expect(hasUsableStoredWebSession()).toBe(true);
  });

  test("returns FALSE for a stale/partial token the strict reader rejects (empty access_token)", () => {
    // A value that the OLD loose substring scan would accept ("access_token"
    // present) but the strict reader rejects (empty token).
    ls().setItem(KEY, JSON.stringify({ access_token: "" }));
    expect(hasUsableBusinessSession({ access_token: "" })).toBe(false);
    expect(hasUsableStoredWebSession()).toBe(false);
  });

  test("returns FALSE when there is no stored session at all", () => {
    expect(hasUsableStoredWebSession()).toBe(false);
  });

  test("ignores non-supabase keys even if they contain the substring", () => {
    ls().setItem("some-other-key", JSON.stringify({ access_token: "x" }));
    expect(hasUsableStoredWebSession()).toBe(false);
  });

  test("survives an unparseable value without throwing", () => {
    ls().setItem(KEY, "{not-json");
    expect(hasUsableStoredWebSession()).toBe(false);
  });
});
