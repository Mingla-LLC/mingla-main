/* eslint-disable import/first */
/**
 * ORCH-0862 / F-4 + F-5 — implementor regression test for the REAL
 * Symptom A root cause (cache-invalidate refetch storm).
 *
 * F-4: `writePublishedEventCaches` in useBusinessEvents.ts must NOT call
 *      `invalidateQueries({queryKey: businessEventKeys.detail(eventId)})`
 *      because the preceding `setQueryData(detail)` already wrote
 *      authoritative data from the mutation return value. The redundant
 *      invalidate, when fired on a screen with an active subscriber to
 *      the detail key (event-detail via useManagedEventRoute →
 *      useBusinessEventById), triggers a refetch that cascades into the
 *      82-concurrent-HTTP-request storm captured live on the iPhone 17
 *      Pro sim 2026-05-17 14:46:22–26 (syslog evidence at
 *      /tmp/orch0862-rework-symptomA-syslog.txt).
 *
 * F-5: the orders Realtime postgres_changes handler in useBrands.ts must
 *      scope its invalidates — use `brandKeys.list(accountId)` not
 *      `brandKeys.all`, and use `eventOrdersKeys.detail(eventId)` extracted
 *      from the payload not `eventOrdersKeys.all`. The over-broad
 *      invalidates amplified single order changes into whole-app cache
 *      cascades, contributing to both the Symptom A freeze and the
 *      separately-reported home-screen render loop on Tr2 WIP.
 *
 * Strategy: structural test against the source files. Both fixes are
 * source-grep-able. Combined with the new CI gate
 * (.github/scripts/strict-grep/i-cache-invalidate-no-cascade.mjs), any
 * reversion fails this test + fails the gate.
 *
 * Fails-on-revert: restoring either invalidate flips the corresponding
 * assertion to fail.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const USE_BUSINESS_EVENTS_PATH = join(
  __dirname,
  "..",
  "useBusinessEvents.ts",
);
const USE_BRANDS_PATH = join(__dirname, "..", "useBrands.ts");

describe("ORCH-0862 F-4 — writePublishedEventCaches does NOT invalidate the detail key it just wrote", () => {
  const source = readFileSync(USE_BUSINESS_EVENTS_PATH, "utf8");

  test("source loads + contains writePublishedEventCaches", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("const writePublishedEventCaches");
  });

  test("writePublishedEventCaches body contains zero invalidate calls against businessEventKeys.detail", () => {
    // Extract the function body anchored on the const declaration and
    // closing `};` of the arrow function.
    const match = source.match(
      /const\s+writePublishedEventCaches[\s\S]*?\}\s*;\s*$/m,
    );
    expect(match).not.toBeNull();
    const body = match![0];

    // Strip comments so the protective comment referencing the removed
    // call doesn't trigger the grep.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // The fix's load-bearing assertion: no invalidateQueries call against
    // the detail key inside writePublishedEventCaches.
    const detailInvalidatePattern =
      /invalidateQueries\s*\(\s*\{\s*queryKey:\s*businessEventKeys\.detail\s*\(/;
    expect(detailInvalidatePattern.test(stripped)).toBe(false);
  });

  test("writePublishedEventCaches still calls setQueryData on the detail key (the authoritative write)", () => {
    const match = source.match(
      /const\s+writePublishedEventCaches[\s\S]*?\}\s*;\s*$/m,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toMatch(
      /setQueryData\s*\(\s*businessEventKeys\.detail\s*\(/,
    );
  });

  test("writePublishedEventCaches still invalidates the list key (legitimate refetch trigger for hub/home)", () => {
    const match = source.match(
      /const\s+writePublishedEventCaches[\s\S]*?\}\s*;\s*$/m,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toMatch(
      /invalidateQueries\s*\(\s*\{\s*queryKey:\s*businessEventKeys\.list\s*\(/,
    );
  });

  test("F-4 protective comment present (ORCH-0862 reference)", () => {
    expect(source).toMatch(/ORCH-0862[\s\S]*F-4[\s\S]*do NOT invalidate/);
  });
});

describe("ORCH-0862 F-5 — Realtime postgres_changes handlers use scoped invalidates", () => {
  const source = readFileSync(USE_BRANDS_PATH, "utf8");

  test("source loads + contains both useBrands and useBrand", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("export const useBrands");
    expect(source).toContain("export const useBrand");
  });

  test("no Realtime handler invalidates brandKeys.all (whole-app cascade trigger)", () => {
    // The previous over-broad invalidate `brandKeys.all` was the
    // primary amplifier in the cascade. The fix uses scoped keys
    // (`brandKeys.list(accountId)`, `brandKeys.detail(brandId)`) instead.
    // Strip comments first because the explanatory comment may reference
    // the removed pattern.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // Match `invalidateQueries({ queryKey: brandKeys.all })` patterns
    // (ignoring whitespace variations).
    const allInvalidatePattern =
      /invalidateQueries\s*\(\s*\{\s*queryKey:\s*brandKeys\.all\s*\}/;
    expect(allInvalidatePattern.test(stripped)).toBe(false);
  });

  test("no Realtime handler invalidates eventOrdersKeys.all unconditionally (event-scoped only)", () => {
    // The over-broad `eventOrdersKeys.all` invalidate caused every event's
    // orders to refetch on any single order change. Fixed: scope to
    // eventOrdersKeys.detail(eventId) extracted from the payload.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const allOrdersPattern =
      /invalidateQueries\s*\(\s*\{\s*queryKey:\s*eventOrdersKeys\.all\s*\}/;
    expect(allOrdersPattern.test(stripped)).toBe(false);
  });

  test("Realtime handler extracts event_id from payload.new / payload.old", () => {
    // The fix accesses payload.new.event_id (or payload.old for DELETE).
    // Without this extraction, the handler can't scope eventOrdersKeys.detail.
    expect(source).toMatch(/payload\??\.new\??\.event_id/);
    expect(source).toMatch(/payload\??\.old\??\.event_id/);
  });

  test("Realtime handlers still invalidate scoped brand keys (brandKeys.list / brandKeys.detail)", () => {
    // The fix should preserve scoped invalidates so brand-stats freshness
    // still works.
    expect(source).toMatch(/brandKeys\.list\s*\(\s*accountId\s*\)/);
    expect(source).toMatch(/brandKeys\.detail\s*\(\s*brandId\s*\)/);
  });

  test("F-5 protective comment present (ORCH-0862 reference)", () => {
    expect(source).toMatch(/ORCH-0862[\s\S]*F-5[\s\S]*scope/);
  });
});
