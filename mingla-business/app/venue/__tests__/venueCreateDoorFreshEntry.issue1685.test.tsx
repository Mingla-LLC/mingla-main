/**
 * Issue #1685 [venue-draft-multi] — THE named regression target (SPEC §9).
 *
 * Mounts the REAL `app/venue/create.tsx` against a REAL, deliberately
 * resume-worthy `useDraftVenueStore` and proves the create door can never
 * resume again (I-PROPOSED-1685-CREATE-DOOR-NEVER-RESUMES):
 *
 *   H-0  vacuity guard — the seeded draft genuinely WOULD have resumed on the
 *        pre-fix code. Without this, every assertion below could pass against
 *        an empty store (the `feedback_unfalsifiable_test_bug_class` failure).
 *   H-1  `/venue/create` with NO draft param renders the name gate, empty.
 *   H-2  the seeded draft is PARKED, not destroyed, and a new id is active.
 *   H-3  `router.setParams({ draft: <new id> })` puts the id in the URL.
 *   H-4  `/venue/create?draft=<seeded id>` still resumes into the wizard —
 *        H-1 must not have been achieved by breaking resume.
 *   H-5  an unknown `?draft=` id falls through to the gate; no crash, no blank.
 *   H-6  the route no longer calls `activateBrand(` and no longer computes the
 *        phase in a mount-time `useState` initialiser.
 *
 * Bare react-test-renderer harness under the stock jest.config.cjs, modeled on
 * `src/components/event/__tests__/EventRouteKeystrokeSurvives.orch0976.test.tsx`.
 */
import React from "react";
import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND_ID = "brand-1685";

// ── Navigation harness. `setParams` patches params IN PLACE (no remount),
//    exactly like expo-router on a same-route param update. ─────────────────
const nav: { params: Record<string, string>; rerender: () => void } = {
  params: {},
  rerender: () => undefined,
};
const setParamsCalls: Record<string, string>[] = [];
const replaceCalls: string[] = [];

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => nav.params,
  useRouter: () => ({
    back: jest.fn(),
    push: jest.fn(),
    replace: (href: string) => {
      replaceCalls.push(href);
    },
    setParams: (p: Record<string, string>) => {
      setParamsCalls.push(p);
      nav.params = { ...nav.params, ...p };
      nav.rerender();
    },
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../src/wrappers/SmartScrollView", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    ScrollView: (props: { children?: React.ReactNode }) =>
      ReactActual.createElement("ScrollView", null, props.children),
  };
});

jest.mock("../../../src/context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1685" } }),
}));

jest.mock("../../../src/hooks/useCurrentBrand", () => ({
  __esModule: true,
  useCurrentBrand: () => ({ id: "brand-1685", displayName: "Test Brand" }),
}));

jest.mock("../../../src/hooks/useFeatureFlag", () => ({
  __esModule: true,
  useFeatureFlag: () => ({ data: false }),
}));

jest.mock("../../../src/hooks/usePoolMatchSearch", () => ({
  __esModule: true,
  usePoolMatchSearch: () => ({ matches: [], loading: false, error: null }),
}));

jest.mock("../../../src/services/poolSearchService", () => ({
  __esModule: true,
  fetchPlaceAdoptionDetail: jest.fn(),
  PlaceNotAvailableError: class PlaceNotAvailableError extends Error {},
}));

jest.mock("../../../src/components/brand/ClaimMatchCard", () => ({
  __esModule: true,
  ClaimMatchCard: (): null => null,
  sortMatchesForGate: <T,>(m: T): T => m,
}));

// Mount probes — the category picker and the wizard record that they rendered,
// so "the gate is showing" is asserted positively AND negatively.
const mounted = { categoryPicker: 0, wizard: 0 };
jest.mock("../../../src/components/brand/VenueCategoryPicker", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    VenueCategoryPicker: (): null => {
      ReactActual.useEffect(() => {
        mounted.categoryPicker += 1;
      }, []);
      return null;
    },
  };
});
jest.mock("../../../src/components/venue/VenueCreatorWizard", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    VenueCreatorWizard: (): null => {
      ReactActual.useEffect(() => {
        mounted.wizard += 1;
      }, []);
      return null;
    },
  };
});

