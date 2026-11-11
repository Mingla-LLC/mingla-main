// #881 partner Step 0. #4389 moved the old wizard (with its Step 0) to
// PartnerClientBrandCreationFlow; /brand/new mounts it for partner hosts and
// self brands continue in the new 4-step setup. The Step 0 behaviour below
// is unchanged and now runs against that component; the last block pins the
// #4389 hand-over ("Myself" → the setup) that /brand/new wires in.
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";
import {
  BRAND_CREATION_COPY,
  BrandCreationFlow,
} from "../../src/components/brand/PartnerClientBrandCreationFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const partnerStatus = { data: { partner_enabled: true } };
let partnerModeParam: string | undefined;

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({ partner_mode: partnerModeParam }),
}));

jest.mock("../../src/hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => partnerStatus,
}));

jest.mock("../../src/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-881" }, isAuthReady: true }),
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

jest.mock("../../src/components/location/AddressInput", () => ({
  AddressInput: (props: Record<string, unknown>) =>
    React.createElement("AddressInput", props),
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
  unmount: () => void;
}

// react-test-renderer has no bundled types in this repository.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (
    element: React.ReactElement,
    options?: {
      createNodeMock?: (element: { props: Record<string, unknown> }) => object;
    },
  ) => TestRendererInstance;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const hostNodes = (
  root: TestInstance,
  predicate: (node: TestInstance) => boolean,
): TestInstance[] =>
  root.findAll((node) => typeof node.type === "string" && predicate(node));

const byLabel = (root: TestInstance, label: string): TestInstance[] =>
  hostNodes(root, (node) => node.props.accessibilityLabel === label);

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

const renderFlow = async (): Promise<{
  tree: TestRendererInstance;
  focusedLabels: string[];
}> => {
  const focusedLabels: string[] = [];
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
      {
        createNodeMock: (element) => ({
          focus: () => {
            const label = element.props.accessibilityLabel;
            if (typeof label === "string") focusedLabels.push(label);
          },
        }),
      },
    );
  });
  return { tree, focusedLabels };
};

describe("issue #881 partner Step 0 commitment", () => {
  test("self Continue is authoritative, single-shot, and moves focus to stable Step 1", async () => {
    partnerModeParam = undefined;
    const { tree, focusedLabels } = await renderFlow();

    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.selfTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: true });
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: false });

    const continueButton = byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0];
    expect(continueButton?.props.accessibilityRole).toBe("button");
    expect(continueButton).toBeDefined();

    await TestRenderer.act(async () => {
      press(continueButton!);
      press(continueButton!);
    });

    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.selfTitle)).toHaveLength(0);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(1);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.title)[0]?.props.accessibilityRole)
      .toBe("header");
    expect(focusedLabels).toEqual([BRAND_CREATION_COPY.step1.title]);
    expect(hostNodes(tree.root, (node) => node.type === "AddressInput")).toHaveLength(0);

    await TestRenderer.act(async () => tree.unmount());
  });

  test("Step 0 exposes one named radio group with exactly one selected option", async () => {
    partnerModeParam = undefined;
    const { tree } = await renderFlow();

    const group = byLabel(tree.root, BRAND_CREATION_COPY.step0.title);
    expect(group.some((node) => node.props.accessibilityRole === "radiogroup")).toBe(true);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.selfTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: true });
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: false });

    await TestRenderer.act(async () => tree.unmount());
  });

  test("client Continue reaches client Step 1 without skipping it", async () => {
    partnerModeParam = undefined;
    const { tree } = await renderFlow();

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]!);
    });
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: true });

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0]!);
    });

    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.titleClient)).toHaveLength(1);
    expect(hostNodes(tree.root, (node) => node.type === "AddressInput")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("Back preserves client mode and local identity, then focuses Step 0", async () => {
    partnerModeParam = undefined;
    const { tree, focusedLabels } = await renderFlow();

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]!);
    });
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0]!);
    });
    await TestRenderer.act(async () => {
      changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]!, "Cedar Room");
      changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]!, "Late-night listening bar");
    });
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, "Back")[0]!);
    });

    expect(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]?.props.accessibilityState)
      .toEqual({ selected: true });
    expect(focusedLabels.at(-1)).toBe(BRAND_CREATION_COPY.step0.title);

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0]!);
    });

    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.titleClient)).toHaveLength(1);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]?.props.value)
      .toBe("Cedar Room");
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.bioLabel)[0]?.props.value)
      .toBe("Late-night listening bar");
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("issue #881 Step 0 hand-over to the #4389 setup", () => {
  const renderWithHandOver = async (onSelfChosen: () => void): Promise<TestRendererInstance> => {
    let tree!: TestRendererInstance;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} onSelfChosen={onSelfChosen} />,
      );
    });
    return tree;
  };

  test("self Continue is authoritative and single-shot: it hands over exactly once", async () => {
    partnerModeParam = undefined;
    const onSelfChosen = jest.fn();
    const tree = await renderWithHandOver(onSelfChosen);
    const continueButton = byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0];
    expect(continueButton).toBeDefined();

    await TestRenderer.act(async () => {
      press(continueButton!);
      press(continueButton!);
    });

    expect(onSelfChosen).toHaveBeenCalledTimes(1);
    // The legacy self Step 1 never opens; /brand/new swaps in the setup.
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.title)).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("client Continue stays in the partner flow and reaches client Step 1", async () => {
    partnerModeParam = undefined;
    const onSelfChosen = jest.fn();
    const tree = await renderWithHandOver(onSelfChosen);

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.clientTitle)[0]!);
    });
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step0.cta)[0]!);
    });

    expect(onSelfChosen).not.toHaveBeenCalled();
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step1.titleClient)).toHaveLength(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("/brand/new mounts Step 0 for partner intent and the setup after Myself", () => {
    const route = fs.readFileSync(
      path.join(__dirname, "../../app/brand/new.tsx"),
      "utf8",
    );
    expect(route).toContain(
      '<LazyPartnerClientBrandCreationFlow onComplete={leave} onCancel={leave} onSelfChosen={chooseSelf} />',
    );
    expect(route).toContain(
      '<LazyBrandCreationFlow brandId={null} onExit={leave} onTypedNameChange={onTypedNameChange} />',
    );
    expect(route).toMatch(/entry === "partner-intent" \? \(\s*<LazyPartnerClientBrandCreationFlow/);
    // The setup's name field takes focus on arrival (the old Step 1 heading focus).
    const setup = fs.readFileSync(
      path.join(__dirname, "../../src/components/brand/BrandCreationFlow.tsx"),
      "utf8",
    );
    expect(setup).toMatch(/testID="brand-setup-name"[\s\S]*?autoFocus/);
  });
});
