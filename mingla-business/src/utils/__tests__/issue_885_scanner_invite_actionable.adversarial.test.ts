/**
 * #885 [scanner-invite-loader-guard] — TESTER adversarial regression proof.
 *
 * ─── A DIFFERENT ANGLE from the implementor's happy-path guard ────────────────
 * The implementor's proof
 * (issue_885_scanner_invite_signed_out_actionable.implementor.test.ts) locks exactly
 * ONE branch: authStatus="signed_out" + unresolved phase -> a "Sign in" screen. This
 * file DELIBERATELY does NOT re-test that branch. It attacks two OTHER invariants of
 * the same fix in app/accept-scanner-invitation.tsx:
 *
 *   ANGLE 1 — the OTHER terminal auth state, `error`. `authStatus === "error"` with an
 *   unresolved `phase` must render the ACTIONABLE "Try again" retry screen (a real
 *   onPress handler), render NO ActivityIndicator, must NOT render the sign-in screen,
 *   and must NOT attempt the accept mutation. This exercises a DIFFERENT render arm
 *   (`if (authStatus === "error")`, route lines ~213-231) plus the useEffect
 *   `signed_out || error` early-return (route line ~95) than the implementor's
 *   signed_out arm. Delete that arm and `error` + unresolved falls through to the
 *   infinite spinner the fix removed -> the assertions below flip red.
 *
 *   ANGLE 2 — PRECEDENCE (C-1373-C). Once `phase` RESOLVES (a signed_in_ready accept
 *   that throws -> phase = the error screen), a SUBSEQUENT auth-state change to a
 *   transient state (bootstrapping) must NOT re-mask the resolved screen with a
 *   spinner. This pins the render ORDER: the resolved-`phase` arms are evaluated BEFORE
 *   the auth axis. Reorder them (auth transient checked first) and the resolved error
 *   screen is re-masked by a spinner -> the post-flip assertions flip red.
 *
 * ─── NOT DECORATIVE (the ORCH-1373 P2-2 disease) ──────────────────────────────
 * It does NOT hand-roll a copy of the branch chain. It MOUNTS THE REAL SHIPPED ROUTE
 * (`AcceptScannerInvitationRoute`) through react-test-renderer and asserts on the tree
 * the real component produced. Rewire the route and this test evaluates the NEW wiring.
 * Mirrors the mock boundary of the sibling implementor proof exactly.
 *
 * ─── RUNS IN CI (not dark — the ORCH-1383 dark-test-surface trap) ─────────────
 * Plain `*.adversarial.test.ts` (NOT `*.render.test.tsx`), so it is NOT swept into
 * jest.config.cjs's render-exclusion `testPathIgnorePatterns`; it runs under the DEFAULT
 * node/ts-jest config. Registered path-gated in
 * ci-batch:issue-885-scanner-invite-loader-tests alongside the implementor
 * proof (react-test-renderer installed --no-save there, same as the implementor step).
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

// Same `react-native` specifier the route imports; the default jest config maps
// `^react-native$` to one manual mock, so both resolve to the identical component
// reference — findAllByType(ActivityIndicator) then matches the exact element the route
// would produce for a spinner. Length 0 = the route rendered NO spinner.
import { ActivityIndicator } from "react-native";

let mockAuthStatus:
  | "bootstrapping"
  | "refreshing"
  | "signed_out"
  | "signed_in_ready"
  | "error";
let mockAcceptAsync: jest.Mock;

const mockRouter = {
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "scanner-route-token-885-adv" }),
  useRouter: () => mockRouter,
}));

// authStatus is the ONLY auth input this route reads (ORCH-1374 — never the
// isAuthReady boolean). `user` is provided for shape-completeness only.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    authStatus: mockAuthStatus,
    user: mockAuthStatus === "signed_in_ready"
      ? { email: "scanner@example.com" }
      : null,
  }),
}));

jest.mock("../../hooks/useScannerInvitations", () => ({
  useAcceptScannerInvitation: () => ({
    mutateAsync: mockAcceptAsync,
    isPending: false,
  }),
}));

// Keep the error class real enough for the route's `instanceof` catch boundary while
// preventing the service's production Supabase singleton from booting inside Node CI.
// Identical to the implementor proof's boundary mock.
jest.mock("../../services/scannerInvitationsService", () => ({
  // Mirror the REAL class signature exactly — (code, status, message?) — so the route's
  // `err.code` / `err.status` reads (and errorCopyFor) behave as in production.
  ScannerInvitationServiceError: class ScannerInvitationServiceError extends Error {
    code: string;
    status: number;

    constructor(code: string, status: number, message?: string) {
      super(message ?? code);
      this.name = "ScannerInvitationServiceError";
      this.code = code;
      this.status = status;
    }
  },
}));

jest.mock("../../components/ui/Button", () => {
  const ReactRuntime = require("react");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactRuntime.createElement("MockButton", { label, onPress }, label),
  };
});

import AcceptScannerInvitationRoute from "../../../app/accept-scanner-invitation";
// The mocked module's REAL export — same class reference the route's catch uses, so
// `err instanceof ScannerInvitationServiceError` inside the route matches.
import { ScannerInvitationServiceError } from "../../services/scannerInvitationsService";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAllByType: (type: unknown) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => TestTree;
};

async function flush(): Promise<void> {
  await TestRenderer.act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

async function mountRoute(): Promise<TestTree> {
  let tree: TestTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(AcceptScannerInvitationRoute));
  });
  await flush();
  if (tree === null) throw new Error("Scanner accept route did not mount.");
  return tree;
}

/** Re-render the SAME mounted tree so a mid-flight auth-state change is applied. */
async function rerender(tree: TestTree): Promise<void> {
  await TestRenderer.act(async () => {
    tree.update(React.createElement(AcceptScannerInvitationRoute));
  });
  await flush();
}

