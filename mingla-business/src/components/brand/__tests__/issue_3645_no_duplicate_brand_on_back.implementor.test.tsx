/**
 * #3645 — stepping back to step 1 of brand creation and pressing Continue must
 * EDIT the brand this flow already created, never insert a second one.
 *
 * Mounts the PRODUCTION BrandCreationFlow on the same harness as
 * issue_2719_brand_payout_first.happy.test.tsx (stock node/ts-jest gate).
 *
 * FAILS ON REVERT: remove the `brand !== null` branch from
 * handleCreateIdentity → the second Continue calls createBrand again (2 calls)
 * and updateBrand is never called with the new name.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_no_duplicate_brand_on_back.implementor.test.tsx --runInBand
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { BRAND_CREATION_COPY, BrandCreationFlow } from "../BrandCreationFlow";
import type { Brand } from "../../../types/brand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const routerPush = jest.fn();
const createBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const updateBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const haptic = jest.fn();
const stripeStatus = "not_connected";

const BRAND: Brand = {
  id: "36450000-0000-4000-8000-000000000002",
  displayName: "Sunday Table",
  slug: "sundaytable",
  address: null,
  coverHue: 25,
  accountId: "account-2719",
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  paymentProvider: "stripe",
  stripeStatus: "not_connected",
};

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({}),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "Medium" },
  impactAsync: (...args: unknown[]) => haptic(...args),
}));

jest.mock("../../../hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => ({ data: { partner_enabled: false } }),
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "account-2719" },
    isAuthReady: true,
    loading: false,
    session: { access_token: "test" },
  }),
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (selector: (state: { setCurrentBrand: () => void }) => unknown) =>
    selector({ setCurrentBrand: jest.fn() }),
}));

jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({
    mutateAsync: jest.fn(() => Promise.resolve(undefined)),
  }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useBrand: () => ({ data: null, isFetched: false, isError: false, refetch: jest.fn() }),
  useCreateBrand: () => ({
    mutateAsync: (input: unknown) => createBrand(input),
    isPending: false,
  }),
  useUpdateBrand: () => ({
    mutateAsync: (input: unknown) => updateBrand(input),
    isPending: false,
  }),
}));

jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: { status: stripeStatus },
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useCanManageBrandPayments", () => ({
  useCanManageBrandPayments: () => ({
    allowed: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    role: "brand_owner",
    accepted: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));

jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../services/brandInvitationsService", () => ({
  inviteBrandMember: jest.fn(),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("Button", {
      ...props,
      accessibilityRole: "button",
      accessibilityLabel: props.accessibilityLabel ?? props.label,
    }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("GlassCard", props, children),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("Input", props),
}));
jest.mock("../../ui/Stepper", () => ({
  Stepper: (props: Record<string, unknown>) => React.createElement("Stepper", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) => React.createElement("Toast", props),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (props: Record<string, unknown>) =>
    React.createElement("CoverPickerSheet", props),
}));
jest.mock("../../location/MapboxAddressInput", () => ({
  MapboxAddressInput: (props: Record<string, unknown>) =>
    React.createElement("MapboxAddressInput", props),
}));
jest.mock("../../ui/EventCoverMedia", () => ({
  EventCoverMedia: (props: Record<string, unknown>) =>
    React.createElement("EventCoverMedia", props),
}));

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

interface Renderer {
  root: TestNode;
  unmount: () => void;
}

// react-test-renderer is installed in the required full-suite CI lane.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const byLabel = (root: TestNode, label: string): TestNode[] =>
  root.findAll((node) => node.props.accessibilityLabel === label);

const press = (node: TestNode): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Expected onPress");
  onPress({});
};

const changeText = (node: TestNode, value: string): void => {
  const onChangeText = node.props.onChangeText;
  if (typeof onChangeText !== "function") throw new Error("Expected onChangeText");
  onChangeText(value);
};

const flush = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

async function mountFlow(): Promise<Renderer> {
  let tree!: Renderer;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
    );
  });
  return tree;
}

async function typeName(tree: Renderer, value: string): Promise<void> {
  await TestRenderer.act(async () => {
    changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]!, value);
  });
}

async function pressContinue(tree: Renderer): Promise<void> {
  await TestRenderer.act(async () => {
    press(byLabel(tree.root, BRAND_CREATION_COPY.step1.cta)[0]!);
    await flush();
  });
}

async function pressBack(tree: Renderer): Promise<void> {
  await TestRenderer.act(async () => {
    press(byLabel(tree.root, "Back")[0]!);
  });
}

const onStepTwo = (tree: Renderer): boolean =>
  byLabel(tree.root, BRAND_CREATION_COPY.step2.skip).length > 0;

describe("#3645 — Continue on step 1 never creates a second brand", () => {
  beforeEach(() => {
    createBrand.mockReset();
    updateBrand.mockReset();
    createBrand.mockResolvedValue(BRAND);
    updateBrand.mockImplementation(async (input) => ({
      ...BRAND,
      ...((input as { patch: Partial<Brand> }).patch),
    }));
  });

  test("back to step 1, rename, Continue → the same brand is updated and the flow advances", async () => {
    const tree = await mountFlow();
    await typeName(tree, "Sunday Table");
    await pressContinue(tree);
    expect(createBrand).toHaveBeenCalledTimes(1);
    expect(onStepTwo(tree)).toBe(true);

    await pressBack(tree);
    expect(onStepTwo(tree)).toBe(false);
    await typeName(tree, "Sunday Table Lagos");
    await pressContinue(tree);

    expect(createBrand).toHaveBeenCalledTimes(1);
    expect(updateBrand).toHaveBeenCalledTimes(1);
    expect(updateBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND.id,
        patch: { displayName: "Sunday Table Lagos", bio: "" },
      }),
    );
    expect(onStepTwo(tree)).toBe(true);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("back to step 1 and Continue with nothing changed → no write at all, still advances", async () => {
    const tree = await mountFlow();
    await typeName(tree, "Sunday Table");
    await pressContinue(tree);
    await pressBack(tree);
    await pressContinue(tree);

    expect(createBrand).toHaveBeenCalledTimes(1);
    expect(updateBrand).not.toHaveBeenCalled();
    expect(onStepTwo(tree)).toBe(true);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a failed rename stays on step 1 and still does not insert a second brand", async () => {
    const tree = await mountFlow();
    await typeName(tree, "Sunday Table");
    await pressContinue(tree);
    await pressBack(tree);
    updateBrand.mockRejectedValueOnce(new Error("network"));
    await typeName(tree, "Sunday Table Lagos");
    await pressContinue(tree);

    expect(createBrand).toHaveBeenCalledTimes(1);
    expect(updateBrand).toHaveBeenCalledTimes(1);
    expect(onStepTwo(tree)).toBe(false);
    await TestRenderer.act(async () => tree.unmount());
  });
});
