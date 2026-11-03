/**
 * #4238 wave 2 retest 4 — TESTER adversarial (different angle from the
 * implementor's hand-picked "live" / "ended" fixtures).
 *
 * The rework hides a "Continue draft" row once its ad was created on the
 * apps. This test does not trust a hand-written list of states. It reads the
 * plan state machine from the migration that owns it
 * (ad_plan_state_transition_guard), walks every state an ad can reach once
 * the apps have it (from platform_review onward, never back through
 * draft / cancelled / creation_failed_*), and drives the REAL
 * listHostAdWorkspace → buildHostAdList path for each one with the ad-plan
 * answer shaped like the server's `list` action.
 *
 * For every such state, with the plan's own `get` failing (so no plan row can
 * hide the draft), the finished draft must still be hidden, while a draft
 * with no plan and a draft whose plan went back to `draft` stay visible.
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import { listHostAdWorkspace, type HostAdDraft } from "../hostAdPlanService";
// eslint-disable-next-line import/first
import { buildHostAdList } from "../hostAdLifecycle";

const invokeMock = supabase.functions.invoke as jest.Mock;

const MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20271101003697_issue_3697_v14_control_plane.sql",
);

function stateMachine(): { states: string[]; edges: [string, string][] } {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const check = /state text NOT NULL DEFAULT 'draft' CHECK \(state IN \(([\s\S]*?)\)\)/.exec(sql);
  if (!check) throw new Error("ad_plans state CHECK not found");
  const states = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const guardStart = sql.indexOf("FUNCTION public.ad_plan_state_transition_guard");
  const guardEnd = sql.indexOf("RAISE EXCEPTION 'ad_plan_state_transition_invalid", guardStart);
  if (guardStart < 0 || guardEnd < 0) throw new Error("transition guard not found");
  const edges = [...sql.slice(guardStart, guardEnd).matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
  return { states, edges };
}

/** States an ad can be in after the apps created it. */
function createdOnTheApps(edges: [string, string][]): Set<string> {
  const notCreated = new Set(["draft", "cancelled_before_create", "creation_failed_retryable", "creation_failed_terminal"]);
  const seen = new Set<string>(["platform_review"]);
  const queue = ["platform_review"];
  while (queue.length) {
    const from = queue.shift() as string;
    for (const [a, b] of edges) {
      if (a === from && !notCreated.has(b) && !seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return seen;
}

const draft = (id: string, planId: string | null): HostAdDraft =>
  ({
    id,
    plan_id: planId,
    revision: 1,
    current_step: "review",
    draft_state: { form: { name: "Deserted Island — past guests" } },
    updated_at: "2026-11-02T10:00:00Z",
  }) as unknown as HostAdDraft;

async function listFor(state: string) {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === "list") {
      return {
        data: {
          ok: true,
          plans: [
            { id: "p-under-test", state, current_version_id: "v-under-test", brand_id: "b1" },
            { id: "p-back-to-draft", state: "draft", current_version_id: "v-back", brand_id: "b1" },
          ],
          drafts: [
            draft("d-finished-1", "p-under-test"),
            draft("d-finished-2", "p-under-test"),
            draft("d-no-plan", null),
            draft("d-back-to-draft", "p-back-to-draft"),
          ],
        },
        error: null,
      };
    }
    // The plan's own read fails: no plan row exists to hide its drafts.
    return {
      data: null,
      error: Object.assign(new Error("x"), { context: { json: async () => ({ error: "plan_lookup_failed" }) } }),
    };
  });
  const workspace = await listHostAdWorkspace("b1");
  return buildHostAdList({ ...workspace, campaigns: [] })
    .filter((item) => item.kind === "draft")
    .map((item) => item.id)
    .sort();
}

describe("#4238 a draft is finished in EVERY state the apps already have the ad", () => {
  const { states, edges } = stateMachine();
  const created = createdOnTheApps(edges);

  it("reads a real state machine (guards against a silent parse of nothing)", () => {
    expect(states.length).toBeGreaterThanOrEqual(25);
    expect(edges.length).toBeGreaterThanOrEqual(40);
    for (const state of created) expect(states).toContain(state);
    expect(created.has("live")).toBe(true);
    expect(created.has("ended")).toBe(true);
    expect(created.has("settlement_attention_required")).toBe(true);
  });

  const reachable = [...createdOnTheApps(stateMachine().edges)]
    // creating_paused_objects shows as its own plan row (in progress); its
    // drafts are hidden by that row, not by the launched rule.
    .filter((state) => state !== "creating_paused_objects")
    .sort();

  it.each(reachable)("state %s: its drafts are gone, other drafts stay", async (state) => {
    const ids = await listFor(state);
    expect(ids).not.toContain("d-finished-1");
    expect(ids).not.toContain("d-finished-2");
    expect(ids).toEqual(["d-back-to-draft", "d-no-plan"]);
  });

  it("a plan that went back to draft keeps its draft (the Host is editing again)", async () => {
    const ids = await listFor("draft");
    expect(ids).toEqual(["d-back-to-draft", "d-finished-1", "d-finished-2", "d-no-plan"]);
  });
});