/** Concatenate every rendered string leaf so we can assert on visible copy. */
function renderedText(node: TestInstance | string): string {
  if (typeof node === "string") return node;
  return (node.children ?? [])
    .map((child) => renderedText(child))
    .join(" ");
}

function buttonsLabeled(tree: TestTree, label: string): TestInstance[] {
  return tree.root
    .findAllByType("MockButton")
    .filter((button) => (button.props as { label?: string }).label === label);
}

describe("#885 adversarial — authStatus=error is ACTIONABLE ('Try again'), never an infinite spinner", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockAuthStatus = "error";
    mockAcceptAsync = jest.fn(async () => {
      throw new Error("acceptAsync must not run for a terminal auth-error visitor");
    });
    mockRouter.replace.mockClear();
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("authStatus=error + unresolved phase renders a working 'Try again' screen, NO spinner, NOT the sign-in screen, and never attempts acceptance", async () => {
    // authStatus is the terminal `error` state; the accept mutation is gated off, so
    // `phase` stays unresolved ("loading"). Under the old dead gate this state — like
    // signed_out — would have been stranded behind an infinite spinner.
    tree = await mountRoute();

    // (1) A terminal-but-actionable auth state does NOT attempt acceptance.
    expect(mockAcceptAsync).not.toHaveBeenCalled();

    // (2) Exactly one actionable "Try again" affordance, wired to a real handler.
    const retryButtons = buttonsLabeled(tree, "Try again");
    expect(retryButtons).toHaveLength(1);
    expect(typeof (retryButtons[0].props as { onPress?: unknown }).onPress).toBe(
      "function",
    );

    // (3) NO ActivityIndicator / spinner is rendered for this terminal state.
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    // (4) It is the ERROR retry screen — NOT the signed_out "Sign in" screen (a
    //     different terminal arm; guards against the two arms being conflated).
    expect(buttonsLabeled(tree, "Sign in")).toHaveLength(0);

    // (5) Visible copy is the auth-error retry screen, not spinner or sign-in copy.
    const text = renderedText(tree.root);
    expect(text).toContain("Something went wrong");
    expect(text).toContain("We couldn't check your sign-in");
    expect(text).not.toContain("Checking your invitation");
    expect(text).not.toContain("Accepting your invitation");
    expect(text).not.toContain("Sign in to accept this scanner invitation");
  });
});

describe("#885 adversarial — a RESOLVED phase outranks a later auth change (C-1373-C precedence)", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockAuthStatus = "signed_in_ready";
    // The accept mutation REJECTS with a mapped service error -> phase resolves to the
    // error screen (errorCopyFor("invite_expired") -> "Invitation expired").
    mockAcceptAsync = jest.fn(async () => {
      throw new ScannerInvitationServiceError("invite_expired", 410, "expired");
    });
    mockRouter.replace.mockClear();
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("once the accept mutation resolves to an error screen, flipping auth to a transient state does NOT re-mask it with a spinner", async () => {
    // signed_in_ready -> accept runs exactly once and REJECTS -> phase RESOLVES to the
    // mapped error screen.
    tree = await mountRoute();

    expect(mockAcceptAsync).toHaveBeenCalledTimes(1);
    let text = renderedText(tree.root);
    expect(text).toContain("Invitation expired");
    expect(buttonsLabeled(tree, "Back to Mingla")).toHaveLength(1);
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    // The auth axis now flips to a TRANSIENT state that, on its own, renders a spinner.
    mockAuthStatus = "bootstrapping";
    await rerender(tree);

    // PRECEDENCE: the resolved error `phase` still wins — the render is a pure function
    // of the resolved phase and must NOT be re-masked by the auth axis.
    text = renderedText(tree.root);
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(text).toContain("Invitation expired");
    expect(buttonsLabeled(tree, "Back to Mingla")).toHaveLength(1);
    expect(buttonsLabeled(tree, "Sign in")).toHaveLength(0);

    // The transient auth flip triggered NO second accept attempt.
    expect(mockAcceptAsync).toHaveBeenCalledTimes(1);
  });
});
