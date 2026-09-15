/**
 * issue #3314 follow-up — the event bundle carries the organiser's "Hide
 * remaining count" (migration 20270704003314), and every guest surface reads it
 * first.
 *
 * WHAT BROKE. #3360 made every surface fail closed and took the setting from
 * `pg_public_social_proof`, which answers for PUBLIC events only. An UNLISTED
 * event never got an answer, so it never showed a count, even with the setting
 * off. The bundle already serves unlisted events, so the setting now rides it.
 *
 * WHAT IS REAL.
 *   - M: the Business bundle mapper (`getPublicEventById` → the private
 *     `detailFromDirectBundle`), with only the Supabase transport mocked.
 *   - R: the shared rule `resolveHideRemainingCount` and the key reader
 *     `readBundleHideRemainingCount`, imported by relative path.
 *   - S: source pins for the hosts this runner cannot mount — the buyer-web
 *     route and checkout, and the Explorer hook and screen (the only universal
 *     jest gate is this Business suite; the #3360 suite set that precedent).
 *
 * FAILS ON REVERT (each mutation run against this file, see the PR):
 *   - mapper drops the key                              → M-1
 *   - reader treats a non-boolean as an answer          → M-3, R-5
 *   - rule ignores the bundle's "hide"                  → R-2
 *   - rule ignores the bundle's "allowed"               → R-1
 *   - rule lets the bundle's "allowed" beat a "hide"    → R-3
 *   - route stops passing the prop                      → S-1
 *   - checkout stops passing bundleSetting              → S-2 (and #3360's S-1)
 *   - Explorer hook stops mapping the key               → S-3
 *   - Explorer screen skips the id check                → S-4
 *   - Explorer screen back to social proof only         → S-4 (and #3360's S-2)
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

/* eslint-disable import/first */
import { getPublicEventById } from "../publicEventsService";
import {
  readBundleHideRemainingCount,
  resolveHideRemainingCount,
} from "../../../../packages/offering-rendering/remainingCountVisibility";
/* eslint-enable import/first */

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** Source with comments removed, so a comment can never satisfy a pin. */
const codeOf = (relPath: string): string =>
  readFileSync(path.join(REPO_ROOT, relPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const EVENT_ID = "0b6f7a1e-3314-4c1a-9d2e-5f0a3314b001";

const bundle = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-3314",
  brandSlug: "acme",
  eventSlug: "unlisted-jazz",
  name: "Unlisted Jazz",
  description: "",
  status: "scheduled",
  timezone: "UTC",
  masterStartAt: "2026-10-13T23:00:00.000Z",
  masterEndAt: "2026-10-14T03:00:00.000Z",
  tickets: [],
  brand: {
    id: "brand-3314",
    slug: "acme",
    name: "Acme",
    address: null,
    coverMediaUrl: null,
  },
  occurrences: [
    {
      id: "n1",
      startAt: "2026-10-13T23:00:00.000Z",
      endAt: "2026-10-14T03:00:00.000Z",
      timezone: "UTC",
      isMaster: true,
    },
  ],
  isMultiDate: false,
  isRecurring: false,
  multiDatePricingMode: "per_day",
  ...patch,
});

const read = async (payload: Record<string, unknown>) => {
  mockRpc.mockImplementation((name: unknown) => {
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`Unexpected RPC ${String(name)}`);
    }
    return Promise.resolve({ data: payload, error: null });
  });
  const detail = await getPublicEventById(EVENT_ID);
  expect(mockFrom).not.toHaveBeenCalled();
  if (detail === null) throw new Error("bundle did not resolve");
  return detail;
};

// ── M — the Business bundle mapper ─────────────────────────────────────────
describe("#3314 follow-up M — the bundle's hideRemainingCount reaches PublicEventDetail", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("M-1 true and false are carried exactly", async () => {
    expect((await read(bundle({ hideRemainingCount: true }))).hideRemainingCount).toBe(true);
    expect((await read(bundle({ hideRemainingCount: false }))).hideRemainingCount).toBe(false);
  });

  test("M-2 a payload from before the migration (no key) is unknown (null), never allowed", async () => {
    const detail = await read(bundle({}));
    expect(detail.hideRemainingCount).toBeNull();
  });

  test("M-3 a key that is not a boolean is unknown, never trusted", async () => {
    expect((await read(bundle({ hideRemainingCount: "false" }))).hideRemainingCount).toBeNull();
    expect((await read(bundle({ hideRemainingCount: null }))).hideRemainingCount).toBeNull();
    expect((await read(bundle({ hideRemainingCount: 0 }))).hideRemainingCount).toBeNull();
  });

  test("M-4 the key does not leak into the event's own organiser setting", async () => {
    // `event.hideRemainingCount` stays the reader's fallback (false); the bundle's
    // answer travels beside it, so the page can tell "unknown" from "allowed".
    const detail = await read(bundle({ hideRemainingCount: true }));
    expect(detail.event.hideRemainingCount).toBe(false);
  });
});

