/**
 * #3040 T-A17 [A-17] — a rate-limited directory search says so, superseded
 * searches are really cancelled, and a server hiccup is retried once.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invokeMock = jest.fn<(name: string, options: Record<string, unknown>) => Promise<unknown>>();
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (name: string, options: Record<string, unknown>) => invokeMock(name, options) } },
}));

import { poolSearchHttpStatus, searchPoolMatches } from "../poolSearchService";

class FakeFunctionsHttpError extends Error {
  context: { status: number };
  constructor(status: number) {
    super("Edge Function returned a non-2xx status code");
    this.name = "FunctionsHttpError";
    this.context = { status };
  }
}

describe("#3040 T-A17 — honest directory search", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("a 429 FunctionsHttpError rejects as rate_limited", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FakeFunctionsHttpError(429) });
    await expect(searchPoolMatches("Blue Note")).rejects.toThrow("rate_limited");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("the abort signal is forwarded to the function call", async () => {
    invokeMock.mockResolvedValue({ data: { matches: [] }, error: null });
    const controller = new AbortController();
    await searchPoolMatches("Blue Note", { signal: controller.signal });
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  test("a 5xx is retried once, then reported as unavailable", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new FakeFunctionsHttpError(503) });
    await expect(searchPoolMatches("Blue Note")).rejects.toThrow("search_unavailable");
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(poolSearchHttpStatus(new FakeFunctionsHttpError(503))).toBe(503);
  });

  test("the hook shows the rate-limit and unavailable copy, with a Retry", () => {
    const hook = readFileSync(join(__dirname, "..", "..", "hooks", "usePoolMatchSearch.ts"), "utf8");
    expect(hook).toContain('"Searching too fast — try again in a moment"');
    expect(hook).toContain(`"Couldn't search right now"`);
    expect(hook).not.toContain("Check your connection");
    expect(hook).toContain("POOL_SEARCH_RATE_LIMIT_RETRY_MS = 6_000");
    const screen = readFileSync(join(__dirname, "..", "..", "..", "app", "venue", "create.tsx"), "utf8");
    expect(screen).toContain("onPress={retryPoolSearch}");
  });
});