// The name field. We record every `value` it is handed, so "empty field" is a
// claim about what the operator actually sees, not about store internals.
const inputValues: string[] = [];
jest.mock("../../../src/components/ui/Input", () => ({
  __esModule: true,
  Input: (props: { value?: string }): null => {
    inputValues.push(props.value ?? "<undefined>");
    return null;
  },
}));

jest.mock("../../../src/components/ui/Button", () => ({
  __esModule: true,
  Button: (): null => null,
}));
jest.mock("../../../src/components/ui/EventCoverMedia", () => ({
  __esModule: true,
  EventCoverMedia: (): null => null,
}));
jest.mock("../../../src/components/ui/Icon", () => ({
  __esModule: true,
  Icon: (): null => null,
}));
jest.mock("../../../src/components/ui/IconChrome", () => ({
  __esModule: true,
  IconChrome: (): null => null,
}));

import VenueCreateRoute from "../create";
import {
  draftVenueInProgress,
  useDraftVenueStore,
  type DraftVenueState,
} from "../../../src/store/draftVenueStore";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    toJSON: () => unknown;
    unmount: () => void;
  };
  act: (cb: () => void) => void;
};

const store = useDraftVenueStore;

/** Recursively collect every string leaf of a react-test-renderer JSON tree. */
const collectText = (node: unknown, out: string[]): string[] => {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    const children = (node as { children?: unknown }).children;
    if (children !== undefined) collectText(children, out);
  }
  return out;
};

/**
 * The PRE-FIX entry predicate, transcribed from `resolveInitialPhase` as it
 * stood before #1685 (create.tsx:63-85). H-0 runs the seeded draft through it
 * to prove the seed really was resume-worthy.
 */
const preFixPhase = (d: DraftVenueState): string => {
  if (d.placePoolId !== null) return "wizard";
  if (d.claim !== null) return "gate";
  if (d.workingName.trim().length >= 2 && d.venueCategory !== null) return "wizard";
  if (d.workingName.trim().length >= 2) return "category";
  return "gate";
};

/** Seed ONE genuinely resume-worthy draft and return its id. */
const seedFatDraft = (): string => {
  const id = store.getState().createDraft(BRAND_ID);
  store.getState().patch({
    workingName: "Lumen Wine Bar",
    displayName: "Lumen Wine Bar",
    venueCategory: "restaurant",
    formattedAddress: "12 Ossington Ave",
    step: 3,
  });
  return id;
};

/** Unmounting flushes React state updates, so it belongs inside act(). */
const unmountTree = (tree: { unmount: () => void }): void => {
  TestRenderer.act(() => {
    tree.unmount();
  });
};

const mountRoute = (params: Record<string, string>): { toJSON: () => unknown; unmount: () => void } => {
  nav.params = { ...params };
  let tree: { toJSON: () => unknown; unmount: () => void } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(VenueCreateRoute));
  });
  const resolved = tree as unknown as { toJSON: () => unknown; unmount: () => void };
  nav.rerender = () => {
    TestRenderer.act(() => undefined);
  };
  return resolved;
};

beforeEach(async () => {
  await store.persist.rehydrate();
  store.getState().reset();
  nav.params = {};
  nav.rerender = () => undefined;
  setParamsCalls.length = 0;
  replaceCalls.length = 0;
  inputValues.length = 0;
  mounted.categoryPicker = 0;
  mounted.wizard = 0;
});

