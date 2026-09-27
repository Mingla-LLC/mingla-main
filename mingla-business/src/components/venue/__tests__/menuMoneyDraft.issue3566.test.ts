/**
 * #3566 implementor regression guard.
 *
 * This suite starts at the real MenuItemSheet interaction boundary: a malformed
 * money draft must remain visible for correction but must never reach onSave.
 * Pure parser coverage is added beside this integration proof once the single
 * production owner exists.
 */

import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement(
      "MockScrollView",
      null,
      children,
    ),
}));

jest.mock("../../ui/BrandSwitch", () => ({
  BrandSwitch: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("MockBrandSwitch", props),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (): null => null,
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("MockInput", props),
}));

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) =>
    visible
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("react") as typeof React).createElement(
          "MockSheet",
          null,
          children,
        )
      : null,
}));

// eslint-disable-next-line import/first
import {
  MenuItemSheet,
  type MenuItemSheetSaveInput,
} from "../MenuItemSheet";
// eslint-disable-next-line import/first
import {
  menuMoneyFractionDigits,
  parseMenuMoneyDraft,
} from "../menuMoneyDraft";
// eslint-disable-next-line import/first
import { majorFromMinor } from "../../../utils/currency";
// eslint-disable-next-line import/first
import type { MenuItem } from "../../../services/menusService";
// eslint-disable-next-line import/first
import { formatMenuPrice } from "../../../../../packages/brand-rendering/PublicMenuSections";

interface HostNode {
  type: unknown;
  props: Record<string, unknown>;
}

interface Tree {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
  };
  unmount: () => void;
}

interface MountOptions {
  item?: MenuItem | null;
  currency?: string;
  brandHasCurrency?: boolean;
  onSave?: (input: MenuItemSheetSaveInput) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const mounted: Tree[] = [];

afterEach(async () => {
  await TestRenderer.act(() => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

const mountSheet = async (options: MountOptions = {}): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(MenuItemSheet, {
        visible: true,
        onClose: () => undefined,
        item: options.item ?? null,
        currency: options.currency ?? "USD",
        brandHasCurrency: options.brandHasCurrency ?? true,
        onSave: options.onSave ?? (() => undefined),
        saving: false,
      }),
    );
  });
  const mountedTree = tree as Tree;
  mounted.push(mountedTree);
  return mountedTree;
};

const byTestId = (tree: Tree, testID: string): HostNode => {
  const matches = tree.root.findAll((node) => node.props.testID === testID);
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const renderedAndAccessibleCopy = (tree: Tree): string =>
  tree.root
    .findAll(() => true)
    .flatMap((node) => [
      typeof node.props.children === "string" ? node.props.children : null,
      typeof node.props.accessibilityLabel === "string"
        ? node.props.accessibilityLabel
        : null,
      typeof node.props.accessibilityHint === "string"
        ? node.props.accessibilityHint
        : null,
    ])
    .filter((value): value is string => value !== null)
    .join(" ");

const change = async (
  tree: Tree,
  testID: string,
  value: string,
): Promise<void> => {
  await TestRenderer.act(() => {
    (byTestId(tree, testID).props.onChangeText as (next: string) => void)(value);
  });
};

const pressSave = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(() => {
    (byTestId(tree, "menu-item-save").props.onPress as () => void)();
  });
};

test("malformed item price stays visible but cannot reach the save callback", async () => {
  const onSave = jest.fn<(input: MenuItemSheetSaveInput) => void>();
  const tree = await mountSheet({ onSave });

  await change(tree, "menu-item-name", "Audit item");
  await change(tree, "menu-item-price", "14.9.9");

  const price = byTestId(tree, "menu-item-price");
  const save = byTestId(tree, "menu-item-save");
  expect(price.props.value).toBe("14.9.9");
  expect(price.props.errorId).toBe("menu-item-price-error");
  expect(price.props.renderErrorMessage).toBe(false);

  await pressSave(tree);

  expect(onSave).not.toHaveBeenCalled();
  expect(save.props.disabled).toBe(true);
  expect(price.props.error).toBe(
    "Enter a valid amount, for example 14.90.",
  );
  expect(byTestId(tree, "menu-item-price-error").props).toMatchObject({
    accessibilityRole: "alert",
    "aria-live": "assertive",
    nativeID: "menu-item-price-error",
  });
});

