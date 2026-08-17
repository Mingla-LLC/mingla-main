/**
 * #2099 — CHECK H, the host-mount check (Amendment 7 §G3, rebuilt by
 * Amendment 8 §H3, sealed by Amendment 9 §J3 and Amendment 10 §K3).
 *
 * It MOUNTS THE REAL DEFAULT EXPORT of `app/venue/[venueId]/index.tsx`.
 * Rendering the launcher on its own does not satisfy §D6 and does not satisfy
 * SC-1 — a flawless launcher no operator can reach is the exact defect the
 * re-host onto this page exists to end. H-7 is the only standalone case, and it
 * exists to make a `.native`-first resolution fail legibly rather than as a
 * downstream absence.
 *
 * Runs under `jest.issue2099.web.render.cjs` (web-first resolution), on the
 * #1483 bare `react-test-renderer` recipe proven under the same ts-jest/node
 * preset by `venuePublicPageActions.issue1483.test.tsx`. The filename carries
 * `.render.test.tsx` deliberately: the stock config's generic
 * `testPathIgnorePatterns` entry `\.render\.test\.tsx$` drops it from the stock
 * run, where its extensionless launcher import could not resolve.
 *
 * ANTI-VACUITY, and it is the whole point of H-0:
 *   H-0a  the suite may not `jest.mock` any #2099 module (self-source scan);
 *   H-0b  the extensionless specifier must RESOLVE to the real `.web.tsx`;
 *   H-0c  the imported binding must not be a mock and must be `===` to
 *         `jest.requireActual(...).default`;
 *   H-0d  the file on disk at the literal repository path must carry both
 *         load-bearing literals.
 * None of the four implies another: a `setupFiles` mock leaves resolution
 * honest (H-0b green, H-0c red); a `moduleNameMapper` redirect leaves reference
 * identity honest (H-0c green, H-0b red); a repository-local transformer leaves
 * both honest (H-0d red alone).
 *
 * CEILING, stated because the contract states it: a jest suite is arbitrary
 * JavaScript sharing one process and one module registry with the unit it
 * proves, so these assertions can be defeated from inside this file. That is
 * conceded in writing (Amendment 10 §K3, Amendment 11 §L7). Check H is a
 * fails-on-revert contract against honest mistakes; the load-bearing proof of
 * the mount is the INDEPENDENT TESTER's §D6 browser runtime matrix.
 */

import fs from "fs";
import path from "path";

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// Environment mocks. Every one of these is on the permitted list (data hooks,
// router, auth, safe-area, expo-constants, the visual primitives and BOTH suite
// shells). None of them names a #2099 module — H-0a proves that mechanically.
// ---------------------------------------------------------------------------
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));

jest.mock("react-native", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    Platform: { OS: "web", select: (o: Record<string, unknown>): unknown => o.web ?? o.default },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      hairlineWidth: 1,
      flatten: (s: unknown): unknown => s,
    },
    View: "View",
    Text: "Text",
    ActivityIndicator: "ActivityIndicator",
    Pressable: ReactActual.Fragment,
  };
});

const mockParams: { venueId?: string; focus?: string } = { venueId: "venue-2099" };
jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true, user: { id: "user-2099" } }),
}));

interface MockVenue {
  id: string;
  brandId: string | null;
  slug: string;
  name: string;
  city: string | null;
  venueCategory: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  claimStatus: string;
  claimFollowUpAt: string | null;
  rejectionReason: string | null;
}

const mockState: {
  venue: MockVenue | null;
  isWideDesktop: boolean;
  openFeedbackCount: number;
} = { venue: null, isWideDesktop: false, openFeedbackCount: 0 };

jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({ data: mockState.venue, isLoading: false }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  __esModule: true,
  useBrand: () => ({ data: { id: "brand-2099", slug: "smokerhythm", displayName: "B" } }),
}));

jest.mock("../../../hooks/useBrandPlacePipelineState", () => ({
  __esModule: true,
  useVenuePipelineState: () => ({ data: null }),
}));

jest.mock("../../../hooks/useVenueClaimFeedback", () => ({
  __esModule: true,
  useVenueClaimOpenCount: () => mockState.openFeedbackCount,
}));

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({
    isWideDesktop: mockState.isWideDesktop,
    isWeb: true,
    width: mockState.isWideDesktop ? 1280 : 390,
  }),
}));