describe("#1685 — the create door mints; it never resumes", () => {
  test("H-0 — the seeded draft is genuinely resume-worthy (vacuity guard)", () => {
    seedFatDraft();
    const seeded = store.getState();
    expect(draftVenueInProgress(seeded)).toBe(true);
    expect(seeded.workingName.trim().length).toBeGreaterThanOrEqual(2);
    expect(seeded.venueCategory).not.toBeNull();
    expect(seeded.step).toBe(3);
    // On the PRE-FIX code this draft sent the operator straight into the
    // wizard — which, at step 3, is the Address screen Seth reported.
    expect(preFixPhase(seeded)).toBe("wizard");
  });

  test("H-1/H-2/H-3 — '+' opens an EMPTY name gate, parks the old draft, and stamps the URL", () => {
    const seededId = seedFatDraft();
    const tree = mountRoute({});

    // H-1 — the gate is what rendered.
    const texts = collectText(tree.toJSON(), []);
    expect(texts).toContain("What’s your venue called?");
    expect(mounted.wizard).toBe(0);
    expect(mounted.categoryPicker).toBe(0);
    // …with an EMPTY name field. Every value the input ever saw was "".
    expect(inputValues.length).toBeGreaterThan(0);
    expect(inputValues.every((v) => v === "")).toBe(true);

    // H-2 — a NEW draft is active and the seeded one survived, intact.
    const after = store.getState();
    expect(after.activeDraftId).not.toBeNull();
    expect(after.activeDraftId).not.toBe(seededId);
    expect(after.workingName).toBe("");
    const parked = after.drafts.find((e) => e.id === seededId);
    expect(parked).toBeDefined();
    expect(parked?.brandId).toBe(BRAND_ID);
    expect(parked?.state.step).toBe(3);
    expect(parked?.state.workingName).toBe("Lumen Wine Bar");
    expect(parked?.state.formattedAddress).toBe("12 Ossington Ave");

    // H-3 — the minted id went into the address bar.
    expect(setParamsCalls).toContainEqual({ draft: after.activeDraftId });

    unmountTree(tree);
  });

  test("H-4 — `?draft=<id>` still resumes that draft into the wizard at its step", () => {
    const seededId = seedFatDraft();
    // Park it, so the resume path exercises the real by-id lookup.
    store.getState().createDraft(BRAND_ID);
    expect(store.getState().drafts.some((e) => e.id === seededId)).toBe(true);

    const tree = mountRoute({ draft: seededId });

    expect(mounted.wizard).toBe(1);
    expect(store.getState().activeDraftId).toBe(seededId);
    expect(store.getState().step).toBe(3);
    expect(store.getState().workingName).toBe("Lumen Wine Bar");

    unmountTree(tree);
  });

  test("H-5 — an unknown `?draft=` id falls through to the gate with a fresh draft", () => {
    const seededId = seedFatDraft();
    const tree = mountRoute({ draft: "dv_unknown" });

    const texts = collectText(tree.toJSON(), []);
    expect(texts).toContain("What’s your venue called?");
    expect(mounted.wizard).toBe(0);

    const after = store.getState();
    expect(after.activeDraftId).not.toBeNull();
    expect(after.activeDraftId).not.toBe(seededId);
    expect(after.activeDraftId).not.toBe("dv_unknown");
    expect(after.workingName).toBe("");
    // The seeded draft was not collateral damage.
    expect(after.drafts.some((e) => e.id === seededId)).toBe(true);
    expect(setParamsCalls).toContainEqual({ draft: after.activeDraftId });

    unmountTree(tree);
  });

  test("H-5b — a CROSS-BRAND `?draft=` id also falls through to a fresh gate", () => {
    const otherBrandDraft = store.getState().createDraft("brand-other");
    store.getState().patch({ workingName: "Someone Else's Venue", step: 4 });
    store.getState().createDraft(BRAND_ID);

    const tree = mountRoute({ draft: otherBrandDraft });

    expect(mounted.wizard).toBe(0);
    expect(collectText(tree.toJSON(), [])).toContain("What’s your venue called?");
    expect(store.getState().activeBrandId).toBe(BRAND_ID);
    expect(store.getState().activeDraftId).not.toBe(otherBrandDraft);
    // Brand "other"'s work is untouched.
    const foreign = store.getState().drafts.find((e) => e.id === otherBrandDraft);
    expect(foreign?.state.workingName).toBe("Someone Else's Venue");
    expect(foreign?.brandId).toBe("brand-other");

    unmountTree(tree);
  });

  test("H-6 — the route no longer reaches for activateBrand or a mount-time phase", () => {
    const source = readFileSync(join(__dirname, "..", "create.tsx"), "utf8");
    expect(source).not.toContain("activateBrand(");
    expect(source).not.toContain("useState<Phase>(() => resolveInitialPhase");
    // The two doors, spelled out.
    expect(source).toContain("createDraft(currentBrand.id)");
    expect(source).toContain("activateDraft(requestedDraftId, currentBrand.id)");
    expect(source).toContain('setPhase("gate")');
    expect(source).toContain("router.setParams({ draft:");
    // Load-bearing survivors (SPEC §4.2 "preserve verbatim").
    expect(source).toContain('params.pool === "1"');
    expect(source).toContain("placePoolId");
    expect(source).toContain("PoolMatchCard");
    expect(source).toContain("claim-resume-card");
    expect(source).toContain("setSuccessWasClaim(wasClaim)");
    expect(source).toContain("Your listing is not live yet.");
  });
});
