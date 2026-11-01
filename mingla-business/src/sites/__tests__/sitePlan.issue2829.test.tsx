/*
 * #2829 W9a (T-W9, SC-27/SC-28, R1 paths) — the Business website plan:
 *   - Home's to-do row: "Build your website" / "Finish your website · n of 8
 *     done · next: …" (admins and owners), "Your website · Ask an admin to
 *     start it" (marketing and event managers before a site exists), nothing
 *     for finance managers, scanners, brands without websites, a paused site
 *     or a published one; placed after getting paid and before profile polish;
 *   - each part's "Do it myself" route (the plan screen itself now lives in
 *     the Website section; its suite is websiteBehaviours.issue2829w9r);
 *   - "What you'll offer": the live menu line, stay only while switched on,
 *     unticking live items asks first, ticking nothing asks once;
 *   - the plan to approve is built only from the owner's answers;
 *   - every plan write shows Core's answer, never an optimistic tick.
 */
import React from "react";

jest.mock("../../components/ui/Button", () => ({
  Button: ({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
    require("react").createElement("mock-button", { onPress, disabled, testID }, label),
}));
jest.mock("../../components/ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => require("react").createElement("mock-card", null, children),
}));
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

import { WEBSITE_TODO_PART_LABELS, websiteTodoFor } from "../websiteTodo";
import { normalizeSitePlan, type SitePlanState } from "../sitePlanState";
import { approvedPlanFrom, untickedWithLiveItems } from "../planScreens";
import { firstOfferingRoute, planPartRoute } from "../planRoutes";
import { buildBusinessTodos, type BusinessTodoInput } from "../../utils/businessTodos";
import { SiteOfferingsView, type SiteOfferingsViewProps } from "../../components/sites/SiteOfferingsView";
import { SiteStoryView } from "../../components/sites/SiteStoryView";
import { PLAN_PARTS, mainActionChips, storyQuestions } from "../../../../packages/site-contracts/src/sitePlan.ts";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void) => void;
  create: (node: React.ReactElement) => {
    root: { findAll: (test: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{ type: unknown; props: Record<string, unknown>; children: unknown[] }> };
    toJSON: () => unknown;
  };
};

const BRAND = "00000000-0000-4000-8000-000000000002";
const PARTS_RAW = PLAN_PARTS.map((part) => ({ key: part.key, done: false, skipped: false, optional: part.optional }));

function answer(patch: Record<string, unknown> = {}) {
  return {
    brand_id: BRAND, entitled: true, rank: 60, can_manage: true, site: null, plan: null,
    status: { parts: PARTS_RAW, done_count: 0, next_part: "offer" },
    prefill_offerings: null, live_counts: { trips: 0, events: 0, experiences: 0 },
    lock: { active: false, held_by_me: false, holder_name: null, expires_at: null },
    ...patch,
  };
}

function flatten(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (node && typeof node === "object") return `${flatten((node as { children?: unknown }).children ?? [])}\n`;
  return "";
}
function textOf(tree: ReturnType<typeof create>): string {
  return flatten(tree.toJSON());
}
function byTestId(tree: ReturnType<typeof create>, id: string) {
  return tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
}

