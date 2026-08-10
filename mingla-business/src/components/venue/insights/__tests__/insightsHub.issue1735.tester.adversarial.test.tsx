/**
 * Issue #1735 — TESTER ADVERSARIAL suite (append-only; different angles than
 * the implementor's happy-path suites).
 *
 * T-ADV-1  Diff-chip FABRICATION attacks: cross-schema_version pairs carrying
 *          genuine signal flips, reports with `site_signals` missing entirely,
 *          fetch_failed on the PREV side, all-invalid statuses, a flip on a
 *          key OUTSIDE the 11-key allowlist, and an overall-only change —
 *          every one must degrade honestly (grade-only or zero chips), never
 *          invent a chip (I-PROPOSED-1735-COMPETITOR-DIFF-DETERMINISTIC).
 * T-ADV-2  Cache-key cross-venue bleed: two venues of the SAME brand must
 *          never share a subject/watch key — including concatenation-collision
 *          shaped ids — and venue vs competitor subjects must never collide.
 * T-ADV-3  no-website → add-website transition + stale-state NEVER auto-refires:
 *          zero `onRun` calls across renders, prop transitions, and input
 *          edits (G-7: explicit taps only).
 * T-ADV-4  Watch list at exactly 5: the add CTA is disabled client-side with
 *          the cap copy; the server 409s (`watch_limit` / `duplicate_competitor`)
 *          surface their two DISTINCT honest copies in the add sheet.
 * T-ADV-5  RQ-cache-only rule, second enforcement mechanism: a jest-level fs
 *          sweep of src/store/ for growth-tools references (independent of the
 *          CI strict-grep gate — defeating one still trips the other).
 *
 * Fails-on-revert anchors (true line deletion, verified):
 *  A1 — delete the `GRADER_SIGNAL_KEYS.includes` allowlist check in
 *       graderReportDiff.ts → the non-allowlisted-key test goes RED.
 *  A2 — delete the empty-checks clause in `unreadable()` → the
 *       missing-site_signals test goes RED.
 *  A3 — delete the no-website early-return branch in SiteCheckInstrument →
 *       the transition test goes RED.
 *  A4 — delete `atCap` from the add Button's `disabled` expression →
 *       the cap test goes RED.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ReactLocal = require("react") as typeof React;

// ── House-atom + boundary stubs (the units under test are the insights
// components' own state machines and the pure diff fn — not the atoms). ─────
jest.mock("../../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Button", props),
}));
jest.mock("../../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Input", props),
}));
jest.mock("../../../ui/Skeleton", () => ({
  __esModule: true,
  Skeleton: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Skeleton", props),
}));
jest.mock("../../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: (props: { children?: unknown; testID?: string }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));
jest.mock("../../../ui/Sheet", () => ({
  __esModule: true,
  Sheet: (props: { children?: unknown; visible?: boolean; testID?: string }) =>
    props.visible === true
      ? ReactLocal.createElement("Sheet", props, props.children as never)
      : null,
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (props: Record<string, unknown>) =>
    ReactLocal.createElement("ConfirmDialog", props),
}));
jest.mock("../GraderReportSections", () => ({
  __esModule: true,
  GraderReportSections: (props: Record<string, unknown>) =>
    ReactLocal.createElement("GraderReportSections", props),
}));
jest.mock("../../../../analytics/businessAnalyticsEvents", () => ({
  __esModule: true,
  captureIntelCardShown: jest.fn(),
  captureIntelRunStarted: jest.fn(),
  captureIntelRunCompleted: jest.fn(),
  captureIntelRunFailed: jest.fn(),
  captureIntelReportOpened: jest.fn(),
  captureIntelCompetitorAdded: jest.fn(),
  captureIntelCompetitorGraded: jest.fn(),
}));
jest.mock("../../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ loading: false, session: { user: { id: "tester" } } }),
}));

// Controllable growth-tools hooks (CompetitorWatchSection + CompetitorAddSheet
// read these; SiteCheckInstrument is presentational and does not).
const mockUseCompetitorWatch = jest.fn();
const mockUseIntelRun = jest.fn();
const mockUseRemoveCompetitor = jest.fn();
const mockUseIntelSubjectLatest = jest.fn();
const mockUseAddCompetitor = jest.fn();
jest.mock("../../../../hooks/useGrowthTools", () => ({
  __esModule: true,
  useCompetitorWatch: (...args: unknown[]) => mockUseCompetitorWatch(...args),
  useIntelRun: (...args: unknown[]) => mockUseIntelRun(...args),
  useRemoveCompetitor: (...args: unknown[]) => mockUseRemoveCompetitor(...args),
  useIntelSubjectLatest: (...args: unknown[]) =>
    mockUseIntelSubjectLatest(...args),
  useAddCompetitor: (...args: unknown[]) => mockUseAddCompetitor(...args),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  diffGraderReports,
  GRADER_SIGNAL_KEYS,
} from "../graderReportDiff";
import { growthToolsKeys } from "../../../../hooks/growthToolsKeys";
import {
  GrowthToolsAppError,
  type CompetitorWatchRow,
  type GraderReport,
} from "../../../../services/growthToolsService";
import {
  SiteCheckInstrument,
  type SiteCheckInstrumentProps,
} from "../SiteCheckInstrument";
import { CompetitorWatchSection } from "../CompetitorWatchSection";
import { CompetitorAddSheet } from "../CompetitorAddSheet";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown; testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const mountedTrees: RenderTree[] = [];
afterEach(() => {
  for (const tree of mountedTrees) tree.unmount();
  mountedTrees.length = 0;
  jest.clearAllMocks();
});

const byTestId = (tree: RenderTree, testID: string): RenderNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const allText = (tree: RenderTree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");

// ── Report fixtures ─────────────────────────────────────────────────────────

const checksFrom = (
  entries: [string, string][],
): { key: string; label: string; status: string }[] =>
  entries.map(([key, status]) => ({ key, label: key, status }));

const reportWith = (over: Partial<GraderReport> = {}): GraderReport => ({
  venue: { name: "Bar Toto", city: "London", website: "https://bartoto.co" },
  scores: { grade: "B", overall: 78 },
  site_signals: {
    checks: checksFrom([
      ["https", "pass"],
      ["title_tag", "pass"],
      ["menu_reachable", "warn"],
    ]),
  },
  meta: { schema_version: 1 },
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════
describe("T-ADV-1 — diff-chip fabrication attacks (grade-only degradation binds)", () => {
  it("cross-schema_version pair WITH genuine signal flips still yields ZERO signal chips", () => {
    const prev = reportWith({
      scores: { grade: "C", overall: 60 },
      meta: { schema_version: 1 },
      site_signals: {
        checks: checksFrom([
          ["https", "fail"],
          ["title_tag", "fail"],
          ["menu_reachable", "fail"],
        ]),
      },
    });
    const latest = reportWith({
      scores: { grade: "B", overall: 78 },
      meta: { schema_version: 2 },
      site_signals: {
        checks: checksFrom([
          ["https", "pass"],
          ["title_tag", "pass"],
          ["menu_reachable", "pass"],
        ]),
      },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.chips.filter((c) => c.kind === "signal")).toHaveLength(0);
    expect(diff.chips).toHaveLength(1); // the grade chip only
    expect(diff.chips[0]?.kind).toBe("grade");
  });

  it("latest report MISSING site_signals entirely ⇒ unreadable degradation dated to the latest run — never fabricated chips", () => {
    const prev = reportWith();
    const latest = reportWith({ site_signals: undefined });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.unreadableOnIso).toBe("2026-08-09T00:00:00Z");
    expect(diff.chips.filter((c) => c.kind === "signal")).toHaveLength(0);
  });

  it("fetch_failed on the PREV side ⇒ unreadable dated to the PREV run", () => {
    const prev = reportWith({
      meta: { schema_version: 1, fetch_failed: true },
    });
    const latest = reportWith();
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.unreadableOnIso).toBe("2026-08-01T00:00:00Z");
    expect(diff.chips.filter((c) => c.kind === "signal")).toHaveLength(0);
  });

  it("checks whose statuses are ALL invalid strings are unreadable, not chip material", () => {
    const prev = reportWith();
    const latest = reportWith({
      site_signals: {
        checks: checksFrom([
          ["https", "PASS"], // uppercase — not a valid status
          ["title_tag", "excellent"], // garbage
        ]),
      },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.degradedToGradeOnly).toBe(true);
    expect(diff.chips.filter((c) => c.kind === "signal")).toHaveLength(0);
  });

  it("a status flip on a key OUTSIDE the 11-key allowlist never produces a chip", () => {
    expect(
      (GRADER_SIGNAL_KEYS as readonly string[]).includes("tiktok_embed"),
    ).toBe(false);
    const prev = reportWith({
      site_signals: {
        checks: checksFrom([
          ["https", "pass"],
          ["tiktok_embed", "fail"],
        ]),
      },
    });
    const latest = reportWith({
      site_signals: {
        checks: checksFrom([
          ["https", "pass"],
          ["tiktok_embed", "pass"], // flipped — but NOT an allowlisted key
        ]),
      },
    });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.chips).toHaveLength(0);
    expect(diff.degradedToGradeOnly).toBe(false);
  });

  it("overall-only movement (same grade) yields ZERO chips — overall is never its own chip", () => {
    const prev = reportWith({ scores: { grade: "B", overall: 70 } });
    const latest = reportWith({ scores: { grade: "B", overall: 84 } });
    const diff = diffGraderReports(
      { report: prev, createdAt: "2026-08-01T00:00:00Z" },
      { report: latest, createdAt: "2026-08-09T00:00:00Z" },
    );
    expect(diff.chips).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("T-ADV-2 — cache-key cross-venue bleed (same brand, two venues)", () => {
  it("subjectRead keys for two venues of the same brand are element-wise distinct", () => {
    const a = growthToolsKeys.subjectRead("brand-1", "venues", "venue:aaa", false);
    const b = growthToolsKeys.subjectRead("brand-1", "venues", "venue:bbb", false);
    expect(a).not.toEqual(b);
    // The subjectRef element itself must differ — never only trailing flags.
    expect(a[4]).not.toBe(b[4]);
  });

  it("watch keys for two venues of the same brand are distinct", () => {
    expect(growthToolsKeys.watch("brand-1", "venue-a")).not.toEqual(
      growthToolsKeys.watch("brand-1", "venue-b"),
    );
  });

  it("concatenation-collision shaped ids can never collide (array keys, element-wise)", () => {
    // "b1" + "venue:x" vs "b" + "1venue:x" concatenate identically — the
    // array shape must keep them distinct.
    const a = growthToolsKeys.subject("b1", "venues", "venue:x");
    const b = growthToolsKeys.subject("b", "venues", "1venue:x");
    expect(a).not.toEqual(b);
  });

  it("a venue subject and a competitor subject with the same raw id never share a key", () => {
    const a = growthToolsKeys.subject("brand-1", "venues", "venue:id-1");
    const b = growthToolsKeys.subject("brand-1", "venues", "competitor:id-1");
    expect(a).not.toEqual(b);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("T-ADV-3 — no-website → add-website transition; stale NEVER auto-refires", () => {
  const instrumentProps = (
    over: Partial<SiteCheckInstrumentProps> = {},
  ): SiteCheckInstrumentProps => ({
    venueName: "Bar Toto",
    venueCity: "London",
    websiteState: { kind: "ready", website: "https://bartoto.co" },
    onRetryWebsite: jest.fn(),
    onAddWebsite: jest.fn(),
    latestLoading: false,
    latestError: false,
    onRetryLatest: jest.fn(),
    verdict: null,
    running: false,
    runError: null,
    offline: false,
    onRun: jest.fn(),
    ...over,
  });

  it("no-website state shows the Add-website action; transitioning to a ready website swaps to first-run with ZERO run calls", async () => {
    const onRun = jest.fn();
    const props = instrumentProps({
      websiteState: { kind: "none" },
      onRun,
    });
    let tree!: RenderTree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactLocal.createElement(SiteCheckInstrument, props),
      );
      mountedTrees.push(tree);
    });
    expect(byTestId(tree, "site-check-instrument-no-website").length).toBeGreaterThan(0);
    expect(byTestId(tree, "site-check-instrument-add-website").length).toBeGreaterThan(0);
    expect(byTestId(tree, "site-check-instrument-run-cta")).toHaveLength(0);

    // The venue owner adds a website (tier2 editor roundtrip) — the instrument
    // transitions to first-run and must NOT auto-run.
    await TestRenderer.act(() => {
      tree.update(
        ReactLocal.createElement(
          SiteCheckInstrument,
          instrumentProps({
            websiteState: { kind: "ready", website: "https://bartoto.co" },
            onRun,
          }),
        ),
      );
    });
    expect(byTestId(tree, "site-check-instrument-no-website")).toHaveLength(0);
    expect(byTestId(tree, "site-check-instrument-first-run").length).toBeGreaterThan(0);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("stale-on-edit verdict + input edits + re-renders fire ZERO runs (explicit taps only)", async () => {
    const onRun = jest.fn();
    const staleProps = instrumentProps({
      verdict: {
        report: reportWith({
          venue: { name: "Bar Toto", city: "London", website: "https://old-site.co" },
        }),
        checkedAtIso: "2026-08-01T00:00:00Z",
        cached: false,
      },
      onRun,
    });
    let tree!: RenderTree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactLocal.createElement(SiteCheckInstrument, staleProps),
      );
      mountedTrees.push(tree);
    });
    // Stale line is up (on-file https://bartoto.co ≠ graded https://old-site.co).
    expect(byTestId(tree, "site-check-instrument-stale").length).toBeGreaterThan(0);

    // Re-render (a parent state change) — still zero runs.
    await TestRenderer.act(() => {
      tree.update(ReactLocal.createElement(SiteCheckInstrument, staleProps));
    });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("first-run input edits never fire a run — only the CTA does", async () => {
    const onRun = jest.fn();
    const props = instrumentProps({ onRun });
    let tree!: RenderTree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactLocal.createElement(SiteCheckInstrument, props),
      );
      mountedTrees.push(tree);
    });
    const nameInput = tree.root.findAll(
      (node) => node.props.testID === "site-check-instrument-name-input",
    )[0];
    expect(nameInput).toBeDefined();
    await TestRenderer.act(() => {
      (nameInput?.props.onChangeText as (v: string) => void)("Bar Toto Renamed");
    });
    await TestRenderer.act(() => {
      (nameInput?.props.onChangeText as (v: string) => void)("Bar Toto Again");
    });
    expect(onRun).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("T-ADV-4 — watch list at exactly 5 + honest server 409 copies", () => {
  const watchRow = (id: string): CompetitorWatchRow => ({
    id,
    name: `Competitor ${id}`,
    city: "London",
    website: `https://c${id}.co`,
    placePoolId: null,
    createdAt: "2026-08-01T00:00:00Z",
    latest: null,
  });

  const armWatchHooks = (rows: CompetitorWatchRow[]): void => {
    mockUseCompetitorWatch.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseIntelRun.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      error: null,
      data: undefined,
    });
    mockUseRemoveCompetitor.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      isError: false,
    });
    mockUseIntelSubjectLatest.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  };

  it("at exactly 5 rows the add CTA is DISABLED with the cap copy; at 4 it is enabled without it", async () => {
    armWatchHooks([1, 2, 3, 4, 5].map((n) => watchRow(String(n))));
    const onRequestAdd = jest.fn();
    let tree!: RenderTree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactLocal.createElement(CompetitorWatchSection, {
          brandId: "brand-1",
          venueListingId: "venue-1",
          offline: false,
          onRequestAdd,
          onOpenReport: jest.fn(),
        }),
      );
      mountedTrees.push(tree);
    });
    const addButtons = tree.root.findAll(
      (node) => node.props.testID === "competitor-watch-add",
    );
    expect(addButtons.length).toBeGreaterThan(0);
    expect(addButtons[0]?.props.disabled).toBe(true);
    expect(byTestId(tree, "competitor-watch-cap").length).toBeGreaterThan(0);
    expect(allText(tree)).toContain("Watching 5 of 5 — remove one to add another.");

    // 4 rows — enabled, no cap line.
    armWatchHooks([1, 2, 3, 4].map((n) => watchRow(String(n))));
    await TestRenderer.act(() => {
      tree.update(
        ReactLocal.createElement(CompetitorWatchSection, {
          brandId: "brand-1",
          venueListingId: "venue-1",
          offline: false,
          onRequestAdd,
          onOpenReport: jest.fn(),
        }),
      );
    });
    const addButtonsAt4 = tree.root.findAll(
      (node) => node.props.testID === "competitor-watch-add",
    );
    expect(addButtonsAt4[0]?.props.disabled).toBe(false);
    expect(byTestId(tree, "competitor-watch-cap")).toHaveLength(0);
  });

  const renderAddSheet = async (
    error: GrowthToolsAppError,
  ): Promise<RenderTree> => {
    mockUseAddCompetitor.mockReturnValue({
      mutate: jest.fn(),
      reset: jest.fn(),
      isPending: false,
      isError: true,
      error,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let tree!: RenderTree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactLocal.createElement(
          QueryClientProvider,
          { client },
          ReactLocal.createElement(CompetitorAddSheet, {
            visible: true,
            onClose: jest.fn(),
            brandId: "brand-1",
            venueListingId: "venue-1",
            venueCity: "London",
          }),
        ),
      );
      mountedTrees.push(tree);
    });
    // Enter the manual section (where the error line renders).
    const manualToggle = tree.root.findAll(
      (node) => node.props.testID === "competitor-add-sheet-manual-toggle",
    )[0];
    if (manualToggle !== undefined) {
      await TestRenderer.act(() => {
        (manualToggle.props.onPress as () => void)();
      });
    }
    return tree;
  };

  it("server 409 watch_limit surfaces the cap copy — honestly, not a generic error", async () => {
    const tree = await renderAddSheet(new GrowthToolsAppError("watch_limit"));
    expect(allText(tree)).toContain("Watching 5 of 5 — remove one to add another.");
  });

  it("server 409 duplicate_competitor surfaces its DISTINCT copy", async () => {
    const tree = await renderAddSheet(
      new GrowthToolsAppError("duplicate_competitor"),
    );
    expect(allText(tree)).toContain("You're already watching this site.");
    expect(allText(tree)).not.toContain("remove one to add another");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("T-ADV-5 — RQ-cache-only, second enforcement mechanism (jest-level store sweep)", () => {
  it("no file under src/store/ references the growth-tools client, types, or edge functions", () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    /* eslint-enable @typescript-eslint/no-var-requires */
    const storeDir = path.resolve(__dirname, "../../../../store");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(full);
      }
    };
    walk(storeDir);
    // Vacuity guard — the sweep must observe the real store directory.
    expect(files.length).toBeGreaterThanOrEqual(5);
    const tokens = [
      "growthToolsService",
      "growthToolsKeys",
      "useGrowthTools",
      "GraderReport",
      "GrowthToolRunResult",
      "SubjectLatestResult",
      "CompetitorWatchRow",
      "GrowthToolsAppError",
      "growth-tools-",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      for (const token of tokens) {
        if (code.includes(token)) offenders.push(`${file} → ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
