/**
 * ORCH-1003 [Business web asset caching] — happy-path regression test.
 *
 * Asserts vercel.json caches the content-hashed Expo web assets under
 * /_expo/static immutably for a year. FAILS-ON-REVERT: remove or weaken the
 * rule and this fails.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const vercel = JSON.parse(
  readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
) as { headers: HeaderRule[]; rewrites: { source: string; destination: string }[] };

const staticRule = (): HeaderRule | undefined =>
  vercel.headers.find((r) => r.source === "/_expo/static/(.*)");

describe("ORCH-1003 immutable caching for hashed web assets", () => {
  test("vercel.json caches /_expo/static immutably for a year", () => {
    const rule = staticRule();
    expect(rule).toBeDefined();
    const cacheControl = rule!.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl).toBeDefined();
    expect(cacheControl!.value).toContain("immutable");
    expect(cacheControl!.value).toContain("max-age=31536000");
    expect(cacheControl!.value).toContain("public");
  });
});