describe("#2829 W9a Home to-do row", () => {
  it("an empty brand (no plan, no site): Build your website, for admins and owners", () => {
    expect(websiteTodoFor(BRAND, answer())).toEqual({ variant: "build", route: `/brand/${BRAND}/website/plan` });
  });

  it("once started: Finish your website with Core's count and next part", () => {
    const started = answer({ plan: { revision: 3 }, status: { parts: PARTS_RAW, done_count: 3, next_part: "look" } });
    expect(websiteTodoFor(BRAND, started)).toEqual({ variant: "finish", route: `/brand/${BRAND}/website/plan`, done: 3, nextLabel: "Choose your design" });
  });

  it("marketing and event managers before a site: ask an admin; finance, scanners, revoked, paused, published: nothing", () => {
    expect(websiteTodoFor(BRAND, answer({ rank: 20, can_manage: false }))?.variant).toBe("ask");
    expect(websiteTodoFor(BRAND, answer({ rank: 40, can_manage: false }))?.variant).toBe("ask");
    expect(websiteTodoFor(BRAND, answer({ rank: 30, can_manage: false }))).toBeNull();
    expect(websiteTodoFor(BRAND, answer({ rank: 20, can_manage: false, site: { id: "s" } }))).toBeNull();
    expect(websiteTodoFor(BRAND, { entitled: false, rank: 60 })).toBeNull();
    expect(websiteTodoFor(BRAND, answer({ site: { id: "s", published: true } }))).toBeNull();
    expect(websiteTodoFor(BRAND, answer({ site: { id: "s", paused: true } }))).toBeNull();
  });

  it("names parts exactly as site-contracts does", () => {
    expect(WEBSITE_TODO_PART_LABELS).toEqual(Object.fromEntries(PLAN_PARTS.map((part) => [part.key, part.label])));
  });

  const base: BusinessTodoInput = {
    hasNoBrands: false, hasBrandsButNoSelection: false, brandResolving: false, hasBrand: true,
    pipelineFetched: true, pipelineStatus: null, pipelineRoute: "", venueDraftInProgress: false,
    counts: { total: 1, live: 1, draft: 0 }, stripeActive: false, hasDraftPaidOffering: false,
    stripeRoute: "/stripe", draftRoute: null, venueClaimPending: false, venueListingRoute: "",
    venueClaimOpenFeedbackCount: 0, venueFeedbackRoute: "",
    profile: { needsCover: true, needsPhoto: false, needsTagline: false, needsDescription: false, needsAddress: false, needsEmail: false, needsPhone: false, needsSocials: false, editRoute: "/brand/x/edit" },
  };

  it("sits after getting paid and before profile polish, with the design contract's words", () => {
    const todos = buildBusinessTodos({ ...base, website: { variant: "build", route: "/brand/x/website/plan" } });
    expect(todos.map((todo) => todo.id)).toEqual(["connect_stripe", "website_build", "profile_add_cover"]);
    expect(todos[1]).toMatchObject({ label: "Build your website", sublabel: "Ari walks you through it · about 15 min", action: { kind: "route", route: "/brand/x/website/plan" } });
    const finish = buildBusinessTodos({ ...base, website: { variant: "finish", route: "/r", done: 3, nextLabel: "Choose your design" } });
    expect(finish.find((todo) => todo.id === "website_build")).toMatchObject({ label: "Finish your website", sublabel: "3 of 8 done · next: Choose your design" });
    const ask = buildBusinessTodos({ ...base, website: { variant: "ask", route: "/r" } });
    expect(ask.find((todo) => todo.id === "website_build")).toMatchObject({ label: "Your website", sublabel: "Ask an admin to start it" });
    expect(buildBusinessTodos({ ...base, website: null }).some((todo) => todo.id === "website_build")).toBe(false);
  });
});

describe("#2829 W9a plan routes", () => {
  // #2829 W9r: the plan screen moved into the Website section (websiteBehaviours suite).
  it("routes each part's 'Do it myself' to its screen", () => {
    expect(planPartRoute(BRAND, "offer")).toBe(`/brand/${BRAND}/website/plan?part=offer`);
    expect(planPartRoute(BRAND, "brand")).toBe(`/brand/${BRAND}/edit`);
    expect(planPartRoute(BRAND, "approve")).toBe(`/brand/${BRAND}/website/plan?part=approve`);
    expect(planPartRoute(BRAND, "publish")).toBe(`/brand/${BRAND}/website`);
    const ticked = normalizeSitePlan(BRAND, answer({ plan: { offerings_selected: ["trips", "events"] }, live_counts: { trips: 1, events: 0, experiences: 0 } }));
    expect(firstOfferingRoute(ticked)).toBe("/event/create");
    expect(firstOfferingRoute(normalizeSitePlan(BRAND, answer({ plan: { offerings_selected: ["venue_play"] } })))).toBeNull();
  });
});

describe("#2830 Website brand-context manifest", () => {
  it("keeps minimum plan completion separate from field-level readiness", () => {
    const state = normalizeSitePlan(BRAND, answer({
      plan: { revision: 9, design_key: "voyage" },
      completeness: {
        revision: 9,
        design_key: "voyage",
        required_gap_count: 0,
        recommended_gap_count: 2,
        gap_count: 2,
        verified_count: 15,
        exception_count: 1,
        minimum_complete: true,
        context_complete: false,
        checked_at: "2026-10-30T22:00:00Z",
        fields: [
          {
            key: "contact_phone",
            label: "Contact phone",
            group: "Contact",
            requirement: "recommended",
            state: "invalid",
            value: "555-0100",
            source_type: "owner",
            owner_confirmed_at: "2026-10-30T21:00:00Z",
          },
          {
            key: "cover_media",
            label: "Cover media",
            group: "Media",
            requirement: "recommended",
            state: "missing",
            value: null,
            human_action_required: true,
          },
        ],
      },
    }));
    expect(state.plan?.designKey).toBe("voyage");
    expect(state.completeness).toMatchObject({
      minimumComplete: true,
      contextComplete: false,
      gapCount: 2,
      requiredGapCount: 0,
      recommendedGapCount: 2,
    });
    expect(state.completeness?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "contact_phone", state: "invalid", sourceType: "owner" }),
      expect.objectContaining({ key: "cover_media", state: "missing", humanActionRequired: true }),
    ]));
  });
});

