/*
 * #4453 milestone 10 — the Host app's "See your site in three styles":
 *   - SITES_PLAN_PREVIEW off (Core sends no `plan_preview`): planPreview is
 *     false and Website setup shows the existing look picker, unchanged;
 *   - Core's answer is normalised to cards on the plan host only (never an
 *     origin Core did not name), with Ari's picks and the skipped line;
 *   - the confirm sheet's sentence lists the page set;
 *   - asking for previews writes nothing: only "Start the build" saves the
 *     design and runs Build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePlanPreview, planPreviewUrl } from "../../../../sites/planPreviewApi";
import { normalizeSitePlan } from "../../../../sites/sitePlanState";
import { planBuildSentence, planPreviewPicks } from "../../../../../../packages/site-contracts/src/planPreview";

const KEY = `plan-previews/aaaaaaaa-1111-4111-8111-0000000010b1/plan-${"a".repeat(32)}/${"d".repeat(64)}.json`;

describe("#4453 M10 plan preview (Host)", () => {
  it("flag off: the plan read carries no plan_preview and the setup screen keeps the look picker", () => {
    const off = normalizeSitePlan("b", { plan: { brand_id: "b", revision: 1 } });
    expect(off.planPreview).toBe(false);
    const on = normalizeSitePlan("b", { plan: { brand_id: "b", revision: 1 }, plan_preview: true });
    expect(on.planPreview).toBe(true);
    const screen = readFileSync(join(__dirname, "../../setup/WebsiteSetupScreen.tsx"), "utf8");
    expect(screen).toMatch(/plan\.planPreview && !allStyles \? \(/);
    expect(screen).toMatch(/: <PlanDesignPart brandId=\{brandId\} planState=\{plan\} readOnly=\{readOnly\} onDone=/);
  });

  it("normalises Core's answer into cards on the plan host, with Ari's picks", () => {
    const state = normalizePlanPreview({
      format: "trips",
      picks: planPreviewPicks("trips"),
      skipped_line: "Ari skipped Pulse and Nocturne: x",
      previews: [{ style: "voyage", key: KEY, pages: [{ path: "", title: "Home" }, { path: "trips", title: "Trips" }], page_labels: ["Home", "Trips"] }],
      preview_origin: "https://preview.sites.usemingla.com",
      has_samples: true,
    });
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0]!.url).toBe(`https://preview.sites.usemingla.com/plan-preview?k=${encodeURIComponent(KEY)}`);
    expect(state.picks.map((pick) => pick.key)).toEqual(["voyage", "terra", "journal"]);
    expect(state.hasSamples).toBe(true);
    expect(normalizePlanPreview({ previews: [{ style: "voyage", key: KEY }], preview_origin: "javascript:alert(1)" }).cards).toEqual([]);
    expect(planPreviewUrl("https://preview.sites.usemingla.com", KEY, "/trips/")).toContain("&path=trips");
  });

  it("the confirm sheet lists the page set", () => {
    expect(planBuildSentence(["Home", "Trips", "About"], "trips")).toBe("Ari builds 3 pages: Home, Trips, About, plus a page for each trip.");
    expect(planBuildSentence(["Home", "Menu"], "restaurants")).toBe("Ari builds 2 pages: Home, Menu.");
  });

  it("only Start the build writes (save design, then Build); previews are a read", () => {
    const chooser = readFileSync(join(__dirname, "../PlanPreviewChooser.tsx"), "utf8");
    const writes = chooser.match(/\b(save|compose)\.mutate\(/g) ?? [];
    expect(writes).toEqual(["save.mutate(", "compose.mutate("]);
    expect(chooser.indexOf("save.mutate(")).toBeGreaterThan(chooser.indexOf("const startBuild"));
    expect(chooser).toMatch(/Platform\.OS === "web" \|\| index === active/);
  });

  it("the fixture harness is dev-only: it redirects in a release build and only __DEV__ exempts it from sign-in", () => {
    const harness = readFileSync(join(__dirname, "../../../../../app/__dev-plan-preview.tsx"), "utf8");
    expect(harness).toMatch(/if \(!__DEV__\) return <Redirect href="\/" \/>;/);
    const layout = readFileSync(join(__dirname, "../../../../../app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/const devHarness = __DEV__ && pathname === "\/__dev-plan-preview";/);
    // The chooser itself never reads the fixture.
    expect(readFileSync(join(__dirname, "../PlanPreviewChooser.tsx"), "utf8")).not.toMatch(/EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE/);
    expect(readFileSync(join(__dirname, "../../../../sites/planPreviewApi.ts"), "utf8")).not.toMatch(/EXPO_PUBLIC_PLAN_PREVIEW_FIXTURE/);
  });
});
