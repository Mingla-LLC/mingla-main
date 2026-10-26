/**
 * #3660 [Host account deletion completes or changes nothing] — INDEPENDENT
 * TESTER (tester2) render-proof. Written by the tester, not the implementor.
 *
 * The implementor's route test reads `delete.tsx` as TEXT. This suite MOUNTS
 * the real route component and drives its real state machine: the real step
 * state, the real `Step2Preview` / `BlockedPanel` / `Step3Confirm` trees, the
 * real error handling in `handleConfirmDelete`, the real copy module.
 *
 * What is replaced, and why:
 *   - the two server hooks (`useAccountDeletionBlockers`,
 *     `useRequestAccountDeletion`) — so each server answer can be staged;
 *   - auth, router, safe-area and the on-device stores — no session here;
 *   - `Button`, `Icon`, `IconChrome`, `Toast` — thin stand-ins that record the
 *     props the route passes (label, disabled, onPress, accessibilityLabel).
 *     The real primitives pull in reanimated / svg / blur, which this
 *     react-native-web + node environment does not provide.
 *
 * So this proves what the route RENDERS and DOES for each server answer. It
 * does not prove pixels, the real Button's look, or a tap on a device: that
 * proof is still owed on iOS, Android and web.
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3660.tester2.web.render.cjs --runInBand --ci
 */

import React from "react";
// [TEST-MOD-APPROVED #3660] Types only, added by the implementor for the CI typecheck delta: no assertion, selector or fixture changed.
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import TestRenderer, { act } from "react-test-renderer";

import {
  ACCOUNT_DELETION_BLOCKED_TITLE,
  ACCOUNT_DELETION_FAILED_MESSAGE,
  ACCOUNT_DELETION_PARTNER_LINKS_LINE,
  ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
  AccountDeletionBlockedError,
  AccountDeletionFailedError,
} from "../../../src/utils/accountDeletionErrors";

// ---- staged server answers -------------------------------------------------
const mockState: {
  blockers: { isLoading: boolean; isError: boolean; data: unknown };
  blockersEnabledArgs: boolean[];
  requestDeletion: jest.Mock;
  partnerLinks: unknown[];
  router: { replace: jest.Mock; back: jest.Mock; canGoBack: jest.Mock };
  signOut: jest.Mock;
} = {
  blockers: { isLoading: false, isError: false, data: [] },
  blockersEnabledArgs: [],
  requestDeletion: jest.fn(),
  partnerLinks: [],
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  signOut: jest.fn(),
};

jest.mock("expo-router", () => ({
  useRouter: () => mockState.router,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../src/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "00000000-0000-4000-8000-000000003663",
      email: "t2-host@example.test",
      app_metadata: { provider: "google" },
    },
    signOut: mockState.signOut,
    isAuthReady: true,
  }),
}));
jest.mock("../../../src/hooks/useAccountDeletion", () => ({
  useAccountDeletionBlockers: (enabled: boolean) => {
    mockState.blockersEnabledArgs.push(enabled);
    return enabled
      ? mockState.blockers
      : { isLoading: false, isError: false, data: undefined };
  },
  useRequestAccountDeletion: () => ({
    mutateAsync: mockState.requestDeletion,
    isPending: false,
  }),
}));
jest.mock("../../../src/hooks/usePartnerBrandLinks", () => ({
  usePartnerBrandLinks: () => ({ data: mockState.partnerLinks }),
}));
jest.mock("../../../src/store/brandTeamStore", () => ({
  useBrandTeamStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
}));
jest.mock("../../../src/store/currentBrandStore", () => ({
  useBrandList: () => [],
}));
jest.mock("../../../src/store/guestStore", () => ({
  useGuestStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
}));
jest.mock("../../../src/store/liveEventStore", () => ({
  useLiveEventStore: (sel: (s: { events: unknown[] }) => unknown) => sel({ events: [] }),
}));
jest.mock("../../../src/store/orderStore", () => ({
  useOrderStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
}));
jest.mock("../../../src/store/scanStore", () => ({
  useScanStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
}));
jest.mock("../../../src/utils/accountDeletionPreview", () => {
  const EMPTY_PREVIEW = {
    brandsOwnedCount: 0,
    brandsTeamMemberCount: 0,
    liveEventsCount: 0,
    pastEventsCount: 0,
    soldOrdersCount: 0,
    totalRevenueGbp: 0,
    doorSalesCount: 0,
    compsCount: 0,
    teamInvitationsCount: 0,
    hasActiveOrUpcomingEvents: false,
  };
  return {
    EMPTY_PREVIEW,
    computeAccountDeletionPreview: () => EMPTY_PREVIEW,
  };
});
jest.mock("../../../src/utils/currency", () => ({
  formatCurrency: (n: number) => String(n),
}));
jest.mock("../../../src/wrappers/SmartScrollView", () => {
  const ReactLocal = require("react");
  return {
    ScrollView: (props: { children?: unknown }) =>
      ReactLocal.createElement("mock-scroll", null, props.children),
  };
});
jest.mock("../../../src/components/ui/Button", () => {
  const ReactLocal = require("react");
  return {
    Button: (props: Record<string, unknown>) =>
      ReactLocal.createElement("mock-button", props),
  };
});
jest.mock("../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../src/components/ui/IconChrome", () => {
  const ReactLocal = require("react");
  return {
    IconChrome: (props: Record<string, unknown>) =>
      ReactLocal.createElement("mock-icon-chrome", props),
  };
});
jest.mock("../../../src/components/ui/Toast", () => {
  const ReactLocal = require("react");
  return {
    Toast: (props: Record<string, unknown>) =>
      ReactLocal.createElement("mock-toast", props),
  };
});