describe("#2829 W9a What you'll offer", () => {
  const render = (extra: Partial<SiteOfferingsViewProps>) => {
    const p: SiteOfferingsViewProps = {
      isLoading: false, loadError: null, readOnly: false, includeStay: false, selected: new Set(), descriptor: null,
      confirm: null, isSaving: false, notice: null, onToggle: jest.fn(), onDescriptor: jest.fn(), onContinue: jest.fn(),
      onConfirm: jest.fn(), onCancelConfirm: jest.fn(), onRetry: jest.fn(), ...extra,
    };
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<SiteOfferingsView {...p} />); });
    return { tree, p };
  };

  it("previews the menu as they tick; Stay only while stay venues are on", () => {
    const { tree } = render({ selected: new Set(["trips", "events"]) });
    expect(textOf(tree)).toContain("Home · Trips · Events · About · Contact");
    expect(byTestId(tree, "offer-venue_stay")).toHaveLength(0);
    expect(byTestId(render({ includeStay: true }).tree, "offer-venue_stay")).toHaveLength(1);
  });

  it("asks 'Which describes you best?' after a venue tick", () => {
    expect(textOf(render({ selected: new Set(["venue_food_drink"]) }).tree)).toContain("Which describes you best?");
    expect(textOf(render({ selected: new Set(["trips"]) }).tree)).not.toContain("Which describes you best?");
  });

  it("unticking live items asks first, in the design contract's words", () => {
    expect(untickedWithLiveItems(["trips", "events"], ["trips"], { trips: 0, events: 2, experiences: 0 }))
      .toBe("You have 2 live events. Unticking removes the Events page from your site, and the events stay on Mingla.");
    expect(untickedWithLiveItems(["events"], ["events"], { trips: 0, events: 2, experiences: 0 })).toBeNull();
    expect(untickedWithLiveItems(["events"], [], { trips: 0, events: 0, experiences: 0 })).toBeNull();
    const { tree, p } = render({ confirm: { kind: "untick_live", message: "You have 2 live events." } });
    expect(textOf(tree)).toContain("You have 2 live events.");
    act(() => { (byTestId(tree, "offer-confirm-yes")[0]!.props.onPress as () => void)(); });
    expect(p.onConfirm).toHaveBeenCalled();
  });
});

describe("#2829 W9a story and the plan to approve", () => {
  it("words questions by what was ticked and offers matching main actions", () => {
    expect(storyQuestions(["trips"]).who).toBe("Who comes with you?");
    expect(mainActionChips(["trips"]).map((chip) => chip.label)).toContain("Reserve the next trip");
  });

  it("builds the plan only from the owner's answers, with Mingla's fixed promise", () => {
    const state = normalizeSitePlan(BRAND, answer({ plan: { offerings_selected: ["trips", "events"] }, site: { id: "s", design_key: "voyage" } }));
    const plan = approvedPlanFrom(state, { who: "First-time solo travellers", main_action: "Reserve the next trip" });
    expect(plan).toEqual({
      for: "First-time solo travellers",
      main_action: "Reserve the next trip",
      pages: "Home · Trips · Events · About · Contact",
      look: "Your chosen design, colours and fonts",
      wont_do: "Invent reviews, numbers or history",
    });
    expect(plan.leads_with).toBeUndefined();
  });

  it("approve says what is missing instead of failing silently", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SiteStoryView step="approve" isLoading={false} loadError={null} readOnly={false} questions={storyQuestions([])} chips={[]}
          story={{}} summary={{ pages: "Home · About · Contact" }} approved={false}
          approveBlocked="Your plan needs your brand's name and one line about it." isSaving={false} notice={null}
          onChange={jest.fn()} onSaveAnswers={jest.fn()} onApprove={jest.fn()} onEditBrand={jest.fn()} onRetry={jest.fn()} />,
      );
    });
    expect(textOf(tree)).toContain("one line about it");
    expect(byTestId(tree, "story-approve")[0]!.props.disabled).toBe(true);
  });
});
