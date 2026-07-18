// ORCH-1384 — implementor regression: /partner/brands contract (T-6 / T-10 +
// cancelled/expired row treatment).
//
// The default node/ts-jest config carries no RTL, so component contracts are
// pinned source-side with the COMMS-0106 companions on EVERY slice:
//   (a) uniqueness — the sliced declaration appears EXACTLY once;
//   (b) binding    — the component provably CALLS the sliced declaration
//                    (control-flow: no shadowing/preempting path);
// and sliced logic is EXECUTED (typescript.transpileModule + Function), so
// these are value tests, not string vibes.
//
// fails-on-revert (SPEC §9 proof 1): reverting the header slot to the empty
// 36px spacer turns the T-10 block below red (testID + route + not-gated).

/* eslint-disable import/first */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC = fs.readFileSync(path.resolve(__dirname, "../brands.tsx"), "utf8");
const ACCOUNT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../(tabs)/account.tsx"),
  "utf8",
);

/** Normalize JSX-wrapped whitespace so copy asserts match runtime text. */
const FLAT = SRC.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Balanced-brace slice from a start marker (COMMS-0106: asserts uniqueness).
 * When a balanced block is immediately followed by another `{` (a function
 * whose RETURN TYPE is an object literal, e.g. `): { … } {`), scanning
 * continues through the follow-on block so the slice captures the real body.
 */
