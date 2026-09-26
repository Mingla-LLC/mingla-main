/**
 * #3561 independent tester guard — response-loss replay.
 *
 * This suite deliberately does not mount VenueMenuModule or reuse the
 * implementor test's parent-branch assertions. It treats MenuCategorySheet as
 * a retry boundary and simulates the dangerous sequence: the backend commits,
 * the response is lost, and the operator retries the still-open draft.
 *
 * Fails-on-revert: removing the #3561 product changes removes the sheet-owned
 * error contract and stable save-input id, so this suite cannot pass.
 *
 * Run:
 *   npx jest src/components/venue/__tests__/issue_3561_category_save_response_loss.tester.adversarial.test.tsx --runInBand
 */

import React, { useCallback, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Text, View } from "react-native";
import type { Menu } from "../../../services/menusService";
import type { MenuCategorySheetSaveInput } from "../MenuCategorySheet";

interface SaveCallbacks {
  onSuccess: () => void;
  onError: () => void;
}

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
}

const mockPersist =
  jest.fn<
    (input: MenuCategorySheetSaveInput, callbacks: SaveCallbacks) => void
  >();

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", props, children) : null),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => (
    <View>{children}</View>
  ),
}));

// Keep this import below the mocks so the real sheet binds to the test doubles.
// eslint-disable-next-line import/first
import { MenuCategorySheet } from "../MenuCategorySheet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "crypto",
);
let tree: TestRenderer | null = null;
let uuidSequence = 0;

function Harness({
  category = null,
}: {
  category?: Menu | null;
}): React.ReactElement {
  const [visible, setVisible] = useState<boolean>(true);
  const [saveFailed, setSaveFailed] = useState<boolean>(false);

  const close = useCallback((): void => {
    setVisible(false);
    setSaveFailed(false);
  }, []);

  const save = useCallback(
    (input: MenuCategorySheetSaveInput): void => {
      setSaveFailed(false);
      mockPersist(input, {
        onSuccess: close,
        onError: () => setSaveFailed(true),
      });
    },
    [close],
  );

  return (
    <>
      <MenuCategorySheet
        visible={visible}
        onClose={close}
        category={category}
        onSave={save}
        saving={false}
        saveFailed={saveFailed}
      />
      <MockHarnessControl
        label="Open category sheet"
        onPress={() => {
          setSaveFailed(false);
          setVisible(true);
        }}
      />
    </>
  );
}

function MockHarnessControl({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.ReactElement {
  return React.createElement("MockButton", { label, onPress });
}

const currentTree = (): TestRenderer => {
  if (tree === null) throw new Error("Renderer not mounted");
  return tree;
};

const button = (label: string): TestNode => {
  const found = currentTree()
    .root.findAllByType("MockButton")
    .find((node) => node.props.label === label);
  if (found === undefined) throw new Error(`Button not found: ${label}`);
  return found;
};

const input = (testID: string): TestNode =>
  currentTree().root.findByProps({ testID });

const call = (node: TestNode, propName: string, ...args: unknown[]): void => {
  const handler = node.props[propName];
  if (typeof handler !== "function") {
    throw new Error(`${propName} is not callable`);
  }
  (handler as (...values: unknown[]) => void)(...args);
};

const persistenceCall = (
  index: number,
): {
  input: MenuCategorySheetSaveInput;
  callbacks: SaveCallbacks;
} => {
  const callAtIndex = mockPersist.mock.calls[index];
  if (callAtIndex === undefined)
    throw new Error(`Persistence call ${index} missing`);
  return { input: callAtIndex[0], callbacks: callAtIndex[1] };
};

beforeEach(() => {
  mockPersist.mockReset();
  uuidSequence = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () =>
        `35610000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
    },
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (tree !== null) act(() => tree?.unmount());
  tree = null;
  if (originalCryptoDescriptor === undefined) {
    delete (globalThis as { crypto?: unknown }).crypto;
  } else {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
  }
});

describe("#3561 response-loss replay", () => {
  test("one committed add remains one row after retry, then a new session rotates id", () => {
    const committedRows = new Map<string, MenuCategorySheetSaveInput>();
    act(() => {
      tree = renderer.create(<Harness />);
    });
    act(() => call(input("menu-category-name"), "onChangeText", "Late plates"));

    act(() => call(button("Add category"), "onPress"));
    const firstAttempt = persistenceCall(0);
    committedRows.set(firstAttempt.input.id, firstAttempt.input);
    act(() => firstAttempt.callbacks.onError());

    expect(committedRows.size).toBe(1);
    expect(input("menu-category-name").props.value).toBe("Late plates");
    expect(
      currentTree().root.findAllByProps({
        testID: "menu-category-save-error",
        accessibilityRole: "alert",
        accessibilityLiveRegion: "assertive",
      }),
    ).not.toHaveLength(0);

    act(() => call(button("Try again"), "onPress"));
    const retry = persistenceCall(1);
    committedRows.set(retry.input.id, retry.input);
    expect(retry.input.id).toBe(firstAttempt.input.id);
    expect(committedRows.size).toBe(1);
    act(() => retry.callbacks.onSuccess());
    expect(currentTree().root.findAllByType("MockSheet")).toHaveLength(0);

    act(() => call(button("Open category sheet"), "onPress"));
    act(() => call(input("menu-category-name"), "onChangeText", "Dessert"));
    act(() => call(button("Add category"), "onPress"));
    const secondSession = persistenceCall(2);
    committedRows.set(secondSession.input.id, secondSession.input);

    expect(secondSession.input.id).not.toBe(firstAttempt.input.id);
    expect(committedRows.size).toBe(2);
  });

  test("an edit retry cannot drift away from the stored category id", () => {
    const storedCategory: Menu = {
      id: "35610000-0000-4000-8000-000000000099",
      brandId: "brand-a",
      venueId: "venue-a",
      name: "Dinner",
      description: null,
      sortOrder: 0,
      isActive: true,
      serviceWindowStart: null,
      serviceWindowEnd: null,
      serviceDays: null,
      items: [],
    };
    act(() => {
      tree = renderer.create(<Harness category={storedCategory} />);
    });

    act(() => call(button("Save category"), "onPress"));
    const firstAttempt = persistenceCall(0);
    act(() => firstAttempt.callbacks.onError());
    act(() => call(button("Try again"), "onPress"));
    const retry = persistenceCall(1);

    expect(firstAttempt.input.id).toBe(storedCategory.id);
    expect(retry.input.id).toBe(storedCategory.id);
    expect(currentTree().root.findAllByType(Text)).not.toHaveLength(0);
  });
});
