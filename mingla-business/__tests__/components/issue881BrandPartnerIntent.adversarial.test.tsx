import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import {
  BRAND_CREATION_COPY,
  BrandCreationFlow,
} from "../../src/components/brand/BrandCreationFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockPartnerStatus: {
  data?: { partner_enabled: boolean };
  error?: Error;
} = {};
let partnerModeParam: string | undefined;

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({ partner_mode: partnerModeParam }),
}));

jest.mock("../../src/hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => mockPartnerStatus,
}));

jest.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-881-tester" }, isAuthReady: true }),
}));

jest.mock("../../src/store/currentBrandStore", () => ({
  useCurrentBrandStore: (selector: (state: { setCurrentBrand: () => void }) => unknown) =>
    selector({ setCurrentBrand: jest.fn() }),
}));

jest.mock("../../src/hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock("../../src/hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useCreateBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../../src/wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));

jest.mock("../../src/services/brandInvitationsService", () => ({
  inviteBrandMember: jest.fn(),
}));

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withTiming: (value: unknown) => value,
}));

jest.mock("../../src/utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: jest.fn() },
}));

jest.mock("../../src/components/ui/Spinner", () => ({
  Spinner: () => React.createElement("Spinner"),
}));

jest.mock("../../src/components/ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("GlassCard", null, children),
}));

jest.mock("../../src/components/ui/Icon", () => ({
  Icon: () => React.createElement("Icon"),
}));

jest.mock("../../src/components/ui/Input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("Input", props),
}));

jest.mock("../../src/components/ui/Stepper", () => ({
  Stepper: (props: Record<string, unknown>) => React.createElement("Stepper", props),
}));

jest.mock("../../src/components/ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) => React.createElement("Toast", props),
}));

jest.mock("../../src/components/brand/OfferingChooser", () => ({
  OfferingChooser: (props: Record<string, unknown>) =>
    React.createElement("OfferingChooser", props),
  routeForOffering: jest.fn(() => "/"),
}));

jest.mock("../../src/components/ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (props: Record<string, unknown>) =>
    React.createElement("CoverPickerSheet", props),
}));

jest.mock("../../src/components/location/MapboxAddressInput", () => ({
  MapboxAddressInput: (props: Record<string, unknown>) =>
    React.createElement("MapboxAddressInput", props),
}));

jest.mock("../../src/components/ui/EventCoverMedia", () => ({
  EventCoverMedia: (props: Record<string, unknown>) =>
    React.createElement("EventCoverMedia", props),
}));

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestRendererInstance {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

// react-test-renderer has no bundled types in this repository.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const flow = (): React.ReactElement => (
  <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />
);

const hostNodes = (
  root: TestInstance,
  predicate: (node: TestInstance) => boolean,
): TestInstance[] =>
  root.findAll((node) => typeof node.type === "string" && predicate(node));

const byLabel = (root: TestInstance, label: string): TestInstance[] =>
  hostNodes(root, (node) => node.props.accessibilityLabel === label);

const byText = (root: TestInstance, value: string): TestInstance[] =>
  hostNodes(
    root,
    (node) => node.type === "Text" && node.props.children === value,
  );

const press = (node: TestInstance): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Expected an onPress handler");
  onPress({});
};

const changeText = (node: TestInstance, value: string): void => {
  const onChangeText = node.props.onChangeText;
  if (typeof onChangeText !== "function") {
    throw new Error("Expected an onChangeText handler");
  }
  onChangeText(value);
};

const renderFlow = async (): Promise<TestRendererInstance> => {
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(flow());
  });
  return tree;
};

const rerender = async (tree: TestRendererInstance): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.update(flow());
  });
};

const resolvePartner = async (
  tree: TestRendererInstance,
  partnerEnabled: boolean,
): Promise<void> => {
  mockPartnerStatus.data = { partner_enabled: partnerEnabled };
  mockPartnerStatus.error = undefined;
  await rerender(tree);
};

const setIdentity = async (
  tree: TestRendererInstance,
  name: string,
  bio: string,
): Promise<void> => {
  await TestRenderer.act(async () => {
    changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]!, name);
    changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]!, bio);
  });
};

describe("issue #881 unresolved partner intent boundaries", () => {
  test("untouched late partner status reveals Step 0 once and remains idempotent", async () => {
    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = undefined;
    partnerModeParam = undefined;
    const tree = await renderFlow();

    expect(byText(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);

    await resolvePartner(tree, true);
    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(1);
    expect(byText(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(0);

    await rerender(tree);
    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("typed local name and bio survive late partner status exactly on Step 1", async () => {
    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = undefined;
    partnerModeParam = undefined;
    const tree = await renderFlow();
    const exactName = "  Élan & Co  ";
    const exactBio = "Late-night jazz — no cover.  ";

    await setIdentity(tree, exactName, exactBio);
    await resolvePartner(tree, true);

    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byText(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]?.props.value)
      .toBe(exactName);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]?.props.value)
      .toBe(exactBio);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("explicit late client intent reapplies client without leaving Step 1 or clearing data", async () => {
    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = undefined;
    partnerModeParam = "client";
    const tree = await renderFlow();
    const exactName = "Client / 881";
    const exactBio = "Keep  internal   spacing";

    await setIdentity(tree, exactName, exactBio);
    await resolvePartner(tree, true);

    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byText(tree.root, BRAND_CREATION_COPY.step1.titleClient)).toHaveLength(1);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]?.props.value)
      .toBe(exactName);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]?.props.value)
      .toBe(exactBio);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("post-Continue status refetch and rerender cannot reopen Step 0", async () => {
    mockPartnerStatus.data = { partner_enabled: true };
    mockPartnerStatus.error = undefined;
    partnerModeParam = undefined;
    const tree = await renderFlow();

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0]!);
    });
    expect(byText(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);

    await resolvePartner(tree, false);
    await resolvePartner(tree, true);
    await rerender(tree);

    expect(byText(tree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byText(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("nonpartner and status-error states fail open on Step 1", async () => {
    mockPartnerStatus.data = { partner_enabled: false };
    mockPartnerStatus.error = undefined;
    partnerModeParam = undefined;
    const nonpartnerTree = await renderFlow();

    expect(byText(nonpartnerTree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byText(nonpartnerTree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    expect(byLabel(nonpartnerTree.root, "Cancel brand creation")).toHaveLength(1);
    await TestRenderer.act(async () => nonpartnerTree.unmount());

    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = new Error("offline");
    const errorTree = await renderFlow();
    expect(byText(errorTree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byText(errorTree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    await TestRenderer.act(async () => errorTree.unmount());
  });

  test("error recovery reveals Step 0 only while untouched", async () => {
    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = new Error("offline");
    partnerModeParam = undefined;
    const untouchedTree = await renderFlow();
    await resolvePartner(untouchedTree, true);
    expect(byText(untouchedTree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(1);
    await TestRenderer.act(async () => untouchedTree.unmount());

    mockPartnerStatus.data = undefined;
    mockPartnerStatus.error = new Error("offline");
    const touchedTree = await renderFlow();
    await setIdentity(touchedTree, "Recovery Brand", "Offline draft");
    await resolvePartner(touchedTree, true);

    expect(byText(touchedTree.root, BRAND_CREATION_COPY.step0.title)).toHaveLength(0);
    expect(byLabel(touchedTree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]?.props.value)
      .toBe("Recovery Brand");
    expect(byLabel(touchedTree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]?.props.value)
      .toBe("Offline draft");
    await TestRenderer.act(async () => touchedTree.unmount());
  });
});