// ── R — the shared rule and reader ─────────────────────────────────────────
describe("#3314 follow-up R — resolveHideRemainingCount prefers the bundle, still fail-closed", () => {
  test("R-1 the bundle allowing it shows the count with no social-proof answer (the unlisted case)", () => {
    expect(
      resolveHideRemainingCount({ organiserSetting: null, bundleSetting: false, socialProof: null }),
    ).toBe(false);
    expect(
      resolveHideRemainingCount({ organiserSetting: null, bundleSetting: false, socialProof: undefined }),
    ).toBe(false);
  });

  test("R-2 the bundle saying hide hides, whatever social proof says", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        bundleSetting: true,
        socialProof: { hideRemainingCount: false },
      }),
    ).toBe(true);
  });

  test("R-3 any source saying hide beats the bundle's allowance", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        bundleSetting: false,
        socialProof: { hideRemainingCount: true },
      }),
    ).toBe(true);
    expect(
      resolveHideRemainingCount({ organiserSetting: true, bundleSetting: false, socialProof: null }),
    ).toBe(true);
  });

  test("R-4 no bundle answer falls back to the #3360 rule unchanged", () => {
    expect(resolveHideRemainingCount({ organiserSetting: null, bundleSetting: null, socialProof: null })).toBe(true);
    expect(resolveHideRemainingCount({ organiserSetting: null, socialProof: undefined })).toBe(true);
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        bundleSetting: null,
        socialProof: { hideRemainingCount: false },
      }),
    ).toBe(false);
  });

  test("R-5 readBundleHideRemainingCount only answers with a real boolean", () => {
    expect(readBundleHideRemainingCount({ hideRemainingCount: true })).toBe(true);
    expect(readBundleHideRemainingCount({ hideRemainingCount: false })).toBe(false);
    expect(readBundleHideRemainingCount({})).toBeNull();
    expect(readBundleHideRemainingCount({ hideRemainingCount: null })).toBeNull();
    expect(readBundleHideRemainingCount({ hideRemainingCount: "true" })).toBeNull();
    expect(readBundleHideRemainingCount(null)).toBeNull();
    expect(readBundleHideRemainingCount([true])).toBeNull();
  });
});

// ── S — hosts that cannot mount under this runner ──────────────────────────
describe("#3314 follow-up S — every host passes the bundle's answer", () => {
  test("S-1 the buyer-web event route hands the bundle's answer to the page", () => {
    const code = codeOf("mingla-business/app/e/[brandSlug]/[eventSlug].tsx");
    expect(code).toMatch(
      /<PublicEventPage[\s\S]*?bundleHideRemainingCount=\{publicEventQuery\.data\.hideRemainingCount\}[\s\S]*?\/>/,
    );
  });

  test("S-2 buyer-web checkout feeds the bundle's answer into the shared rule", () => {
    const code = codeOf("mingla-business/app/checkout/[eventId]/index.tsx");
    expect(code).toMatch(
      /resolveHideRemainingCount\(\{[\s\S]*?bundleSetting: publicEventQuery\.data\?\.hideRemainingCount \?\? null,[\s\S]*?socialProof: cachedSocialProof,[\s\S]*?\}\)/,
    );
  });

  test("S-3 the Explorer bundle hook maps the key to a boolean or null", () => {
    const code = codeOf("app-mobile/src/hooks/usePublicEventBySlug.ts");
    expect(code).toContain("hideRemainingCount: boolean | null;");
    expect(code).toMatch(
      /hideRemainingCount:\s*typeof payload\.hideRemainingCount === "boolean"\s*\?\s*payload\.hideRemainingCount\s*:\s*null,/,
    );
  });

  test("S-4 the Explorer event screen prefers the id-checked bundle answer, any hide wins, unknown hides", () => {
    const code = codeOf("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
    expect(code).toMatch(
      /const bundleHideRemainingCount =\s*validatedDayCanonical\?\.hideRemainingCount \?\? null;/,
    );
    expect(code).toMatch(
      /const hideRemainingCount =\s*bundleHideRemainingCount === true \|\|\s*socialProofQuery\.data\?\.hideRemainingCount === true \|\|\s*\(bundleHideRemainingCount !== false &&\s*socialProofQuery\.data\?\.hideRemainingCount !== false\);/,
    );
  });
});