jest.mock("../../../services/guestFunnelLink", () => ({
  __esModule: true,
  openExternal: jest.fn(),
}));

// ---- visual primitives ----------------------------------------------------
// The Button stub forwards `accessibilityLabel` as well as `testID`, because
// "present-once" asserts BOTH on the same host node.
jest.mock("../../ui/Button", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    Button: (props: {
      label: string;
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
      disabled?: boolean;
      loading?: boolean;
    }): React.ReactElement =>
      ReactActual.createElement("ButtonMock", {
        label: props.label,
        onPress: props.onPress,
        testID: props.testID,
        accessibilityLabel: props.accessibilityLabel,
        disabled: props.disabled,
        loading: props.loading,
      }),
  };
});

jest.mock("../../ui/TopBar", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    TopBar: (props: { title?: string; rightSlot?: React.ReactNode; testID?: string }) =>
      ReactActual.createElement(
        "TopBarMock",
        { testID: props.testID, title: props.title },
        props.rightSlot,
      ),
  };
});

jest.mock("../../ui/IconChrome", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    IconChrome: (props: { testID?: string; accessibilityLabel?: string }) =>
      ReactActual.createElement("IconChromeMock", {
        testID: props.testID,
        accessibilityLabel: props.accessibilityLabel,
      }),
  };
});

jest.mock("../../ui/ShareModal", () => ({ __esModule: true, ShareModal: (): null => null }));
jest.mock("../../ui/Toast", () => ({ __esModule: true, Toast: (): null => null }));

// BOTH suite shells render identifiable host nodes, so H-1…H-5 can assert
// WHICH BRANCH the page took. An unbound `brandId` fixture would silently drop
// a "stay" case into the non-stay branch and prove nothing.
jest.mock("../../stay/StaySuiteShell", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    StaySuiteShell: () =>
      ReactActual.createElement("StaySuiteShellStub", { testID: "stay-suite-shell-stub" }),
  };
});
jest.mock("../VenueSuiteShell", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    VenueSuiteShell: () =>
      ReactActual.createElement("VenueSuiteShellStub", { testID: "venue-suite-shell-stub" }),
  };
});
jest.mock("../VenueModulePillRow", () => ({
  __esModule: true,
  VenueModulePillRow: (): null => null,
}));
jest.mock("../../brand/VenueClaimFeedbackSheet", () => ({
  __esModule: true,
  VenueClaimFeedbackSheet: (): null => null,
}));
jest.mock("../../brand/VenueClaimStatusBanner", () => ({
  __esModule: true,
  VenueClaimStatusBanner: (): null => null,
}));

// ---------------------------------------------------------------------------
// The unit under proof. `LAUNCHER_SPECIFIER` is the SAME extensionless
// specifier the host page uses, expressed relative to this file — H-0b and H-0c
// both hang off it, and the page and this suite must resolve to one module.
// ---------------------------------------------------------------------------
const LAUNCHER_SPECIFIER = "../PendingVenueIdentityCorrectionLauncher";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import LauncherUnderProof from "../PendingVenueIdentityCorrectionLauncher";

// The REAL route.
import VenueManagementPage from "../../../../app/venue/[venueId]/index";

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: TestNode | null;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: TestNode; unmount: () => void };
  act: (cb: () => void | Promise<void>) => void;
};

const CONTROL_TEST_ID = "venue-page-correct-identity-web";
const CONTROL_LABEL = "Correct venue identity";
const BAND_TEST_ID = "venue-page-identity-band";

// HOST nodes only. A composite that merely *forwards* `testID` to a host child
// would otherwise be counted twice, and "exactly one" is load-bearing here.
const byTestID = (root: TestNode, id: string): TestNode[] =>
  root.findAll(
    (node) => typeof node.type === "string" && node.props?.testID === id,
  );

const isDescendantOf = (node: TestNode, ancestor: TestNode): boolean => {
  let cursor: TestNode | null = node.parent;
  while (cursor !== null) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
};