function slice(marker: string): string {
  expect(countOf(SRC, marker)).toBe(1);
  const start = SRC.indexOf(marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    if (SRC[i] === "}") {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < SRC.length && /\s/.test(SRC[j])) j++;
        if (SRC[j] === "{") continue; // return-type block → keep scanning
        return SRC.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unbalanced slice for ${marker}`);
}

/** Transpile a TS slice and evaluate it, returning the named binding. */
function evalSlice<T>(tsSource: string, returnExpr: string): T {
  const js = ts.transpileModule(
    `${tsSource}\nmodule.exports = ${returnExpr};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const moduleShim = { exports: {} as unknown };
  new Function("module", "exports", js)(moduleShim, moduleShim.exports);
  return moduleShim.exports as T;
}

type Row = {
  status: string;
  invited_at: string;
  first_split_at?: string | null;
  cancelled_at?: string | null;
};

describe("T-10 — persistent header add-CTA (fails-on-revert proof 1)", () => {
  test("add button testID appears EXACTLY once, on an IconChrome plus wired to the wizard route", () => {
    expect(countOf(SRC, 'testID="partner-brands-add-button"')).toBe(1);
    // The IconChrome block carrying the testID.
    const idx = SRC.indexOf('testID="partner-brands-add-button"');
    const block = SRC.slice(Math.max(0, idx - 400), idx + 100);
    expect(block).toContain('icon="plus"');
    expect(block).toContain("onPress={handleSetUpFirst}");
    expect(block).toContain(
      'accessibilityLabel="Set up another partner brand"',
    );
    // The route the handler pushes (declared exactly once).
    expect(countOf(SRC, '"/brand/new?partner_mode=client"')).toBe(1);
    const handler = slice("const handleSetUpFirst = useCallback(");
    expect(handler).toContain("/brand/new?partner_mode=client");
  });

  test("control-flow companion: the add-CTA lives in the ALWAYS-rendered header, not a list-state branch", () => {
    const headerStart = SRC.indexOf("<View style={styles.header}>");
    const scrollStart = SRC.indexOf("<ScrollView");
    expect(headerStart).toBeGreaterThan(-1);
    expect(scrollStart).toBeGreaterThan(headerStart);
    const headerSegment = SRC.slice(headerStart, scrollStart);
    // The add CTA renders INSIDE the header segment…
    expect(headerSegment).toContain('testID="partner-brands-add-button"');
    // …which contains NO loading/empty/error gating (renders in ALL states).
    expect(headerSegment).not.toContain("isLoading");
    expect(headerSegment).not.toContain("sortedRows.length");
    expect(headerSegment).not.toContain("linksQuery.error");
    // The old empty spacer is GONE (SPEC §9 proof 1 target).
    expect(SRC).not.toContain("headerRightSlot");
  });

  test("empty-state CTA stays byte-identical (SC-1)", () => {
    expect(FLAT).toContain('label="Set up your first partner brand"');
    expect(countOf(SRC, "sortedRows.length === 0 ? (")).toBe(1);
  });
});

describe("T-6 — count semantics exclude cancelled (executed slice)", () => {
  test("headerCounts is status-filtered; cancelled rows can NEVER alter counts", () => {
    const fn = evalSlice<{
      (rows: Row[]): { activeCount: number; pendingCount: number };
    }>(slice("export function headerCounts"), "headerCounts");
    const rows: Row[] = [
      { status: "active", invited_at: "2026-07-01T00:00:00Z" },
      { status: "awaiting_owner", invited_at: "2026-07-02T00:00:00Z" },
      { status: "awaiting_stripe", invited_at: "2026-07-03T00:00:00Z" },
      { status: "cancelled", invited_at: "2026-07-04T00:00:00Z" },
      { status: "cancelled", invited_at: "2026-07-05T00:00:00Z" },
    ];
    const counts = fn(rows);
    expect(counts.activeCount).toBe(1);
    expect(counts.pendingCount).toBe(2);
  });

  test("binding companion: the component derives header counts ONLY through headerCounts(sortedRows)", () => {
    expect(countOf(SRC, "headerCounts(sortedRows)")).toBe(1);
    // No second, shadowing count derivation outside the exported helper.
    expect(countOf(SRC, '.filter((r) => r.status === "active")')).toBe(1);
  });

  test("account.tsx side: default (exclude-cancelled) read — no includeCancelled argument", () => {
    // account.tsx is spec DO-NOT-TOUCH; its call must remain argument-free so
    // the service default (proven in partnerBrandLinksService.orch1384.test)
    // keeps cancelled rows out of the account counts (SC-13).
    expect(countOf(ACCOUNT_SRC, "usePartnerBrandLinks()")).toBe(1);
    expect(ACCOUNT_SRC).not.toContain("includeCancelled");
  });
});

describe("OQ-3 — cancelled rows shown greyed + sorted last (executed sort slice)", () => {
  test("the screen reads WITH cancelled rows", () => {
    expect(
      countOf(SRC, "usePartnerBrandLinks({ includeCancelled: true })"),
    ).toBe(1);
  });

  test("compareLinkRows: cancelled last; within cancelled, cancelled_at desc", () => {
    const combined = `${slice("const STATUS_RANK")}\n${slice(
      "export function compareLinkRows",
    )}`;
    const cmp = evalSlice<{ (a: Row, b: Row): number }>(
      combined,
      "compareLinkRows",
    );
    const active: Row = {
      status: "active",
      invited_at: "2026-07-01T00:00:00Z",
      first_split_at: "2026-07-02T00:00:00Z",
    };
    const cancelledOld: Row = {
      status: "cancelled",
      invited_at: "2026-07-03T00:00:00Z",
      cancelled_at: "2026-07-04T00:00:00Z",
    };
    const cancelledNew: Row = {
      status: "cancelled",
      invited_at: "2026-07-01T00:00:00Z",
      cancelled_at: "2026-07-10T00:00:00Z",
    };
    // Cancelled sorts AFTER active…
    expect(cmp(cancelledOld, active)).toBeGreaterThan(0);
    // …and within cancelled the most recent termination comes first.
    expect(cmp(cancelledNew, cancelledOld)).toBeLessThan(0);
    // Binding companion: the render sorts THROUGH this comparator.
    expect(countOf(SRC, ".sort(compareLinkRows)")).toBe(1);
  });

  test("cancelled recession + AA floor: base card, dimmed thumb, secondary name — quaternary BANNED", () => {
    expect(SRC).toContain('variant={cancelled ? "base" : "elevated"}');
    expect(SRC).toContain("opacity: 0.55");
    const nameStyle = slice("  brandNameCancelled:");
    expect(nameStyle).toContain("textTokens.secondary");
    // DESIGN §4.3 ban: 2.91:1 measured fail for meaningful text. Assert no
    // STYLE USAGE of the token (the ban note in a comment is fine).
    expect(SRC).not.toContain("color: textTokens.quaternary");
    expect(SRC).not.toContain("textTokens.quaternary,");
  });

  test("expired derivation: error dot + honest label; rank untouched", () => {
    expect(SRC).toContain("expired ? semantic.error : accent.warm");
    expect(SRC).toContain('"Invite expired"');
    // Rank map unchanged — awaiting_owner stays rank 0 (needs attention).
    const rank = slice("const STATUS_RANK");
    expect(rank).toContain("awaiting_owner: 0");
    expect(rank).toContain("cancelled: 3");
  });

  test("row a11y announces status, rows open the detail sheet (dashboard nav moved into it)", () => {
    expect(SRC).toContain("accessibilityLabel={`${brandName}, ${statusLabel}`}");
    expect(countOf(SRC, "handleOpenDetail(row)")).toBe(1);
    // The old direct row-tap push is gone from the row handler; the ONLY
    // wizard push is the add CTA and the only dashboard nav lives in the sheet.
    expect(SRC).not.toContain("handleOpenBrand");
  });
});
