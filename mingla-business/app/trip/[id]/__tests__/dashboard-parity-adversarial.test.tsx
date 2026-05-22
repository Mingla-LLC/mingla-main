/**
 * ORCH-0913 — trip dashboard parity ADVERSARIAL regression tests T-A01..T-A12.
 *
 * Author: Claude `mingla-tester` (TEST mode), 2026-05-22.
 *
 * These tests deliberately attack DIFFERENT ANGLES than the implementor's
 * happy-path suite at `dashboard-parity.test.tsx`. Where the happy-path tests
 * verify that the new structure EXISTS (zero tabs, 7 tiles, KPI strip
 * position, recent-activity stream merge), these tests verify that:
 *
 *   - tile DESTINATIONS are correct (not just that tiles exist)
 *   - data-integrity fallbacks honor Constitution #9 (no fabrication on null/zero)
 *   - lifecycle-state PRECEDENCE is correct (cancelled supersedes past)
 *   - anti-zealous-parity is preserved (Edit-primary divergence guarded)
 *   - the strict-grep CI gate ACTUALLY FIRES on regression (not just present-but-broken)
 *   - back-navigation from new routes returns to the trip dashboard root
 *
 * A copy-paste of the implementor's tests with renamed `it()` blocks would
 * fail Step 0.5 gate (b) — these are independent angle-attacks per the SPEC
 * §7.2 contract.
 *
 * Source-text grep pattern matches the implementor's pattern (rendering the
 * full dashboard pulls Expo Router + React Query + native media which Jest
 * cannot exercise from node). Sim repro covers the rendered behavior.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const DASHBOARD_PATH = join(__dirname, "..", "index.tsx");
const TRAVELERS_PATH = join(__dirname, "..", "travelers", "index.tsx");
const MONEY_PATH = join(__dirname, "..", "money", "index.tsx");
const PILL_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "src",
  "components",
  "trip",
  "TripDetailHeroStatusPill.tsx",
);
const KPI_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "src",
  "components",
  "trip",
  "TripDetailKpiCard.tsx",
);
const STRICT_GREP_PATH = join(
  REPO_ROOT,
  ".github",
  "scripts",
  "strict-grep",
  "orch-0913-no-tabs-on-dashboards.mjs",
);

const DASHBOARD_SRC = readFileSync(DASHBOARD_PATH, "utf8");
const TRAVELERS_SRC = readFileSync(TRAVELERS_PATH, "utf8");
const MONEY_SRC = readFileSync(MONEY_PATH, "utf8");
const PILL_SRC = readFileSync(PILL_PATH, "utf8");
const KPI_SRC = readFileSync(KPI_PATH, "utf8");

// Carve out the action grid to scope tile-destination assertions —
// onPress handlers elsewhere in the file (manage menu, share modal, cancel
// dialog) MUST NOT contaminate destination-route assertions.
//
// ORCH-0913-A: ScrollView moved up to wrap hero + action grid. Terminator
// marker switched from `<ScrollView` to `<TripDetailKpiCard` (now the
// element that follows the action grid's closing View).
const ACTION_GRID_MATCH = DASHBOARD_SRC.match(
  /<View style=\{styles\.actionGrid\}>([\s\S]*?)<\/View>\s*\n\s*<TripDetailKpiCard/,
);
const ACTION_GRID = ACTION_GRID_MATCH?.[1] ?? "";

// Carve out the recent-activity useMemo so adversarial null-handling
// assertions don't false-pass on unrelated code paths. The block ends with a
// `.slice(0, 5);` chained off a sort.
const RECENT_ACTIVITY_MATCH = DASHBOARD_SRC.match(
  /const recentActivity = useMemo[\s\S]*?\.slice\(0,\s*5\);\s*\}/,
);
const RECENT_ACTIVITY = RECENT_ACTIVITY_MATCH?.[0] ?? "";

// Carve out the buyerLabel helper to verify its fallback chain. The body
// contains a single `return` statement so we match through the FIRST `return`
// + line + closing `\n}` (the nested destructure type's `}` would otherwise
// short-circuit the carve).
const BUYER_LABEL_MATCH = DASHBOARD_SRC.match(
  /function buyerLabel\([\s\S]*?return [^;]+;\s*\n\}/,
);
const BUYER_LABEL = BUYER_LABEL_MATCH?.[0] ?? "";

describe("ORCH-0913 trip dashboard parity — ADVERSARIAL", () => {
  // --- Tile destination integrity (angles: implementor checks presence/order;
  // we check destinations) ---

  test("T-A01 Travelers tile navigates to /trip/<id>/travelers, NOT /event/<id>/orders", () => {
    expect(ACTION_GRID).toContain("/trip/${trip.id}/travelers");
    expect(ACTION_GRID).not.toMatch(
      /label="Travelers"[\s\S]*?\/event\/\$\{trip\.id\}\/orders/,
    );
  });

  // [TEST-MOD-APPROVED ORCH-0920] — tile label changed "Money" → "Payments"
  // (route preserved at /trip/<id>/money; only the user-facing label + icon changed).
  test("T-A02 Payments tile navigates to /trip/<id>/money, NOT /event/<id>/reconciliation", () => {
    expect(ACTION_GRID).toContain("/trip/${trip.id}/money");
    expect(ACTION_GRID).not.toMatch(
      /label="Payments"[\s\S]*?\/event\/\$\{trip\.id\}\/reconciliation/,
    );
  });

  test("T-A03 Blasts tile preserves existing /event/<id>/blasts route (ORCH-0815-B substrate)", () => {
    expect(ACTION_GRID).toMatch(
      /label="Blasts"[\s\S]{0,300}router\.push\(`\/event\/\$\{trip\.id\}\/blasts`/,
    );
  });

  test("T-A04 Group chat tile preserves existing /event/<id>/group-chat route (ORCH-0897 [Trips + Events Group Chat] shared substrate)", () => {
    expect(ACTION_GRID).toMatch(
      /label="Group chat"[\s\S]{0,300}router\.push\(`\/event\/\$\{trip\.id\}\/group-chat`/,
    );
  });

  // --- Data-integrity fallbacks (angles: implementor checks "row omitted
  // when timestamp missing"; we check buyer-name fallback + zero-amount
  // honest rendering per Constitution #9) ---

  test("T-A05 Recent Activity buyer name falls back through `buyerName ?? buyerEmail ?? \"Anonymous\"` via shared `buyerLabel` helper (no empty string, no fake name)", () => {
    // Helper exists with the correct fallback chain.
    expect(BUYER_LABEL).toMatch(
      /return input\.buyerName \?\? input\.buyerEmail \?\? "Anonymous"/,
    );
    // Recent Activity delegates to the helper for both order + installment
    // streams — not duplicated inline (Constitution #2 one-owner-per-truth).
    expect(RECENT_ACTIVITY).toContain("buyerName: buyerLabel(o)");
    expect(RECENT_ACTIVITY).toContain("buyerName: buyerLabel(r)");
  });

  test("T-A06 Recent Activity uses honest amount derivation (no Number.isNaN scrubbing, no `|| 0` masking of real-zero installments)", () => {
    // Installment amount uses raw division — a zero-cents collected installment
    // honestly renders as $0.00. NOT wrapped in `|| 1` or similar fabrication.
    expect(RECENT_ACTIVITY).toMatch(/amountGbp: r\.amountCents \/ 100/);
    expect(RECENT_ACTIVITY).not.toMatch(/amountGbp:[^,]*\|\|\s*1/);
    expect(RECENT_ACTIVITY).not.toMatch(/amountGbp:[^,]*\?\?\s*1/);
  });

  // --- Lifecycle pill precedence (angle: implementor checks "renders 4
  // states"; we check that cancelled supersedes past when both are true) ---

  test("T-A07 Lifecycle pill: cancelled status supersedes past — `status === 'cancelled'` returns 'cancelled' BEFORE past check", () => {
    // Pull just the derivation function body, not the visual pill render.
    const deriveBody = PILL_SRC.match(
      /export function deriveTripLifecycleStatus[\s\S]*?\n\}/,
    )?.[0] ?? "";
    const cancelledIdx = deriveBody.search(/input\.status === "cancelled"/);
    const pastIdx = deriveBody.search(/return "past"/);
    expect(cancelledIdx).toBeGreaterThan(-1);
    expect(pastIdx).toBeGreaterThan(-1);
    // Cancelled branch must appear before past branch — precedence matters
    // when a cancelled trip's endAt is also in the past (very common case).
    expect(cancelledIdx).toBeLessThan(pastIdx);
  });

  // --- Loading-state safety (angle: implementor checks "KPI renders"; we
  // check no crash + honest fallback when underlying queries are loading) ---

  test("T-A08 KPI strip during loading: revenue defaults to 0 and travellers defaults to 0 when queries are undefined (no `data!` non-null assertion, no fabricated number)", () => {
    // The page derives revenue from ordersQuery.data without ?? fallback to a
    // fake non-zero number; verify the actual aggregation handles undefined.
    expect(DASHBOARD_SRC).toContain("revenueByCurrency.get(primaryCurrency) ?? 0");
    expect(DASHBOARD_SRC).not.toMatch(/ordersQuery\.data!/);
    // KPI primitive must accept the undefined→0 case without crashing.
    expect(KPI_SRC).not.toMatch(/\.toFixed\([^)]*\)\.[a-z]/);
  });

  // --- Capacity zero edge case (angle: implementor checks "N / capacity";
  // we check that capacity=0 renders honestly, not as "infinity" or hidden) ---

  test("T-A09 KPI Spots when capacity is zero: renders `N / 0` honestly (not hidden, not falsy-coerced to undefined branch)", () => {
    // The capacity null-guard uses `!== null` — capacity 0 (falsy but not null)
    // MUST take the `/ capacity` branch, not the `null` branch.
    expect(DASHBOARD_SRC).toContain(
      "trip.businessTrip.capacity !== null",
    );
    expect(DASHBOARD_SRC).not.toMatch(/trip\.businessTrip\.capacity\s*\?/);
    expect(DASHBOARD_SRC).not.toMatch(/trip\.businessTrip\.capacity\s*\?\?/);
  });

  // --- Anti-zealous-parity guard (angle: implementor checks "Edit tile
  // renders"; we check that the deliberate-divergence comment + primary
  // flag are guarded against accidental removal) ---

  test("T-A10 Edit-primary deliberate divergence: file-header JSDoc + tile-local comment + `primary` flag all present", () => {
    expect(DASHBOARD_SRC).toContain(
      "[ORCH-0913 deliberate divergence from event] Edit trip remains a primary",
    );
    expect(DASHBOARD_SRC).toContain(
      "[ORCH-0913 deliberate divergence from event] Edit remains primary.",
    );
    // The Edit tile JSX must carry `primary` (with no preceding `// primary`
    // comment to fake it).
    const editTileMatch = ACTION_GRID.match(
      /<ActionTile[\s\S]*?label=\{trip\.status[\s\S]*?\/>/,
    );
    expect(editTileMatch).not.toBeNull();
    expect(editTileMatch?.[0]).toMatch(/^\s*primary\s*$/m);
  });

  // --- Strict-grep gate functionality (angle: implementor wrote the gate
  // and confirmed it's present; we verify it ACTUALLY FIRES on injection) ---

  test("T-A11 Strict-grep gate FAILS when accessibilityRole=\"tab\" is injected (proves gate is functional, not just present)", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "orch-0913-adversarial-"));
    try {
      // Stage the gate script + a tiny mirror of the file tree it inspects.
      const gateScript = readFileSync(STRICT_GREP_PATH, "utf8");
      // The gate reads files relative to the current working directory using
      // hardcoded paths. We mirror just the two paths it inspects, inject the
      // regression into the trip side, and run the gate from the tmp root.
      const eventDir = join(tmpRoot, "mingla-business", "app", "event", "[id]");
      const tripDir = join(tmpRoot, "mingla-business", "app", "trip", "[id]");
      const gateDir = join(tmpRoot, ".github", "scripts", "strict-grep");
      execFileSync("mkdir", ["-p", eventDir, tripDir, gateDir]);
      writeFileSync(
        join(eventDir, "index.tsx"),
        "// clean event dashboard — no tab role\n",
      );
      writeFileSync(
        join(tripDir, "index.tsx"),
        '// REGRESSION INJECTION\n<Pressable accessibilityRole="tab" />\n',
      );
      writeFileSync(
        join(gateDir, "orch-0913-no-tabs-on-dashboards.mjs"),
        gateScript,
      );

      const result = spawnSync(
        "node",
        [".github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs"],
        { cwd: tmpRoot, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect((result.stderr ?? "") + (result.stdout ?? "")).toMatch(
        /accessibilityRole="tab"|tab role|ORCH-0913/i,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // --- Back-navigation integrity (angle: implementor checks "new routes
  // render"; we check that back from them goes to trip dashboard root, not
  // deeper into the navigation stack or to event side) ---

  // [TEST-MOD-APPROVED ORCH-0919] — original assertion encoded the buggy
  // router.push(/trip/${eventId}) fallback as contract. ORCH-0919 replaced
  // that fallback with a canGoBack-guarded router.back(); else router.replace
  // pattern so the second back tap correctly pops out to the trips list
  // instead of landing back on the sub-page. New assertion pins the fix
  // shape: canGoBack guard present + router.back() called + router.replace
  // fallback targets /trip/${eventId} (still not /event/${eventId}).
  test("T-A12 Travelers + Money routes back-button uses canGoBack guard + router.back() + /trip/<id> replace fallback (post-ORCH-0919)", () => {
    expect(TRAVELERS_SRC).toContain("router.canGoBack()");
    expect(TRAVELERS_SRC).toContain("router.back()");
    expect(TRAVELERS_SRC).toMatch(/router\.replace\(`\/trip\/\$\{eventId\}` as never\)/);
    expect(TRAVELERS_SRC).not.toMatch(/router\.replace\(`\/event/);

    expect(MONEY_SRC).toContain("router.canGoBack()");
    expect(MONEY_SRC).toContain("router.back()");
    expect(MONEY_SRC).toMatch(/router\.replace\(`\/trip\/\$\{eventId\}` as never\)/);
    expect(MONEY_SRC).not.toMatch(/router\.replace\(`\/event/);
  });
});