// eslint-disable-next-line import/first
import DeleteAccountRoute from "../delete";

// Local shapes for the two renderer types this file uses (the package has no
// declarations to import them from).
type TestInstance = {
  type: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>;
  find: (predicate: (node: TestInstance) => boolean) => TestInstance;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
};
type Tree = { root: TestInstance; toJSON: () => unknown };

const buttons = (tree: Tree): TestInstance[] =>
  tree.root.findAll((n: TestInstance) => (n.type as unknown) === "mock-button");
const labels = (tree: Tree): string[] =>
  buttons(tree).map((b) => String(b.props.label));
const button = (tree: Tree, label: string): TestInstance => {
  const found = buttons(tree).filter((b) => b.props.label === label);
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one "${label}" button, found ${found.length}; on screen: ${labels(tree).join(" | ")}`,
    );
  }
  return found[0];
};
const press = async (tree: Tree, label: string): Promise<void> => {
  await act(async () => {
    (button(tree, label).props.onPress as () => void)();
    await Promise.resolve();
  });
};
const text = (tree: Tree): string => JSON.stringify(tree.toJSON());
const toast = (tree: Tree): { visible: boolean; message: string } => {
  const t = tree.root.find((n: TestInstance) => (n.type as unknown) === "mock-toast");
  return { visible: Boolean(t.props.visible), message: String(t.props.message) };
};
const mount = async (): Promise<Tree> => {
  let tree: Tree | null = null;
  await act(async () => {
    tree = TestRenderer.create(<DeleteAccountRoute />);
  });
  if (tree === null) throw new Error("route did not mount");
  return tree;
};
const typeEmail = async (tree: Tree, value: string): Promise<void> => {
  const input = tree.root.find(
    (n: TestInstance) => typeof n.props.onChangeText === "function" && n.props.placeholder !== undefined,
  );
  await act(async () => {
    (input.props.onChangeText as (v: string) => void)(value);
  });
};

const FORBIDDEN_COPY = [/30 days/i, /day 31/i, /scheduled for deletion/i, /recover/i];
const expectNoRecoveryPromise = (tree: Tree): void => {
  for (const phrase of FORBIDDEN_COPY) expect(text(tree)).not.toMatch(phrase);
};

// react-native-web's TextInput reads `document.activeElement` in an effect.
// This suite runs in the node environment (no jsdom in this package), so give
// it the one property it reads.
beforeAll(() => {
  const g = globalThis as unknown as { document?: { activeElement: unknown } };
  if (g.document === undefined) g.document = { activeElement: null };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockState.blockers = { isLoading: false, isError: false, data: [] };
  mockState.blockersEnabledArgs = [];
  mockState.requestDeletion = jest.fn();
  mockState.partnerLinks = [];
  mockState.router = {
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  mockState.signOut = jest.fn();
});

describe("#3660 tester2 · the Host delete route, mounted", () => {
  it("step 1 does not ask the server yet, and promises no recovery", async () => {
    const tree = await mount();
    expect(labels(tree)).toEqual(["Cancel", "Continue"]);
    expect(mockState.blockersEnabledArgs.every((enabled) => enabled === false)).toBe(true);
    expect(text(tree)).toContain("This can't be undone in the app.");
    expectNoRecoveryPromise(tree);
  });

  it("step 2, server still answering: Continue is disabled and says Checking…", async () => {
    mockState.blockers = { isLoading: true, isError: false, data: undefined };
    const tree = await mount();
    await press(tree, "Continue");
    expect(mockState.blockersEnabledArgs).toContain(true);
    const checking = button(tree, "Checking…");
    expect(checking.props.disabled).toBe(true);
    expect(checking.props.accessibilityLabel).toBe("Checking");
    expect(labels(tree)).toEqual(["Back", "Checking…"]);
    // Pressing it anyway must not reach step 3 on a real Button: it is disabled.
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expectNoRecoveryPromise(tree);
  });

  it("step 2, nothing blocks: Continue is enabled and leads to the confirm step", async () => {
    const tree = await mount();
    await press(tree, "Continue");
    const cont = button(tree, "Continue");
    expect(cont.props.disabled).toBe(false);
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_PARTNER_LINKS_LINE);
    await press(tree, "Continue");
    expect(labels(tree)).toEqual(["Back", "Delete my account"]);
    expectNoRecoveryPromise(tree);
  });

  it("step 2, server check failed: says so, and Continue stays enabled", async () => {
    mockState.blockers = { isLoading: false, isError: true, data: undefined };
    const tree = await mount();
    await press(tree, "Continue");
    expect(text(tree)).toContain("We couldn't check your events right now.");
    expect(button(tree, "Continue").props.disabled).toBe(false);
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
  });

  it("step 2, blockers present: the panel REPLACES Continue; there is no way on to the confirm step", async () => {
    mockState.blockers = {
      isLoading: false,
      isError: false,
      data: [
        {
          code: "tickets_sold",
          count: 1,
          items: [{ id: "e1", title: "T2 Multi Date" }],
        },
        { code: "partner_payment_in_progress", count: 1 },
        { code: "a_code_this_app_version_has_never_heard_of", count: 3 },
      ],
    };
    const tree = await mount();
    await press(tree, "Continue");

    expect(labels(tree)).toEqual(["Back", "Go to Home", "Close"]);
    expect(labels(tree)).not.toContain("Continue");
    expect(labels(tree)).not.toContain("Delete my account");
    const body = text(tree);
    expect(body).toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expect(body).toContain("1 live or upcoming event has tickets or RSVPs: T2 Multi Date.");
    expect(body).toContain("A partner payment to you is still in progress.");
    // An unknown code renders the generic line. It does not crash the screen.
    expect(body).toContain(ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE);
    expect(toast(tree).visible).toBe(false);

    // Neither panel button is disabled, and each is labelled for a screen reader.
    for (const label of ["Go to Home", "Close"]) {
      const b = button(tree, label);
      expect(b.props.disabled === undefined || b.props.disabled === false).toBe(true);
      expect(b.props.accessibilityLabel).toBe(label);
      expect(typeof b.props.onPress).toBe("function");
    }
    // The panel is announced.
    expect(
      tree.root.findAll((n: TestInstance) => n.props.accessibilityRole === "alert" || n.props.role === "alert")
        .length,
    ).toBeGreaterThan(0);

    // Both buttons do something.
    await press(tree, "Go to Home");
    expect(mockState.router.replace).toHaveBeenCalledWith("/(tabs)/home");
    await press(tree, "Close");
    expect(mockState.router.back).toHaveBeenCalledTimes(1);
    // Back goes to step 1, never forward.
    await press(tree, "Back");
    expect(labels(tree)).toEqual(["Cancel", "Continue"]);
    expect(mockState.requestDeletion).not.toHaveBeenCalled();
  });

  it("step 2 announces partner connections only when the Host has an accepted, live one", async () => {
    mockState.partnerLinks = [
      { id: "l1", accepted_at: null, cancelled_at: null },
      { id: "l2", accepted_at: "2026-01-01T00:00:00Z", cancelled_at: "2026-02-01T00:00:00Z" },
    ];
    let tree = await mount();
    await press(tree, "Continue");
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_PARTNER_LINKS_LINE);

    mockState.partnerLinks = [
      { id: "l3", accepted_at: "2026-01-01T00:00:00Z", cancelled_at: null },
    ];
    tree = await mount();
    await press(tree, "Continue");
    expect(text(tree)).toContain(ACCOUNT_DELETION_PARTNER_LINKS_LINE);
  });

  it("confirm → server refuses (409): the blocked panel, no toast, and Delete is gone", async () => {
    mockState.requestDeletion = jest.fn().mockRejectedValue(
      new AccountDeletionBlockedError([{ code: "money_in_motion", count: 1 }]),
    );
    const tree = await mount();
    await press(tree, "Continue");
    await press(tree, "Continue");
    expect(button(tree, "Delete my account").props.disabled).toBe(true);
    await typeEmail(tree, "T2-Host@example.test");
    expect(button(tree, "Delete my account").props.disabled).toBe(false);
    await press(tree, "Delete my account");

    expect(mockState.requestDeletion).toHaveBeenCalledTimes(1);
    expect(labels(tree)).toEqual(["Go to Home", "Close"]);
    expect(text(tree)).toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expect(text(tree)).toContain("A payout or refund on your account is still in progress.");
    expect(toast(tree).visible).toBe(false);
    expect(mockState.signOut).not.toHaveBeenCalled();
    expectNoRecoveryPromise(tree);
  });

  it("confirm → server refuses with NO readable blockers: still the panel, with the generic line", async () => {
    mockState.requestDeletion = jest.fn().mockRejectedValue(new AccountDeletionBlockedError([]));
    const tree = await mount();
    await press(tree, "Continue");
    await press(tree, "Continue");
    await typeEmail(tree, "t2-host@example.test");
    await press(tree, "Delete my account");
    expect(text(tree)).toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expect(text(tree)).toContain(ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE);
    expect(labels(tree)).toEqual(["Go to Home", "Close"]);
  });

  it("confirm → server failed (500 / network): honest toast, stays on confirm, input cleared, not signed out", async () => {
    mockState.requestDeletion = jest.fn().mockRejectedValue(new AccountDeletionFailedError());
    const tree = await mount();
    await press(tree, "Continue");
    await press(tree, "Continue");
    await typeEmail(tree, "t2-host@example.test");
    await press(tree, "Delete my account");

    expect(toast(tree)).toEqual({ visible: true, message: ACCOUNT_DELETION_FAILED_MESSAGE });
    expect(labels(tree)).toEqual(["Back", "Delete my account"]);
    // cleared input → the destructive button is disabled again
    expect(button(tree, "Delete my account").props.disabled).toBe(true);
    expect(text(tree)).not.toContain(ACCOUNT_DELETION_BLOCKED_TITLE);
    expect(mockState.signOut).not.toHaveBeenCalled();
  });

  it("confirm → deleted with the login kept: the retained screen, and no promise of recovery", async () => {
    jest.useFakeTimers();
    try {
      mockState.requestDeletion = jest.fn().mockResolvedValue({
        success: true,
        authDeleted: false,
        authRetained: true,
        retainedReason: "business_records_retained",
      });
      const tree = await mount();
      await press(tree, "Continue");
      await press(tree, "Continue");
      await typeEmail(tree, "t2-host@example.test");
      await press(tree, "Delete my account");

      expect(labels(tree)).toEqual([]);
      expect(text(tree)).toContain("Business Account Deleted");
      expect(text(tree)).not.toContain("Account and login deleted");
      expectNoRecoveryPromise(tree);

      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });
      expect(mockState.signOut).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("confirm → deleted with the login removed: says so, final, no recovery window", async () => {
    jest.useFakeTimers();
    try {
      mockState.requestDeletion = jest.fn().mockResolvedValue({
        success: true,
        authDeleted: true,
        authRetained: false,
      });
      const tree = await mount();
      await press(tree, "Continue");
      await press(tree, "Continue");
      await typeEmail(tree, "t2-host@example.test");
      await press(tree, "Delete my account");
      expect(text(tree)).toContain("Account and login deleted");
      expect(text(tree)).toContain("This can't be undone.");
      expectNoRecoveryPromise(tree);
      await act(async () => {
        jest.runAllTimers();
        await Promise.resolve();
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
