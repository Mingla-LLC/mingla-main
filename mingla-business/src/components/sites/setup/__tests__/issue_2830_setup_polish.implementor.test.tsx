/**
 * #2830 setup polish — what the one setup screen shows before anyone presses
 * anything must match what Ari says from the same plan read.
 */
import React from "react";

jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../plan/BuildPart", () => ({
  BuildPart: () => {
    // The real card's "Create website draft" button.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require("react-native");
    return <View testID="build-create" onPress={() => undefined} />;
  },
}));

import { SetupDraftStep } from "../SetupDraftStep";
import { firstMissingStep, setupBuildBlockers, setupSteps } from "../../../../sites/setupStatus";
import type { BrandContextField, SitePlanState } from "../../../../sites/sitePlanState";

type TestNode = { props: Record<string, any>; children: (TestNode | string)[]; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
type TestTree = { root: TestNode; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => void;
  create: (node: React.ReactElement) => TestTree;
};
const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");
const has = (root: TestNode, testID: string) => root.findAll((n) => n.props.testID === testID).length > 0;
const mount = (node: React.ReactElement) => {
  let tree!: TestTree;
  act(() => { tree = create(node); });
  return tree;
};
const noop = () => undefined;

const field = (key: string, label: string, state: BrandContextField["state"], requirement: BrandContextField["requirement"] = "required"): BrandContextField => ({
  key, label, group: "Brand", requirement, state, value: null, sourceType: null, sourceRef: null, sourceUrl: null,
  observedAt: null, ownerConfirmedAt: null, exceptionReason: null, humanActionRequired: false,
});

/** Every part before Build ticked in the plan, but the logo and cover still missing (the live run). */
function planMissingMedia(): SitePlanState {
  const done = (key: string) => ["offer", "brand", "look", "story", "approve"].includes(key);
  const keys = ["offer", "brand", "look", "story", "approve", "build", "first_offering", "publish"] as const;
  return {
    setupStatus: {
      parts: keys.map((key) => ({
        key,
        done: done(key) && key !== "brand",
        skipped: false,
        fieldCount: key === "brand" ? 10 : 1,
        openFields: key === "brand" ? ["profile_photo", "cover_media"] : [],
      })),
      doneCount: 4,
      nextPart: "brand",
      total: 8,
    },
    brandId: "b",
    entitled: true,
    rank: 100,
    canManage: true,
    site: null,
    plan: null,
    parts: keys.map((key) => ({ key, done: done(key), skipped: false, optional: key === "first_offering" })),
    doneCount: 5,
    nextPart: "build",
    prefillOfferings: null,
    liveCounts: { trips: 0, events: 0, experiences: 0 },
    lock: { active: false, heldByMe: false, holderName: null, expiresAt: null },
    completeness: {
      revision: 1, contextRevision: "r1", designKey: "atelier",
      fields: [
        field("name", "Brand name", "verified"),
        field("profile_photo", "Brand logo", "missing"),
        field("cover_media", "Cover media", "missing"),
        field("tagline", "Tagline", "missing", "optional"),
        field("theme", "Theme", "not_applicable", "recommended"),
      ],
      requiredGapCount: 2, recommendedGapCount: 0, gapCount: 2, verifiedCount: 1, exceptionCount: 0,
      minimumComplete: false, contextComplete: false, checkedAt: null,
    },
  } as SitePlanState;
}

describe("#2830 bug 2 — Build names what is missing before the press", () => {
  it("lists exactly what Ari lists, from the same plan read", () => {
    expect(setupBuildBlockers(planMissingMedia())).toEqual([
      { key: "profile_photo", label: "Brand logo" },
      { key: "cover_media", label: "Cover media" },
    ]);
  });

  it("shows the list and 'Go to what's missing', with no build button", () => {
    const plan = planMissingMedia();
    const blockers = setupBuildBlockers(plan);
    const status = setupSteps({ setupStatus: plan.setupStatus, fields: plan.completeness!.fields, draftFailed: false, publishFailed: false });
    const nextStep = firstMissingStep(plan, blockers, status.nextKey);
    expect(nextStep).toBe("brand");
    const tree = mount(
      <SetupDraftStep brandId="b" brandName="Lantern Room" state={{ kind: "can_start" }} canManage blockers={blockers} nextStep={nextStep} onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} />,
    );
    const text = textOf(tree.root);
    expect(text).toContain("Your draft can't be built yet.");
    expect(text).toContain("Still needed: brand logo and cover media. Nothing has been created.");
    expect(has(tree.root, "setup-draft-missing")).toBe(true);
    expect(has(tree.root, "build-create")).toBe(false);
  });

  it("a buildable plan keeps the build button", () => {
    const tree = mount(
      <SetupDraftStep brandId="b" brandName="Lantern Room" state={{ kind: "can_start" }} canManage blockers={[]} onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} />,
    );
    expect(has(tree.root, "build-create")).toBe(true);
  });
});
