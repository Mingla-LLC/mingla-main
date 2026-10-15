import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { recordConsent } from "../consentService";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const invokeMock = supabase.functions.invoke as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>;

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    data: { ok: true, inserted: 2, deduped: 0 },
    error: null,
  });
});

describe("#3859 scope-aware consent client", () => {
  test("forwards a transactional-only checkout grant exactly", async () => {
    await recordConsent({
      source: "checkout",
      disclosureText: "Purchase disclosure",
      disclosureVersion: "purchase-v1",
      scopes: ["transactional"],
      phone: "+12015550123",
      email: "buyer@example.com",
    });

    const [, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body.scopes).toEqual(["transactional"]);
  });

  test("keeps scopes omitted for legacy onboarding and checkout callers", async () => {
    await recordConsent({
      source: "onboarding",
      disclosureText: "Legacy bundled disclosure",
      disclosureVersion: "legacy-v1",
      email: "buyer@example.com",
    });

    const [, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body.scopes).toBeUndefined();
  });

  test("Explorer consent client carries the same optional scope contract", () => {
    const explorerClient = fs.readFileSync(
      path.join(repoRoot, "app-mobile/src/services/consentService.ts"),
      "utf8",
    );
    expect(explorerClient).toContain(
      'export type ConsentScope = "transactional" | "marketing"',
    );
    expect(explorerClient).toContain("scopes?: readonly ConsentScope[]");
    expect(explorerClient).toContain("scopes: input.scopes");
  });
});
