/**
 * #4453 m11 rework (spec v2.1 §3.1, tester P2-1) — Ari's page plan. Mounts the
 * real ToolProposalCard and the real plan sheet: the owner sees the page, each
 * block in order with its words or Ari's question, the content Ari has with
 * its source and what Ari still needs, before anything is written. Only the
 * plan's own "Add as a Draft" confirms; "Ask for something else" dismisses;
 * Cancel and a tap outside only close the sheet.
 * FAILS ON REVERT: route propose_site_page back to the generic card (button "Confirm").
 */
import React from "react";

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[]; findAll: (predicate: (node: Node) => boolean) => Node[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[]; findByProps: (props: Record<string, unknown>) => Node };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../services/lazyHostAdPlanService", () => ({ loadHostAdPlanService: () => new Promise(() => undefined) }));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: "CoverPickerSheet" }));
jest.mock("../../ui/GlassChrome", () => ({ GlassChrome: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../AriOrb", () => ({ AriOrb: "AriOrb" }));
jest.mock("../ToolEditForm", () => ({ ToolEditForm: "ToolEditForm", isToolProposalEditable: () => false }));
jest.mock("../../../hooks/useBrands", () => ({ useBrandCascadePreview: () => ({ data: null, isLoading: false }) }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("lucide-react-native", () => ({ AlertTriangle: "AlertTriangle", Pencil: "Pencil", Play: "Play", Plus: "Plus", X: "X" }));
jest.mock("../../../sites/planApi", () => ({ useBrandSitePlan: () => ({ data: { site: { designKey: "atelier" } } }) }));

// eslint-disable-next-line import/first
import { ToolProposalCard } from "../ToolProposalCard";
// eslint-disable-next-line import/first
import { sitePagePlan } from "../sitePagePlan";
// eslint-disable-next-line import/first
import { SITE_PAGE_PLAN_COPY } from "../toolProposalCopy";

const ARGS = {
  brand_id: "6f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b10",
  site_id: "7f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b11",
  expected_site_revision: "a".repeat(64),
  request: "Add a page to my website about private hire",
  page: { title: "Private hire", menu_label: "Private hire", slug: "private-hire" },
  blocks: [
    { type: "page_header", variant: "plain", heading: "Private hire" },
    { type: "team", variant: "grid", heading: "Who looks after you", members: [{ name: "Ada" }, { name: "Tunde" }] },
  ],
  have: [
    { text: "Your trips and their prices on Mingla", source: "mingla_record", ref: "trips" },
    { text: "Our team is Ada and Tunde", source: "owner_words" },
  ],
  questions: [{ key: "ada_role", question: "What does Ada do on the night?", block_index: 1, field_path: "members.0.role" }],
  why: "You asked for a page about private hire.",
};

const textOf = (renderer: ReturnType<typeof TestRenderer.create>): string =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map((node) => node.children.filter((c) => typeof c === "string").join("")).join("\n");
const press = async (renderer: ReturnType<typeof TestRenderer.create>, testID: string) => {
  const node = renderer.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (!node) throw new Error(`no ${testID}`);
  await TestRenderer.act(async () => { (node.props.onPress as () => void)(); for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
};
// The plan sheet's Modal (the one whose onRequestClose closes the plan): its `visible` prop.
const visible = (renderer: ReturnType<typeof TestRenderer.create>): boolean =>
  renderer.root.findAll((n) => typeof n.props.onRequestClose === "function" && "visible" in n.props && n.props.transparent === true)
    .some((n) => n.props.visible === true);

async function mount(onConfirm = jest.fn(async () => ({ ok: true })), onCancel = jest.fn()) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<ToolProposalCard toolName="propose_site_page" args={ARGS} isExecuting={false} onConfirm={onConfirm} onCancel={onCancel} />);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return { renderer, onConfirm, onCancel };
}

describe("#4453 m11 rework Ari's page plan card", () => {
  it("the card names the page and says Add as a Draft, never Confirm; it writes nothing on its own", async () => {
    const { renderer, onConfirm } = await mount();
    const text = textOf(renderer);
    expect(text).toContain("THE PLAN · DRAFT");
    expect(text).toContain("Private hire");
    expect(text).toContain("Added to your menu as a Draft.");
    expect(text).toContain(SITE_PAGE_PLAN_COPY.noGuess);
    expect(text).toContain("Add as a Draft");
    expect(text).toContain("Ask for something else");
    expect(text).not.toMatch(/^Confirm$/m);
    expect(visible(renderer)).toBe(false);
    await press(renderer, "site-page-plan-card-open");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(visible(renderer)).toBe(true);
  });

  it("the plan shows every block in order with its words or Ari's question, the content with its source, and what Ari needs", async () => {
    const { renderer } = await mount();
    await press(renderer, "site-page-plan-card-open");
    const text = textOf(renderer);
    for (const line of [
      "The plan · Draft".toUpperCase(), "Added to your menu as a Draft, in Atelier.",
      "Blocks", "1. Page header", "2. Team", "Who looks after you", "Ada", "Tunde",
      "Ari needs this: What does Ada do on the night?",
      "Content I have", "Your trips and their prices on Mingla", "From Mingla", "Our team is Ada and Tunde", "Your words",
      "I still need from you", "What does Ada do on the night?",
      "I won't guess prices, people or policies. Gaps stay hidden from visitors until you fill them.",
    ]) expect(text).toContain(line);
    expect(text.indexOf("1. Page header")).toBeLessThan(text.indexOf("2. Team"));
  });

  it("only the plan's Add as a Draft confirms (once), and closes the plan", async () => {
    const { renderer, onConfirm, onCancel } = await mount();
    await press(renderer, "site-page-plan-card-open");
    await press(renderer, "site-page-plan-add");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(visible(renderer)).toBe(false);
  });

  it("Cancel and a tap outside only close the plan; Ask for something else dismisses the proposal", async () => {
    const { renderer, onConfirm, onCancel } = await mount();
    await press(renderer, "site-page-plan-card-open");
    await press(renderer, "site-page-plan-cancel");
    expect(visible(renderer)).toBe(false);
    await press(renderer, "site-page-plan-card-open");
    await press(renderer, "site-page-plan-scrim");
    expect(visible(renderer)).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    await press(renderer, "site-page-plan-card-open");
    await press(renderer, "site-page-plan-dismiss");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the scrim is a sibling behind the dialog, never its parent (no <button> inside a <button> on web)", async () => {
    const { renderer } = await mount();
    await press(renderer, "site-page-plan-card-open");
    const scrims = renderer.root.findAll((n) => n.props.testID === "site-page-plan-scrim" && typeof n.props.onPress === "function");
    expect(scrims.length).toBeGreaterThan(0);
    for (const scrimNode of scrims) {
      // Nothing pressable and no dialog content inside the scrim (the scrim's own
      // host node repeats its testID, so it is excluded by testID).
      const inner = scrimNode.findAll((n: Node) => n.props.testID !== "site-page-plan-scrim" && (typeof n.props.onPress === "function" || n.props.testID === "site-page-plan-sheet"));
      expect(inner).toHaveLength(0);
    }
    // The dialog itself is not a pressable, so a tap inside never closes the plan.
    const dialogs = renderer.root.findAll((n) => n.props.testID === "site-page-plan-sheet");
    expect(dialogs.length).toBeGreaterThan(0);
    for (const dialog of dialogs) expect(dialog.props.onPress).toBeUndefined();
    // The dialog's own buttons are still there and still work.
    expect(renderer.root.findAll((n) => n.props.testID === "site-page-plan-add" && typeof n.props.onPress === "function").length).toBeGreaterThan(0);
    expect(visible(renderer)).toBe(true);
  });

  it("a failed add keeps the plan open with the reason", async () => {
    const { renderer } = await mount(jest.fn(async () => ({ ok: false, error: "That plan is out of date." })));
    await press(renderer, "site-page-plan-card-open");
    await press(renderer, "site-page-plan-add");
    expect(visible(renderer)).toBe(true);
    expect(textOf(renderer)).toContain("That plan is out of date.");
  });

  it("the plan model never shows links or ids, and labels an unknown block plainly", () => {
    const plan = sitePagePlan({ page: { title: "X" }, blocks: [{ type: "cta", variant: "v", heading: "Ask", cta_href: "https://evil.example", page_id: "p1" }, { type: "made_up" }] });
    expect(plan.blocks[0]).toMatchObject({ label: "Call to action", lines: ["Ask"] });
    expect(plan.blocks[1]!.label).toBe("Made up");
  });
});

// #3493 boot payload: Expo moves every module two async web chunks share into
// the eager __common chunk. The plan sheet therefore loads through the Website
// editor's chunk (which already holds planApi and the site-contracts
// catalogue) and takes its copy as a prop, so it never pulls the Ari copy
// module into the Website chunk. FAILS-ON-REVERT: a separate dynamic import of
// ./SitePagePlanSheet, or a runtime import of toolProposalCopy here, puts
// ~137 KB back in __common.
describe("#4453 plan sheet stays off the eager web chunk", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  const src = (rel: string): string => readFileSync(join(__dirname, "..", rel), "utf8");
  it("the web lazy sheet imports the Website editor chunk, and WebsiteApp re-exports the sheet", () => {
    const lazy = src("LazySitePagePlanSheet.web.tsx");
    expect(lazy).toMatch(/import\("\.\.\/sites\/website\/WebsiteApp"\)\)\.SitePagePlanSheet/);
    expect(lazy).not.toMatch(/import\("\.\/SitePagePlanSheet"\)/);
    expect(src("../sites/website/WebsiteApp.tsx")).toMatch(/export \{ SitePagePlanSheet \} from "\.\.\/\.\.\/ari\/SitePagePlanSheet";/);
  });
  it("the sheet and its plan model import no Ari copy at runtime", () => {
    for (const rel of ["SitePagePlanSheet.tsx", "sitePagePlan.ts"]) {
      const lines = src(rel).split("\n").filter((line) => /from "\.\/toolProposalCopy"/.test(line));
      for (const line of lines) expect(line).toMatch(/^export type |^import type /);
    }
  });
});
