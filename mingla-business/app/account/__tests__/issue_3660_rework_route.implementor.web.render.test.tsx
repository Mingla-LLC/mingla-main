// @ts-nocheck — the mock harness is the tester's, copied unchanged; this package
// ships no type declarations for react-test-renderer, so the copy is not type-checked.
/**
 * #3660 rework — implementor render-proof for the two findings of the
 * independent tester's report that are on the Host delete SCREEN.
 *
 * F-5  A failure with no answer from the server must not say "Nothing was
 *      changed": the deletion may already have committed. A real answer from
 *      the server that it did not run still says so, where it is true.
 * F-8  The retained-login success screen told every Host to delete in the
 *      Mingla app to remove the login. For a Host who owned a brand that would
 *      not remove it either, so that Host gets the true reason instead. Every
 *      other retained case keeps the #2321 line unchanged.
 *
 * Mounts the REAL route through react-native-web with react-test-renderer. The
 * mock harness below is the independent tester's, copied unchanged from
 * issue_3660_delete_route_states.tester2.web.render.test.tsx so both suites
 * stage the route the same way.
 *
 * FAILS-ON-REVERT:
 *   - toast ACCOUNT_DELETION_FAILED_MESSAGE for every failure again → F-5 fails
 *   - render the #2321 "delete in the Mingla app" line for a brand owner → F-8 fails
 *
 * Run (from mingla-business):
 *   npx jest --config jest.issue3660.tester2.web.render.cjs --runInBand --ci
 */

import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import {
  ACCOUNT_DELETION_FAILED_MESSAGE,
  ACCOUNT_DELETION_RECORDS_RETAINED_LINE,
  ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
  AccountDeletionFailedError,
  AccountDeletionUnconfirmedError,
  parseDeletionFailure,
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
jest.mock("../../../src/store/doorSalesStore", () => ({
  useDoorSalesStore: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
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

type Tree = TestRenderer.ReactTestRenderer;

const buttons = (tree: Tree): TestRenderer.ReactTestInstance[] =>
  tree.root.findAll((n) => (n.type as unknown) === "mock-button");
const labels = (tree: Tree): string[] =>
  buttons(tree).map((b) => String(b.props.label));
const button = (tree: Tree, label: string): TestRenderer.ReactTestInstance => {
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
  const t = tree.root.find((n) => (n.type as unknown) === "mock-toast");
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
    (n) => typeof n.props.onChangeText === "function" && n.props.placeholder !== undefined,
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

const TO_REMOVE_LINE = "To remove that too, delete your account in the Mingla app.";

const confirmDelete = async (tree: Tree): Promise<void> => {
  await press(tree, "Continue");
  await press(tree, "Continue");
  await typeEmail(tree, "t2-host@example.test");
  await press(tree, "Delete my account");
};

describe("#3660 rework F-5 · what the Host is told when the deletion fails", () => {
  it("no answer from the server: says it could not be confirmed, never that nothing changed", async () => {
    mockState.requestDeletion = jest.fn().mockRejectedValue(new AccountDeletionUnconfirmedError());
    const tree = await mount();
    await confirmDelete(tree);

    expect(toast(tree)).toEqual({ visible: true, message: ACCOUNT_DELETION_UNCONFIRMED_MESSAGE });
    expect(toast(tree).message).toBe(
      "We couldn't confirm whether your account was deleted. Check your connection and try again.",
    );
    expect(toast(tree).message).not.toMatch(/nothing was changed/i);
    // Still on the confirm step, input cleared, not signed out: a retry is safe.
    expect(labels(tree)).toEqual(["Back", "Delete my account"]);
    expect(mockState.signOut).not.toHaveBeenCalled();
  });

  it("what the hook builds for a network failure and for a gateway timeout reaches that same toast", async () => {
    for (const error of [parseDeletionFailure(0, null), parseDeletionFailure(504, "<html>")]) {
      mockState.requestDeletion = jest.fn().mockRejectedValue(error);
      const tree = await mount();
      await confirmDelete(tree);
      expect(toast(tree).message).toBe(ACCOUNT_DELETION_UNCONFIRMED_MESSAGE);
    }
  });

  it("the server's own coded failure answer still says nothing was changed", async () => {
    for (const error of [
      new AccountDeletionFailedError(),
      parseDeletionFailure(500, { success: false, code: "account_deletion_failed" }),
    ]) {
      mockState.requestDeletion = jest.fn().mockRejectedValue(error);
      const tree = await mount();
      await confirmDelete(tree);
      expect(toast(tree)).toEqual({ visible: true, message: ACCOUNT_DELETION_FAILED_MESSAGE });
      expect(toast(tree).message).toMatch(/Nothing was changed/);
    }
  });
});

describe("#3660 rework F-8 · the retained-login success screen", () => {
  const succeed = async (response: Record<string, unknown>): Promise<Tree> => {
    mockState.requestDeletion = jest.fn().mockResolvedValue(response);
    const tree = await mount();
    await confirmDelete(tree);
    return tree;
  };

  it("a Host who owned a brand is told WHY the login is kept, not to delete in the Mingla app", async () => {
    jest.useFakeTimers();
    try {
      const tree = await succeed({
        success: true,
        authDeleted: false,
        authRetained: true,
        retainedReason: "business_records_retained",
      });
      expect(text(tree)).toContain("Business Account Deleted");
      expect(text(tree)).toContain(ACCOUNT_DELETION_RECORDS_RETAINED_LINE);
      expect(text(tree)).toContain(
        "Your login is kept so your sales and ticket records stay intact. Your Host account, brands and public pages are gone.",
      );
      expect(text(tree)).not.toContain(TO_REMOVE_LINE);
      expectNoRecoveryPromise(tree);
    } finally {
      jest.useRealTimers();
    }
  });

  it("every other retained case keeps the #2321 line and does not get the records line", async () => {
    jest.useFakeTimers();
    try {
      for (const retainedReason of ["explorer_side_active", undefined]) {
        const tree = await succeed({
          success: true,
          authDeleted: false,
          authRetained: true,
          ...(retainedReason ? { retainedReason } : {}),
        });
        expect(text(tree)).toContain("Business Account Deleted");
        expect(text(tree)).toContain(TO_REMOVE_LINE);
        expect(text(tree)).not.toContain(ACCOUNT_DELETION_RECORDS_RETAINED_LINE);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("a removed login shows neither retained line", async () => {
    jest.useFakeTimers();
    try {
      const tree = await succeed({ success: true, authDeleted: true, authRetained: false });
      expect(text(tree)).toContain("Account and login deleted");
      expect(text(tree)).not.toContain(TO_REMOVE_LINE);
      expect(text(tree)).not.toContain(ACCOUNT_DELETION_RECORDS_RETAINED_LINE);
    } finally {
      jest.useRealTimers();
    }
  });
});