const baseVenue = (over: Partial<MockVenue>): MockVenue => ({
  id: "venue-2099",
  brandId: "brand-2099",
  slug: "theclusterfuck",
  name: "The Cluster Fuck",
  city: "Raleigh",
  venueCategory: "play",
  coverMediaUrl: null,
  coverMediaType: null,
  claimStatus: "pending_review",
  claimFollowUpAt: null,
  rejectionReason: null,
  ...over,
});

const mountPage = (): { root: TestNode; unmount: () => void } => {
  let tree!: { root: TestNode; unmount: () => void };
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(VenueManagementPage));
  });
  return tree;
};

/**
 * "present-once" — the vacuity AND identity guard, asserted in every case where
 * the control must be on screen. Clause 3 is the non-forgeable one: a decoy
 * `<View testID="…">` has type `"View"`, not the launcher function, and it
 * cannot acquire reference identity without BEING the launcher. Clause 4 stops
 * a real-but-empty launcher rendered beside a forged sibling decoy.
 */
const expectPresentOnce = (root: TestNode): void => {
  expect(byTestID(root, BAND_TEST_ID)).toHaveLength(1);

  const tagged = byTestID(root, CONTROL_TEST_ID);
  expect(tagged).toHaveLength(1);
  expect(tagged[0]!.props.accessibilityLabel).toBe(CONTROL_LABEL);

  const instances = root.findAll((node) => node.type === LauncherUnderProof);
  expect(instances).toHaveLength(1);
  expect(isDescendantOf(tagged[0]!, instances[0]!)).toBe(true);
};

const expectAbsent = (root: TestNode): void => {
  expect(byTestID(root, BAND_TEST_ID)).toHaveLength(1);
  expect(byTestID(root, CONTROL_TEST_ID)).toHaveLength(0);
  expect(root.findAll((node) => node.type === LauncherUnderProof)).toHaveLength(0);
  expect(
    root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props?.accessibilityLabel === CONTROL_LABEL,
    ),
  ).toHaveLength(0);
};

const expectShell = (root: TestNode, which: "stay" | "venue"): void => {
  expect(byTestID(root, "stay-suite-shell-stub")).toHaveLength(which === "stay" ? 1 : 0);
  expect(byTestID(root, "venue-suite-shell-stub")).toHaveLength(which === "venue" ? 1 : 0);
};

beforeEach(() => {
  mockState.venue = baseVenue({});
  mockState.isWideDesktop = false;
  mockState.openFeedbackCount = 0;
});

