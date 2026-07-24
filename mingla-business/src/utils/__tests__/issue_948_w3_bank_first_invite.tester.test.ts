/**
 * #948 Wave 3 — independent adversarial accept-route proof.
 *
 * This mounts the production accept route across the three post-accept forks.
 * The implementor suite exercises the pure decision helper; this suite instead
 * proves the route effect and rendered CTA boundary cannot drift apart.
 *
 * FAILS ON REVERT:
 * - restoring the transferred-only celebration redirect misses the no-transfer
 *   partner and the expected /connect navigation;
 * - collapsing D5 to inline removes the rendered download marker;
 * - restoring the old unconditional download secondary adds that marker to the
 *   standard scanner fixture.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";
import type { AcceptBrandInvitationResult } from "../../services/brandInvitationsService";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "brand / adversarial #948";

let mockAuthStatus:
  | "bootstrapping"
  | "refreshing"
  | "signed_out"
  | "signed_in_ready"
  | "error";
let mockAcceptResult: AcceptBrandInvitationResult;
let mockAcceptAsync: jest.Mock;

const mockRouter = {
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "read-only-route-token" }),
  useRouter: () => mockRouter,
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    authStatus: mockAuthStatus,
    user: mockAuthStatus === "signed_in_ready"
      ? { email: "invitee@example.com" }
      : null,
    signOut: jest.fn(async () => undefined),
  }),
}));

jest.mock("../../hooks/useBrandInvitations", () => ({
  useAcceptBrandInvitation: () => ({
    mutateAsync: mockAcceptAsync,
  }),
}));

jest.mock("../../components/ui/Button", () => {
  const ReactRuntime = require("react");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactRuntime.createElement(
        "MockButton",
        { label, onPress },
        label,
      ),
  };
});

jest.mock("../../components/invite/BusinessAppDownloadCta", () => {
  const ReactRuntime = require("react");
  return {
    BusinessAppDownloadCta: () =>
      ReactRuntime.createElement("MockDownloadCta"),
  };
});

import AcceptBrandInvitationRoute from "../../../app/accept-brand-invitation";

interface TestInstance {
  children: (TestInstance | string)[];
  findAllByType: (type: string) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => TestTree;
};

const BASE_RESULT: AcceptBrandInvitationResult = {
  brandId: BRAND_ID,
  role: "brand_owner",
  transferred: true,
  previousOwnerAccountId: "old-owner",
  newOwnerAccountId: "new-owner",
  brandSlug: "adversarial-brand",
  newOwnerFirstName: "Amara",
  partnerSetup: true,
  countryCode: "GB",
  paymentProvider: "stripe",
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  paystackSubaccountCode: null,
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
    tree = TestRenderer.create(
      React.createElement(AcceptBrandInvitationRoute),
    );
  });
  await flush();
  if (tree === null) throw new Error("Accept route did not mount.");
  return tree;
}

describe("#948 W3 tester — production accept-route fork binding", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    mockAuthStatus = "signed_in_ready";
    mockAcceptResult = { ...BASE_RESULT };
    mockAcceptAsync = jest.fn(async () => mockAcceptResult);
    mockRouter.replace.mockClear();
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("no-transfer partner without a rail routes to the encoded one-hop bank path", async () => {
    mockAcceptResult = {
      ...BASE_RESULT,
      transferred: false,
    };

    tree = await mountRoute();

    expect(mockAcceptAsync).toHaveBeenCalledTimes(1);
    expect(mockAcceptAsync).toHaveBeenCalledWith("read-only-route-token");
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/brand/brand%20%2F%20adversarial%20%23948/connect",
    );
    expect(tree.root.findAllByType("MockDownloadCta")).toHaveLength(0);
  });

  test("D5 connected partner renders the get-app boundary and does not route back to bank", async () => {
    mockAcceptResult = {
      ...BASE_RESULT,
      stripeChargesEnabled: true,
    };

    tree = await mountRoute();

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(tree.root.findAllByType("MockDownloadCta")).toHaveLength(1);
  });

  test("standard scanner stays inline with no connect navigation and no app secondary", async () => {
    mockAcceptResult = {
      ...BASE_RESULT,
      partnerSetup: false,
      role: "scanner",
      transferred: false,
    };

    tree = await mountRoute();

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(tree.root.findAllByType("MockDownloadCta")).toHaveLength(0);
  });

  test("terminal signed-out auth renders without invoking acceptance", async () => {
    mockAuthStatus = "signed_out";

    tree = await mountRoute();

    expect(mockAcceptAsync).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(tree.root.findAllByType("MockDownloadCta")).toHaveLength(0);
    expect(
      tree.root.findAllByType("MockButton").map((button) =>
        (button as unknown as { props: { label: string } }).props.label
      ),
    ).toContain("Sign in");
  });
});
