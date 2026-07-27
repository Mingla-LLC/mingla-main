/**
 * #885 [scanner-invite-loader-guard] — IMPLEMENTOR happy-path regression proof.
 *
 * ─── THE HOLE THIS FILE CLOSES ────────────────────────────────────────────────
 * The scanner-invite infinite-loader FIX shipped in `app/accept-scanner-invitation.tsx`
 * (commit 26cd280bb, batched into the ORCH-1373 PR): the route now branches on the
 * five-state `authStatus`, rendering an actionable "Sign in" screen for a logged-out
 * visitor instead of the old dead `if (!isAuthReady) return;`-above-`router.replace`
 * pattern that spun a logged-out scanner forever. But nothing pinned THIS component's
 * OWN render control flow. The shared `authReadiness` unit tests and the layout
 * route-gate test (`orch_1373_auth_route_gate.test.ts`) protect the auth DERIVATION
 * and the route MOUNT — not the branch structure inside this screen. Revert this file
 * to the dead-redirect / spinner-for-signed_out shape and, before this file, NO test
 * would go red.
 *
 * ─── HOW THIS IS NOT A DECORATIVE GUARD (the ORCH-1373 P2-2 disease) ───────────
 * It does NOT hand-roll a copy of the branch chain and assert on the copy — a replica
 * stays green when the real branch is deleted. It MOUNTS THE REAL SHIPPED ROUTE
 * (`AcceptScannerInvitationRoute`) through react-test-renderer and asserts on the tree
 * the real component actually produced. Rewire the route and this test evaluates the
 * NEW wiring. Same mechanism as the sibling accept-brand route proof
 * (`issue_948_w3_bank_first_invite.tester.test.ts`).
 *
 * ─── FAILS ON REVERT (by construction) ────────────────────────────────────────
 * Revert the route to the dead-redirect shape (no `authStatus === "signed_out"` arm,
 * a spinner as the sole unresolved render): the mounted tree then has NO "Sign in"
 * affordance AND renders an ActivityIndicator -> assertions (2) and (3) BOTH flip red.
 *
 * ─── WHY IT RUNS IN CI (not dark — the ORCH-1383 dark-test-surface trap) ───────
 * It is a plain `*.implementor.test.ts` (NOT `*.render.test.tsx`), so it is NOT swept
 * into `jest.config.cjs`'s render-exclusion `testPathIgnorePatterns`. It runs under the
 * DEFAULT node/ts-jest config — the config the required full suite
 * (`mingla-business-jest-suite.yml`) runs on every PR — which installs
 * `react-test-renderer@19.1.0 --no-save`. Its dedicated per-issue workflow
 * (`.github/workflows/issue-885-scanner-invite-loader-tests.yml`) installs the same
 * renderer and runs it path-gated on the source file + this test + the workflow.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";
import type { AcceptScannerInvitationResult } from "../../services/scannerInvitationsService";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

// ActivityIndicator is imported from the SAME `react-native` specifier the route
// imports; the default jest config maps `^react-native$` to one manual mock, so both
// resolve to the identical component reference — `findAllByType(ActivityIndicator)`
// then matches the exact element the route would produce for a spinner. Length 0 =
// the route rendered NO spinner.
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
  useLocalSearchParams: () => ({ token: "scanner-route-token-885" }),
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

// The route imports ScannerInvitationServiceError (value, for its catch boundary)
// and the result TYPE (erased). Keep the error class real enough for `instanceof`
// while preventing the service's production Supabase singleton from booting inside
// Node CI. Mirrors the sibling brand-service mock in issue_948_w3_*.
jest.mock("../../services/scannerInvitationsService", () => ({
  ScannerInvitationServiceError: class ScannerInvitationServiceError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status: number) {
      super(message);
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

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAllByType: (type: unknown) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
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

/** Concatenate every rendered string leaf so we can assert on visible copy. */
function renderedText(node: TestInstance | string): string {
  if (typeof node === "string") return node;
  return (node.children ?? [])
    .map((child) => renderedText(child))
    .join(" ");
}

describe("#885 — logged-out scanner invitee gets an ACTIONABLE screen, never an infinite spinner", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockAuthStatus = "signed_out";
    mockAcceptAsync = jest.fn(async () => {
      throw new Error("acceptAsync must not run for a terminal signed_out visitor");
    });
    mockRouter.replace.mockClear();
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("authStatus=signed_out + unresolved phase renders a working 'Sign in' screen with NO spinner", async () => {
    // authStatus is terminal signed_out; the accept mutation is never attempted, so
    // `phase` stays unresolved ("loading"). This is exactly the state the dead
    // `if (!isAuthReady) return;` gate used to strand behind an infinite spinner.
    tree = await mountRoute();

    // (1) A terminal-but-actionable auth state does NOT attempt acceptance.
    expect(mockAcceptAsync).not.toHaveBeenCalled();

    // (2) An actionable "Sign in" affordance is rendered (the fix's reachable branch).
    const signInButtons = tree.root
      .findAllByType("MockButton")
      .filter((button) => (button.props as { label?: string }).label === "Sign in");
    expect(signInButtons).toHaveLength(1);

    // (2b) That affordance is wired to an onPress handler (a dead tap would be no fix).
    expect(typeof (signInButtons[0].props as { onPress?: unknown }).onPress).toBe(
      "function",
    );

    // (3) NO ActivityIndicator / spinner is rendered for this terminal state.
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    // (4) The visible copy is the actionable invite screen, not spinner copy — a
    //     second, copy-level fails-on-revert trigger independent of the tree walk.
    const text = renderedText(tree.root);
    expect(text).toContain("Sign in to accept this scanner invitation");
    expect(text).not.toContain("Checking your invitation");
    expect(text).not.toContain("Accepting your invitation");
  });
});
