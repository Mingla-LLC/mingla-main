/*
 * #4453 PR 3 (P2-2, P1-3, P3-1) — the setup step "What guests say and where
 * you've been" and its sheets, rendered with react-test-renderer:
 *   - each form opens in a sheet (the shared full-height Sheet) with its fields
 *     and room below them; it closes by the close button and by the Sheet's own
 *     backdrop/swipe path (`onClose`), and nothing half-typed is saved;
 *   - a review can't be saved without the "real review" tick, and the tick
 *     starts unticked when an existing review is edited;
 *   - Website → Past trips offers "Add a trip you ran before Mingla" only while
 *     SITES_PROOF_PART is on.
 *
 * The shared Sheet is replaced by a stand-in that renders a backdrop calling
 * the same `onClose` the real Sheet calls for a backdrop tap or a swipe down
 * (the real one pulls in expo-blur, which jest does not transform).
 */
import React from "react";

const mockSave = jest.fn();
const mockSavePlan = jest.fn();
const mockAddTrip = jest.fn();
let mockContent: Record<string, unknown>;

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../../ui/Sheet", () => {
  const { Pressable, View } = jest.requireActual("react-native");
  const ReactActual = jest.requireActual("react");
  return {
    Sheet: ({ visible, onClose, snapPoint, children, testID }: { visible: boolean; onClose: () => void; snapPoint?: string; children: React.ReactNode; testID?: string }) =>
      visible ? ReactActual.createElement(View, { testID: `${testID}-sheet`, snap: snapPoint },
        ReactActual.createElement(Pressable, { testID: `${testID}-backdrop`, onPress: onClose }), children) : null,
  };
});
jest.mock("../../../../sites/planApi", () => ({
  useBrandSitePlan: () => ({
    data: {
      canManage: true, proofEnabled: true, prefillOfferings: [],
      proofCounts: { reviews: 0, pastTrips: 0, destinations: 0, stories: 0 },
      plan: { revision: 4, offeringsSelected: ["trips"], skippedParts: [], valuePoints: [], faq: [], processSteps: [], quickFacts: null },
    },
    isLoading: false, isSuccess: true, isError: false, refetch: jest.fn(),
  }),
  useSaveBrandSitePlan: () => ({ mutate: mockSavePlan, isPending: false }),
  useSetupContent: () => ({ data: mockContent, isLoading: false, isError: false, refetch: jest.fn() }),
  useSaveSetupContent: () => ({ mutate: mockSave, isPending: false }),
  useAddPastTrip: () => ({ mutate: mockAddTrip, isPending: false }),
}));

jest.mock("../../../../sites/contentApi", () => ({
  BrandSiteContentConflict: class BrandSiteContentConflict extends Error {},
  usePastTrips: () => ({ data: { can_hide: true, revision: "r1", trips: [] }, isLoading: false, isError: false, refetch: jest.fn() }),
  useSetPastTripHidden: () => ({ mutate: jest.fn(), isPending: false }),
}));

import { ProofPart } from "../ProofPart";
import { PastTripsSection } from "../../website/sections/PastTripsSection";
import { WebsiteProvider, type WebsiteContextValue } from "../../website/WebsiteContext";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };

const one = (root: Root, id: string) => {
  const found = root.findAll((node) => node.props.testID === id && (typeof node.props.onPress === "function" || typeof node.props.onChangeText === "function" || typeof node.props.onChange === "function"));
  if (!found.length) throw new Error(`no ${id}`);
  return found[0]!;
};
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;
const press = (root: Root, id: string) => act(() => { (one(root, id).props.onPress as () => void)(); });
const type = (root: Root, id: string, value: string) => act(() => { (one(root, id).props.onChangeText as (v: string) => void)(value); });
const textOf = (root: Root) => root.findAll((node) => typeof node.type === "string" && node.children.some((c) => typeof c === "string"))
  .map((node) => node.children.filter((c) => typeof c === "string").join("")).join(" | ");

function render(): Root {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<ProofPart brandId="b1" onDone={jest.fn()} />); });
  return tree.root;
}

const REVIEW = { id: "00000000-0000-4000-8000-000000000001", kind: "review", payload: { reviewer: "Tolu A.", quote: "Best week.", review_date: "2026-03", source: "Google" }, confirmedReal: true, materialized: false, updatedAt: "2026-11-16T00:00:00Z" };

beforeEach(() => {
  mockSave.mockClear();
  mockSavePlan.mockClear();
  mockAddTrip.mockClear();
  mockContent = { hasSite: false, canConfirmReviews: true, items: [], pastTrips: [] };
});

