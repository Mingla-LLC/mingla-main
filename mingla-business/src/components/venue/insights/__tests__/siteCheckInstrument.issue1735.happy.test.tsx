/**
 * Issue #1735 — SiteCheckInstrument state contract (T-G3/T-G4/T-G5/T-G13
 * happy halves).
 *
 * Fails-on-revert anchors: (1) T-G4 — deleting the websiteState
 * error-vs-none DISTINCTION (rendering the empty state on a ctx error) turns
 * the "never conflated" assertions RED; (2) T-G5 — deleting the normalized
 * stale compare (`websitesDiffer`) turns the case/space-variant stale
 * assertions RED, and the no-auto-run assertion pins zero run calls on
 * render; (3) T-G13 — the 429 quota copy + disabled CTA and the offline line.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ReactLocal = require("react") as typeof React;

// House-atom boundary stubs — the units under test are the instrument's OWN
// state machine + copy, not the atoms (they have their own suites).
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
jest.mock("../GraderReportSections", () => ({
  __esModule: true,
  GraderReportSections: (props: Record<string, unknown>) =>
    ReactLocal.createElement("GraderReportSections", props),
}));

import {
  SiteCheckInstrument,
  type SiteCheckInstrumentProps,
} from "../SiteCheckInstrument";
import { GrowthToolsAppError } from "../../../../services/growthToolsService";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown; testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const allText = (tree: RenderTree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");

// HOST nodes only — react-test-renderer surfaces both a mock component fiber
// and its host element for the same testID.
const byTestId = (tree: RenderTree, testID: string): RenderNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const mountedTrees: RenderTree[] = [];
afterEach(() => {
  // Unmount everything so IntelProgress' elapsed-time interval never outlives
  // a test (open-handle hang).
  for (const tree of mountedTrees) tree.unmount();
  mountedTrees.length = 0;
});

const baseProps = (over: Partial<SiteCheckInstrumentProps> = {}): SiteCheckInstrumentProps => ({
  venueName: "Bar Toto",
  venueCity: "London",
  websiteState: { kind: "ready", website: "https://bartoto.com" },
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

const render = async (
  props: SiteCheckInstrumentProps,
): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<SiteCheckInstrument {...props} />);
  });
  mountedTrees.push(tree!);
  return tree!;
};

const verdictFixture = (over: Record<string, unknown> = {}) => ({
  report: {
    venue: { name: "Bar Toto", city: "London", website: "https://bartoto.com" },
    scores: {
      grade: "B",
      overall: 74,
      first_impression: 80,
      findability: 60,
      mobile: 70,
      menu_offers: 50,
      occasion_signal: 40,
      reasons: { first_impression: "Strong hero image and clear identity." },
    },
    fixes: [{ title: "f1" }, { title: "f2" }, { title: "f3" }],
    meta: { generated_at: "2026-08-01T00:00:00Z", schema_version: 1 },
    ...over,
  },
  checkedAtIso: "2026-08-01T00:00:00Z",
  cached: false,
});

describe("issue #1735 SiteCheckInstrument (T-G4 — none vs error, never conflated)", () => {
  it("no-website ⇒ the honest empty state with the Add-website door", async () => {
    const tree = await render(baseProps({ websiteState: { kind: "none" } }));
    const text = allText(tree);
    expect(text).toContain(
      "No website on file for Bar Toto. Add one and we'll grade it — or keep an eye on the competition below while you decide.",
    );
    expect(byTestId(tree, "site-check-instrument-add-website")).toHaveLength(1);
    // NEVER the error idiom on absence.
    expect(text).not.toContain("Couldn't load your website on file");
  });

  it("ctx ERROR ⇒ the visible retry idiom — NEVER the empty state", async () => {
    const tree = await render(baseProps({ websiteState: { kind: "error" } }));
    const text = allText(tree);
    expect(text).toContain("Couldn't load your website on file — retry.");
    expect(byTestId(tree, "site-check-instrument-website-retry")).toHaveLength(1);
    expect(text).not.toContain("No website on file");
  });

  it("latest-read error with no verdict ⇒ visible error + retry (standing idiom)", async () => {
    const tree = await render(baseProps({ latestError: true }));
    expect(allText(tree)).toContain("Couldn't load your site check — try again.");
    expect(byTestId(tree, "site-check-instrument-latest-retry")).toHaveLength(1);
  });
});

describe("issue #1735 SiteCheckInstrument (T-G3 first-run + running)", () => {
  it("first-run: headline + read-only website row + CTA gated on name/city validity", async () => {
    const props = baseProps({ venueCity: null }); // city prefills "" ⇒ invalid
    const tree = await render(props);
    const text = allText(tree);
    expect(text).toContain("How does your website treat your guests?");
    expect(text).toContain("https://bartoto.com");
    const cta = byTestId(tree, "site-check-instrument-run-cta");
    expect(cta).toHaveLength(1);
    expect(cta[0]!.props.disabled).toBe(true); // city 0 chars < 2 — engine bound
    // The instrument NEVER auto-runs (G-7): zero run calls on render.
    expect(props.onRun).not.toHaveBeenCalled();
    // The website is a READ-ONLY row — no third input for it.
    const inputs = tree.root.findAll((n) => n.type === "Input");
    expect(inputs).toHaveLength(2);
  });

  it("valid inputs enable the CTA; tapping runs with trimmed name/city", async () => {
    const props = baseProps();
    const tree = await render(props);
    const cta = byTestId(tree, "site-check-instrument-run-cta")[0]!;
    expect(cta.props.disabled).toBe(false);
    (cta.props.onPress as () => void)();
    expect(props.onRun).toHaveBeenCalledWith({ name: "Bar Toto", city: "London" });
  });

  it("running renders the staged script with the real domain, height-stable", async () => {
    const tree = await render(baseProps({ running: true }));
    const text = allText(tree);
    expect(text).toContain("Reading bartoto.com…");
    expect(text).toContain("Scoring what visitors see…");
    expect(text).toContain("Sizing up nearby competition…");
    expect(text).toContain("Building your report…");
    expect(byTestId(tree, "site-check-instrument-running")).toHaveLength(1);
    tree.unmount(); // clears the elapsed-time interval
  });
});

describe("issue #1735 SiteCheckInstrument (standing verdict + T-G5 stale)", () => {
  it("standing verdict: grade + strength + fixes count + checked date + re-check", async () => {
    const tree = await render(baseProps({ verdict: verdictFixture() }));
    const text = allText(tree);
    expect(text).toContain("B"); // grade badge letter
    expect(text).toContain("Strong hero image and clear identity.");
    expect(text).toContain("3 fixes waiting");
    expect(text).toContain("Checked");
    expect(byTestId(tree, "site-check-instrument-recheck")).toHaveLength(1);
    // Tap-anywhere opens the report when the card mode provides the handler.
  });

  it("T-G5: case/space website variants do NOT read as stale (normalized compare)", async () => {
    const props = baseProps({
      websiteState: { kind: "ready", website: "  HTTPS://BarToto.com  " },
      verdict: verdictFixture(),
    });
    const tree = await render(props);
    expect(byTestId(tree, "site-check-instrument-stale")).toHaveLength(0);
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("T-G5: a genuinely different on-file website dims + asks — and NEVER auto-runs", async () => {
    const props = baseProps({
      websiteState: { kind: "ready", website: "https://newbartoto.com" },
      verdict: verdictFixture(),
    });
    const tree = await render(props);
    const stale = byTestId(tree, "site-check-instrument-stale");
    expect(stale).toHaveLength(1);
    expect(allText(tree)).toContain("Your website changed — re-check?");
    expect(props.onRun).not.toHaveBeenCalled(); // stale NEVER auto-runs
  });

  it("cached re-serve renders the honest same-answer copy", async () => {
    const tree = await render(
      baseProps({ verdict: { ...verdictFixture(), cached: true } }),
    );
    expect(allText(tree)).toContain(
      "Checked earlier today — same inputs, same answer.",
    );
  });
});

describe("issue #1735 SiteCheckInstrument (T-G13 — 429 / error / offline)", () => {
  it("429 scope:brand ⇒ the quota copy + disabled CTA", async () => {
    const tree = await render(
      baseProps({
        verdict: verdictFixture(),
        runError: new GrowthToolsAppError("rate_limited", { scope: "brand" }),
      }),
    );
    expect(allText(tree)).toContain(
      "You've used today's checks — they refresh tomorrow.",
    );
    expect(byTestId(tree, "site-check-instrument-recheck")[0]!.props.disabled).toBe(
      true,
    );
  });

  it("a failed run SPEAKS with the retry copy (never hidden)", async () => {
    const tree = await render(
      baseProps({
        verdict: verdictFixture(),
        runError: new GrowthToolsAppError("generation_failed", {
          reason: "timeout",
        }),
      }),
    );
    expect(allText(tree)).toContain("Couldn't finish the check — try again.");
  });

  it("offline ⇒ the offline line + disabled CTA", async () => {
    const tree = await render(baseProps({ offline: true }));
    expect(allText(tree)).toContain("You're offline — checks need a connection.");
    expect(byTestId(tree, "site-check-instrument-run-cta")[0]!.props.disabled).toBe(
      true,
    );
  });
});