describe("#2099 Check H — the correction control is mounted by the real venue page", () => {
  // ---- H-0a ---------------------------------------------------------------
  test("H-0a: this suite does not mock any #2099 module (self-source scan)", () => {
    const source = fs.readFileSync(__filename, "utf8");
    const calls = [
      ...source.matchAll(
        /jest\.(?:mock|doMock|setMock|unstable_mockModule)\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g,
      ),
    ].map((match) => match[2] ?? "");
    const forbidden = [
      "PendingVenueIdentityCorrectionLauncher",
      "PendingVenueIdentityCorrectionDialog",
      "pendingVenueIdentityCorrectionService",
    ];
    const offenders = calls.filter((specifier) =>
      forbidden.some((token) => specifier.includes(token)),
    );
    expect(offenders).toEqual([]);
    // Vacuity guard: the scanner must actually find this suite's real mocks.
    expect(calls.length).toBeGreaterThan(10);
  });

  // ---- H-0b ---------------------------------------------------------------
  test("H-0b: the extensionless specifier resolves to the real .web.tsx launcher", () => {
    const resolved = require.resolve(LAUNCHER_SPECIFIER);
    expect(path.basename(resolved)).toBe(
      "PendingVenueIdentityCorrectionLauncher.web.tsx",
    );
    expect(
      resolved.endsWith(
        path.join(
          "src",
          "components",
          "venue",
          "PendingVenueIdentityCorrectionLauncher.web.tsx",
        ),
      ),
    ).toBe(true);
  });

  // ---- H-0c ---------------------------------------------------------------
  test("H-0c: the imported binding is the real module, not a registry substitute", () => {
    expect(jest.isMockFunction(LauncherUnderProof)).toBe(false);
    const actual = jest.requireActual(LAUNCHER_SPECIFIER) as {
      default: unknown;
    };
    expect(LauncherUnderProof).toBe(actual.default);
  });

  // ---- H-0d ---------------------------------------------------------------
  test("H-0d: the file on disk carries both load-bearing literals", () => {
    // The LITERAL repository path, deliberately not the one H-0b resolved: a
    // criterion that reads a path another criterion computed is not meaningful
    // alone. Under a hijacked resolution it would read the substitute and pass.
    const webPath = path.join(
      __dirname,
      "..",
      "PendingVenueIdentityCorrectionLauncher.web.tsx",
    );
    const source = fs.readFileSync(webPath, "utf8");
    expect(source).toContain(CONTROL_TEST_ID);
    expect(source).toContain(CONTROL_LABEL);
  });

  // ---- H-1 … H-4 ----------------------------------------------------------
  const branchCases: ReadonlyArray<{
    id: string;
    category: string;
    wide: boolean;
    shell: "stay" | "venue";
  }> = [
    { id: "H-1", category: "play", wide: false, shell: "venue" },
    { id: "H-2", category: "stay", wide: false, shell: "stay" },
    { id: "H-3", category: "play", wide: true, shell: "venue" },
    { id: "H-4", category: "stay", wide: true, shell: "stay" },
  ];

  for (const branchCase of branchCases) {
    test(`${branchCase.id}: pending_review, ${branchCase.category}, isWideDesktop=${String(
      branchCase.wide,
    )} → present once, ${branchCase.shell} branch mounted`, () => {
      mockState.venue = baseVenue({
        venueCategory: branchCase.category,
        brandId: "brand-2099",
      });
      mockState.isWideDesktop = branchCase.wide;
      const tree = mountPage();
      expectPresentOnce(tree.root);
      expectShell(tree.root, branchCase.shell);
      tree.unmount();
    });
  }

  // ---- H-5 ----------------------------------------------------------------
  // The FULL gating cross-product of the page's own inputs. The third
  // claim-feedback state — a round with an OPEN item — is the one a narrowing
  // written into the slot's CONSEQUENT hides in, and it is a real, reachable
  // operator state.
  const feedbackStates: ReadonlyArray<{
    label: string;
    followUpAt: string | null;
    openCount: number;
  }> = [
    { label: "no round", followUpAt: null, openCount: 0 },
    { label: "round, nothing open", followUpAt: "2026-08-01T00:00:00Z", openCount: 0 },
    { label: "round, 3 OPEN", followUpAt: "2026-08-01T00:00:00Z", openCount: 3 },
  ];

  for (const category of ["play", "stay"] as const) {
    for (const wide of [false, true] as const) {
      for (const feedback of feedbackStates) {
        test(`H-5: pending_review × ${category} × isWideDesktop=${String(
          wide,
        )} × ${feedback.label} → present once`, () => {
          mockState.venue = baseVenue({
            venueCategory: category,
            brandId: "brand-2099",
            claimFollowUpAt: feedback.followUpAt,
          });
          mockState.isWideDesktop = wide;
          mockState.openFeedbackCount = feedback.openCount;
          const tree = mountPage();
          expectPresentOnce(tree.root);
          tree.unmount();
        });
      }
    }
  }

  // ---- H-6 ----------------------------------------------------------------
  for (const category of ["play", "stay"] as const) {
    for (const wide of [false, true] as const) {
      test(`H-6: verified × ${category} × isWideDesktop=${String(
        wide,
      )} → no control, no ghost, page really rendered`, () => {
        mockState.venue = baseVenue({
          venueCategory: category,
          brandId: "brand-2099",
          claimStatus: "verified",
        });
        mockState.isWideDesktop = wide;
        const tree = mountPage();
        expectAbsent(tree.root);
        tree.unmount();
      });
    }
  }

  // ---- H-7 ----------------------------------------------------------------
  test("H-7: the launcher module standalone emits exactly one tagged control", () => {
    let tree!: { root: TestNode; unmount: () => void };
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(LauncherUnderProof, {
          venueId: "venue-2099",
          claimStatus: "pending_review",
        }),
      );
    });
    const tagged = byTestID(tree.root, CONTROL_TEST_ID);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.props.accessibilityLabel).toBe(CONTROL_LABEL);
    tree.unmount();
  });
});