describe("parseMenuMoneyDraft positive grammar", () => {
  test.each([
    ["0", "USD", 0],
    ["0.00", "USD", 0],
    ["0,00", "USD", 0],
    ["14", "USD", 1400],
    ["0014", "USD", 1400],
    ["14.9", "USD", 1490],
    ["14.90", "USD", 1490],
    ["1,234", "USD", 123400],
    ["1,234.56", "USD", 123456],
    ["14,9", "USD", 1490],
    ["14,90", "USD", 1490],
    ["1234,56", "USD", 123456],
    ["1.234,56", "USD", 123456],
    ["  14.90\t", "USD", 1490],
    ["0", "JPY", 0],
    ["1490", "JPY", 1490],
    ["100,000,000", "JPY", 100_000_000],
  ])("accepts %s in %s as exact minor units", (draft, currency, cents) => {
    expect(parseMenuMoneyDraft(draft, currency)).toEqual({
      kind: "valid",
      cents,
    });
  });

  test("blank is the only null result while zero stays a real amount", () => {
    expect(parseMenuMoneyDraft("", "USD")).toEqual({
      kind: "blank",
      cents: null,
    });
    expect(parseMenuMoneyDraft(" \t\n", "USD")).toEqual({
      kind: "blank",
      cents: null,
    });
    expect(parseMenuMoneyDraft("0", "USD")).toEqual({
      kind: "valid",
      cents: 0,
    });
  });

  test("accepts the exact database maximum and rejects one minor unit above", () => {
    expect(parseMenuMoneyDraft("1,000,000.00", "USD")).toEqual({
      kind: "valid",
      cents: 100_000_000,
    });
    expect(parseMenuMoneyDraft("1,000,000.01", "USD")).toEqual({
      kind: "invalid",
      reason: "range",
    });
    expect(parseMenuMoneyDraft("100000000", "JPY")).toEqual({
      kind: "valid",
      cents: 100_000_000,
    });
    expect(parseMenuMoneyDraft("100000001", "JPY")).toEqual({
      kind: "invalid",
      reason: "range",
    });
  });

  test("uses the shared currency factor and never rounds excess precision", () => {
    expect(menuMoneyFractionDigits("USD")).toBe(2);
    expect(menuMoneyFractionDigits("JPY")).toBe(0);
    expect(parseMenuMoneyDraft("1.999", "USD")).toEqual({
      kind: "invalid",
      reason: "precision",
    });
    expect(parseMenuMoneyDraft("1.0", "JPY")).toEqual({
      kind: "invalid",
      reason: "precision",
    });
  });

  test("rejects the proven prefix-coercion cases as complete drafts", () => {
    expect(parseMenuMoneyDraft("14.9.9", "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
    expect(parseMenuMoneyDraft("12abc", "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
    expect(parseMenuMoneyDraft("1,2,3", "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
  });
});

test.each([
  [0, "USD"],
  [1, "USD"],
  [1250, "USD"],
  [100_000_000, "USD"],
  [0, "JPY"],
  [1, "JPY"],
  [1250, "JPY"],
  [100_000_000, "JPY"],
])(
  "stored %i minor units in %s hydrate, reparse, and publicly format without drift",
  (storedCents, currency) => {
    const draft = String(majorFromMinor(storedCents, currency));
    const reparsed = parseMenuMoneyDraft(draft, currency);
    expect(reparsed).toEqual({ kind: "valid", cents: storedCents });
    if (reparsed.kind === "valid") {
      expect(formatMenuPrice(reparsed.cents, currency)).toBe(
        formatMenuPrice(storedCents, currency),
      );
    }
  },
);

test("valid Price and Cost use the same exact parser and blank stays null", async () => {
  const onSave = jest.fn<(input: MenuItemSheetSaveInput) => void>();
  const tree = await mountSheet({ onSave });
  await change(tree, "menu-item-name", "Dinner");
  await change(tree, "menu-item-price", "1.234,56");
  await change(tree, "menu-item-cost", "0");

  expect(byTestId(tree, "menu-item-save").props.disabled).toBe(false);
  await pressSave(tree);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    priceCents: 123456,
    costCents: 0,
  });

  await change(tree, "menu-item-cost", "   ");
  await pressSave(tree);
  expect(onSave.mock.calls[1]?.[0]).toMatchObject({ costCents: null });
});

test("edit hydration resaves representative stored cents unchanged", async () => {
  const onSave = jest.fn<(input: MenuItemSheetSaveInput) => void>();
  const item: MenuItem = {
    id: "item-3566",
    menuId: "menu-3566",
    brandId: "brand-3566",
    name: "Hydrated item",
    description: "Existing description",
    priceCents: 1,
    currency: "USD",
    isAvailable: true,
    sortOrder: 0,
    allowsNotes: true,
    prepStation: null,
    costCents: 100_000_000,
  };
  const tree = await mountSheet({ item, onSave });

  expect(byTestId(tree, "menu-item-price").props.value).toBe("0.01");
  expect(byTestId(tree, "menu-item-cost").props.value).toBe("1000000");
  await pressSave(tree);

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    priceCents: 1,
    costCents: 100_000_000,
  });
});

test("pre-bank precision and range copy never expose fallback GBP", async () => {
  const tree = await mountSheet({
    currency: "GBP",
    brandHasCurrency: false,
  });

  const price = (): HostNode => byTestId(tree, "menu-item-price");
  expect(price().props.placeholder).toBe("0.00");
  expect(price().props.accessibilityLabel).toBe("Item price");

  await change(tree, "menu-item-price", "1.999");
  expect(price().props.error).toBe("Use no more than 2 decimal places.");
  expect(byTestId(tree, "menu-item-price-error").props.children).toBe(
    "Use no more than 2 decimal places.",
  );

  await change(tree, "menu-item-price", "1,000,000.01");
  const rangeCopy = String(price().props.error);
  expect(rangeCopy).toBe("Amount must be 1,000,000.00 or less.");
  expect(rangeCopy).not.toMatch(/GBP|£/);
  expect(renderedAndAccessibleCopy(tree)).not.toMatch(
    /GBP|£|USD|\$|JPY|¥|EUR|€/,
  );
});

test("established USD and JPY use code-aware copy and scale placeholders", async () => {
  const usd = await mountSheet({ currency: "USD" });
  expect(byTestId(usd, "menu-item-price").props.placeholder).toBe("0.00");
  await change(usd, "menu-item-price", "1.999");
  expect(byTestId(usd, "menu-item-price").props.error).toBe(
    "USD supports at most 2 decimal places.",
  );

  const jpy = await mountSheet({ currency: "JPY" });
  expect(byTestId(jpy, "menu-item-price").props.placeholder).toBe("0");
  await change(jpy, "menu-item-price", "1.0");
  expect(byTestId(jpy, "menu-item-price").props.error).toBe(
    "JPY uses whole amounts; remove the decimal places.",
  );
});