describe("#4453 the setup step's sheets", () => {
  it("the step renders every part; no sheet is open at first", () => {
    const root = render();
    for (const id of ["proof-review", "proof-past-trips", "proof-destination", "proof-story", "proof-points", "proof-faq", "proof-facts", "proof-ticker"]) expect(has(root, id)).toBe(true);
    expect(has(root, "proof-review-sheet-sheet")).toBe(false);
  });

  it("Add a review opens a full-height sheet with every field and room below; the tick is required", () => {
    const root = render();
    press(root, "proof-review-add");
    const sheet = root.findAll((node) => node.props.testID === "proof-review-sheet-sheet")[0]!;
    expect(sheet.props.snap).toBe("full");
    for (const field of ["reviewer", "quote", "trip_name", "review_date", "source"]) expect(has(root, `proof-review-${field}`)).toBe(true);
    const scroll = root.findAll((node) => (node.props.contentContainerStyle as { paddingBottom?: number } | undefined)?.paddingBottom !== undefined)[0]!;
    expect((scroll.props.contentContainerStyle as { paddingBottom: number }).paddingBottom).toBeGreaterThanOrEqual(32);
    type(root, "proof-review-reviewer", "Tolu A.");
    type(root, "proof-review-quote", "Best week of my year.");
    type(root, "proof-review-review_date", "2026-03");
    type(root, "proof-review-source", "Google, March 2026");
    press(root, "proof-review-save");
    expect(mockSave).not.toHaveBeenCalled();
    expect(textOf(root)).toContain("Tick this to save the review");
    act(() => { (one(root, "proof-review-confirm").props.onChange as (v: boolean) => void)(true); });
    press(root, "proof-review-save");
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "review", confirmedReal: true, payload: { reviewer: "Tolu A.", quote: "Best week of my year.", review_date: "2026-03", source: "Google, March 2026" } }), expect.anything());
  });

  it("the close button and the backdrop both close the sheet, and nothing half-typed is saved", () => {
    const root = render();
    press(root, "proof-destination-add");
    type(root, "proof-destination-name", "Lisb");
    press(root, "proof-destination-sheet-close");
    expect(has(root, "proof-destination-sheet-sheet")).toBe(false);
    press(root, "proof-story-add");
    press(root, "proof-story-sheet-backdrop");
    expect(has(root, "proof-story-sheet-sheet")).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("P3-1 editing an existing review starts with the tick off", () => {
    mockContent = { ...mockContent, items: [REVIEW] };
    const root = render();
    act(() => { (root.findAll((node) => node.props.label === "Edit Tolu A." && typeof node.props.onPress === "function")[0]!.props.onPress as () => void)(); });
    expect(one(root, "proof-review-confirm").props.value).toBe(false);
  });

  it("the past-trip sheet opens with its fields and closes by its button", () => {
    const root = render();
    press(root, "proof-past-trip-add");
    for (const field of ["title", "where", "start_date", "end_date", "description", "timezone"]) expect(has(root, `proof-past-trip-${field}`)).toBe(true);
    press(root, "proof-past-trip-sheet-close");
    expect(has(root, "proof-past-trip-sheet-sheet")).toBe(false);
    expect(mockAddTrip).not.toHaveBeenCalled();
  });

  it("a row editor (Q5) adds a row from its sheet only on Done", () => {
    const root = render();
    press(root, "proof-points-add");
    type(root, "proof-points-title", "Small groups");
    press(root, "proof-points-cancel");
    expect(has(root, "proof-points-row")).toBe(false);
    press(root, "proof-points-add");
    type(root, "proof-points-title", "Small groups");
    type(root, "proof-points-sentence", "Never more than twelve.");
    press(root, "proof-points-done");
    expect(has(root, "proof-points-row")).toBe(true);
  });
});

describe("#4453 P1-3 Website → Past trips", () => {
  const ctx = (proofEnabled: boolean) => ({
    brandId: "b1", brandName: "Proof", phone: false, section: "past", go: jest.fn(), back: jest.fn(), toast: jest.fn(),
    askAdmin: jest.fn(), asking: false, headingRef: React.createRef(), offerings: ["trips"],
    controller: { siteId: "s1" }, lock: { heldByOther: false }, plan: { proofEnabled },
  }) as unknown as WebsiteContextValue;
  const renderPast = (proofEnabled: boolean): Root => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<WebsiteProvider value={ctx(proofEnabled)}><PastTripsSection /></WebsiteProvider>); });
    return tree.root;
  };

  it("with SITES_PROOF_PART off there is no \"Add a trip you ran before Mingla\"", () => {
    expect(has(renderPast(false), "past-add-before-mingla-open")).toBe(false);
  });

  it("with it on, the button opens the past-trip sheet, which closes by its button", () => {
    const root = renderPast(true);
    press(root, "past-add-before-mingla-open");
    expect(has(root, "past-add-before-mingla-sheet-sheet")).toBe(true);
    expect(has(root, "proof-past-trip-title")).toBe(true);
    press(root, "past-add-before-mingla-sheet-close");
    expect(has(root, "past-add-before-mingla-sheet-sheet")).toBe(false);
  });
});
