/**
 * Independent adversarial regression proof for #3566.
 *
 * The component checks below drive the real MenuItemSheet. Only its heavy leaf
 * controls are reduced to host probes, so draft ownership, validation, error
 * rendering, button gating, and the callback boundary remain production code.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("ScrollProbe", null, children),
}));

jest.mock("../../ui/BrandSwitch", () => ({
  BrandSwitch: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("SwitchProbe", props),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("ButtonProbe", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (): null => null,
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement("InputProbe", props),
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
          "SheetProbe",
          null,
          children,
        )
      : null,
}));

// Imports follow mocks so MenuItemSheet receives the lightweight leaf probes.
// eslint-disable-next-line import/first
import {
  MenuItemSheet,
  type MenuItemSheetSaveInput,
} from "../MenuItemSheet";
// eslint-disable-next-line import/first
import { parseMenuMoneyDraft } from "../menuMoneyDraft";
// eslint-disable-next-line import/first
import type { MenuItem } from "../../../services/menusService";
// eslint-disable-next-line import/first
import { formatCurrency } from "../../../utils/currency";
// eslint-disable-next-line import/first
import { formatMenuPrice } from "../../../../../packages/brand-rendering/PublicMenuSections";

interface ProbeNode {
  type: unknown;
  props: Record<string, unknown>;
}

interface RenderedTree {
  root: {
    findAll: (predicate: (node: ProbeNode) => boolean) => ProbeNode[];
  };
  unmount: () => void;
}

interface EditorOptions {
  currency?: string;
  brandHasCurrency?: boolean;
  item?: MenuItem | null;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderedTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const openTrees: RenderedTree[] = [];

afterEach(async () => {
  await renderer.act(() => {
    for (const tree of openTrees.splice(0)) tree.unmount();
  });
});

const lastNode = (tree: RenderedTree, testID: string): ProbeNode => {
  const nodes = tree.root.findAll((candidate) => candidate.props.testID === testID);
  if (nodes.length === 0) throw new Error(`Missing testID: ${testID}`);
  return nodes[nodes.length - 1];
};

const nodeCount = (tree: RenderedTree, testID: string): number =>
  tree.root.findAll((candidate) => candidate.props.testID === testID).length;

const openEditor = async (
  options: EditorOptions = {},
): Promise<{
  tree: RenderedTree;
  saved: jest.Mock<(payload: MenuItemSheetSaveInput) => void>;
  enter: (testID: string, draft: string) => Promise<void>;
  invokeSave: () => Promise<void>;
}> => {
  const saved = jest.fn<(payload: MenuItemSheetSaveInput) => void>();
  let tree: RenderedTree | undefined;

  await renderer.act(() => {
    tree = renderer.create(
      React.createElement(MenuItemSheet, {
        visible: true,
        onClose: () => undefined,
        item: options.item ?? null,
        currency: options.currency ?? "USD",
        brandHasCurrency: options.brandHasCurrency ?? true,
        saving: false,
        onSave: saved,
      }),
    );
  });

  const rendered = tree as RenderedTree;
  openTrees.push(rendered);

  return {
    tree: rendered,
    saved,
    enter: async (testID: string, draft: string): Promise<void> => {
      await renderer.act(() => {
        const handler = lastNode(rendered, testID).props.onChangeText as (
          value: string,
        ) => void;
        handler(draft);
      });
    },
    // Deliberately call onPress even while disabled. The handler itself is a
    // required second barrier against programmatic or platform event leakage.
    invokeSave: async (): Promise<void> => {
      await renderer.act(() => {
        const handler = lastNode(rendered, "menu-item-save").props.onPress as () =>
          void;
        handler();
      });
    },
  };
};

const surfaceStrings = (tree: RenderedTree): string =>
  tree.root
    .findAll(() => true)
    .flatMap((node) =>
      [
        node.props.children,
        node.props.accessibilityLabel,
        node.props.accessibilityHint,
        node.props.placeholder,
        node.props.error,
      ].filter((value): value is string => typeof value === "string"),
    )
    .join(" ");

const formatFailures = [
  // Missing whole/fraction digits and repeated or malformed separators.
  ".50",
  ",50",
  "14.",
  "14,",
  "14.9.9",
  "14,9,9",
  "1,2,3",
  "12,34,567",
  "1.23.456,78",
  "1,234,56",
  "1.234.56",
  // Signs, accounting syntax, exponents, suffixes, and symbols.
  "+14",
  "-14",
  "-0",
  "(14)",
  "1e2",
  "1E+2",
  "12abc",
  "12USD",
  "USD12",
  "$12",
  "£12",
  "¥12",
  "€12",
  "12%",
  "1_000",
  "12/2",
  "NaN",
  "Infinity",
  // Internal whitespace is never grouping, including Unicode spaces.
  "1 234",
  "1\t234",
  "1\n234",
  "1\u00a0234",
  "1\u202f234",
  // ASCII digits and the two approved separators are the entire alphabet.
  "١٢",
  "１２",
  "1'234",
  "1’234",
] as const;

describe("whole-draft grammar resists coercion", () => {
  test("the entire malformed corpus is rejected as format, never as a prefix", () => {
    const observed = Object.fromEntries(
      formatFailures.map((draft) => [draft, parseMenuMoneyDraft(draft, "USD")]),
    );

    expect(observed).toEqual(
      Object.fromEntries(
        formatFailures.map((draft) => [
          draft,
          { kind: "invalid", reason: "format" },
        ]),
      ),
    );
  });

  test("separator ambiguity is deterministic and excess trailing zeroes stay excess", () => {
    const grammarMatrix = {
      "1,234": parseMenuMoneyDraft("1,234", "USD"),
      "1,234.56": parseMenuMoneyDraft("1,234.56", "USD"),
      "1234,56": parseMenuMoneyDraft("1234,56", "USD"),
      "1.234,56": parseMenuMoneyDraft("1.234,56", "USD"),
      "1.234": parseMenuMoneyDraft("1.234", "USD"),
      "1.230": parseMenuMoneyDraft("1.230", "USD"),
      "1.999": parseMenuMoneyDraft("1.999", "USD"),
    };

    expect(grammarMatrix).toEqual({
      "1,234": { kind: "valid", cents: 123_400 },
      "1,234.56": { kind: "valid", cents: 123_456 },
      "1234,56": { kind: "valid", cents: 123_456 },
      "1.234,56": { kind: "valid", cents: 123_456 },
      "1.234": { kind: "invalid", reason: "precision" },
      "1.230": { kind: "invalid", reason: "precision" },
      "1.999": { kind: "invalid", reason: "precision" },
    });
  });

  test("JPY forbids every fraction spelling and both scales enforce max plus one", () => {
    expect({
      dotOne: parseMenuMoneyDraft("1.0", "JPY"),
      commaOne: parseMenuMoneyDraft("1,0", "JPY"),
      dotZeroes: parseMenuMoneyDraft("1.00", "JPY"),
      commaZeroes: parseMenuMoneyDraft("1,00", "JPY"),
      usdMax: parseMenuMoneyDraft("1,000,000.00", "USD"),
      usdOver: parseMenuMoneyDraft("1,000,000.01", "USD"),
      jpyMax: parseMenuMoneyDraft("100,000,000", "JPY"),
      jpyOver: parseMenuMoneyDraft("100000001", "JPY"),
    }).toEqual({
      dotOne: { kind: "invalid", reason: "precision" },
      commaOne: { kind: "invalid", reason: "precision" },
      dotZeroes: { kind: "invalid", reason: "precision" },
      commaZeroes: { kind: "invalid", reason: "precision" },
      usdMax: { kind: "valid", cents: 100_000_000 },
      usdOver: { kind: "invalid", reason: "range" },
      jpyMax: { kind: "valid", cents: 100_000_000 },
      jpyOver: { kind: "invalid", reason: "range" },
    });

    expect(parseMenuMoneyDraft(" \u00a0 14.90 \u202f ", "USD")).toEqual({
      kind: "valid",
      cents: 1490,
    });
    expect(parseMenuMoneyDraft("\t\n", "USD")).toEqual({
      kind: "blank",
      cents: null,
    });
  });
});

test("add flow retains two bad drafts, exposes two alerts, and has two save barriers", async () => {
  const editor = await openEditor();
  await editor.enter("menu-item-name", "Adversarial dish");
  await editor.enter("menu-item-price", "14.9.9");
  await editor.enter("menu-item-cost", "1.230");

  const price = lastNode(editor.tree, "menu-item-price");
  const cost = lastNode(editor.tree, "menu-item-cost");
  expect({ price: price.props.value, cost: cost.props.value }).toEqual({
    price: "14.9.9",
    cost: "1.230",
  });
  expect({
    priceError: price.props.error,
    priceErrorId: price.props.errorId,
    priceOwnsExternalMessage: price.props.renderErrorMessage,
    costError: cost.props.error,
    costErrorId: cost.props.errorId,
    costOwnsExternalMessage: cost.props.renderErrorMessage,
  }).toEqual({
    priceError: "Enter a valid amount, for example 14.90.",
    priceErrorId: "menu-item-price-error",
    priceOwnsExternalMessage: false,
    costError: "USD supports at most 2 decimal places.",
    costErrorId: "menu-item-cost-error",
    costOwnsExternalMessage: false,
  });
  expect(lastNode(editor.tree, "menu-item-price-error").props).toMatchObject({
    accessibilityRole: "alert",
    "aria-live": "assertive",
    nativeID: "menu-item-price-error",
  });
  expect(lastNode(editor.tree, "menu-item-cost-error").props).toMatchObject({
    accessibilityRole: "alert",
    "aria-live": "assertive",
    nativeID: "menu-item-cost-error",
  });
  expect(lastNode(editor.tree, "menu-item-save").props.disabled).toBe(true);

  await editor.invokeSave();
  expect(editor.saved).not.toHaveBeenCalled();

  await editor.enter("menu-item-price", "14.90");
  expect(nodeCount(editor.tree, "menu-item-price-error")).toBe(0);
  expect(nodeCount(editor.tree, "menu-item-cost-error")).toBeGreaterThan(0);
  expect(lastNode(editor.tree, "menu-item-save").props.disabled).toBe(true);

  await editor.enter("menu-item-cost", " \t ");
  expect(nodeCount(editor.tree, "menu-item-cost-error")).toBe(0);
  expect(lastNode(editor.tree, "menu-item-save").props.disabled).toBe(false);
  await editor.invokeSave();
  expect(editor.saved).toHaveBeenCalledTimes(1);
  expect(editor.saved.mock.calls[0]?.[0]).toMatchObject({
    name: "Adversarial dish",
    priceCents: 1490,
    costCents: null,
  });
});

test("edit flow cannot leak signed Price or over-max Cost, then recovers exactly", async () => {
  const existing: MenuItem = {
    id: "item-adversarial-3566",
    menuId: "menu-adversarial-3566",
    brandId: "brand-adversarial-3566",
    name: "Existing dish",
    description: null,
    priceCents: 1490,
    currency: "USD",
    isAvailable: true,
    sortOrder: 0,
    allowsNotes: false,
    prepStation: "kitchen",
    costCents: 700,
  };
  const editor = await openEditor({ item: existing });

  expect({
    price: lastNode(editor.tree, "menu-item-price").props.value,
    cost: lastNode(editor.tree, "menu-item-cost").props.value,
  }).toEqual({ price: "14.9", cost: "7" });

  await editor.enter("menu-item-price", "-0");
  await editor.enter("menu-item-cost", "1,000,000.01");
  expect({
    price: lastNode(editor.tree, "menu-item-price").props.value,
    cost: lastNode(editor.tree, "menu-item-cost").props.value,
    disabled: lastNode(editor.tree, "menu-item-save").props.disabled,
  }).toEqual({ price: "-0", cost: "1,000,000.01", disabled: true });
  await editor.invokeSave();
  expect(editor.saved).not.toHaveBeenCalled();

  await editor.enter("menu-item-price", "");
  await editor.enter("menu-item-cost", "1,000,000.00");
  await editor.invokeSave();
  expect(editor.saved).toHaveBeenCalledTimes(1);
  expect(editor.saved.mock.calls[0]?.[0]).toMatchObject({
    priceCents: null,
    costCents: 100_000_000,
    allowsNotes: false,
    prepStation: "kitchen",
  });
});

test("established USD and JPY show scale-correct placeholders and exact error copy", async () => {
  const usd = await openEditor({ currency: "USD" });
  expect(lastNode(usd.tree, "menu-item-price").props.placeholder).toBe("0.00");
  expect(lastNode(usd.tree, "menu-item-cost").props.placeholder).toBe("0.00");
  await usd.enter("menu-item-price", "1.230");
  await usd.enter("menu-item-cost", "1,000,000.01");
  expect({
    precision: lastNode(usd.tree, "menu-item-price").props.error,
    range: lastNode(usd.tree, "menu-item-cost").props.error,
  }).toEqual({
    precision: "USD supports at most 2 decimal places.",
    range: `Amount must be ${formatCurrency(100_000_000, "USD", true)} or less.`,
  });

  const jpy = await openEditor({ currency: "JPY" });
  expect(lastNode(jpy.tree, "menu-item-price").props.placeholder).toBe("0");
  expect(lastNode(jpy.tree, "menu-item-cost").props.placeholder).toBe("0");
  await jpy.enter("menu-item-price", "1.0");
  await jpy.enter("menu-item-cost", "100000001");
  expect({
    precision: lastNode(jpy.tree, "menu-item-price").props.error,
    range: lastNode(jpy.tree, "menu-item-cost").props.error,
  }).toEqual({
    precision: "JPY uses whole amounts; remove the decimal places.",
    range: `Amount must be ${formatCurrency(100_000_000, "JPY", true)} or less.`,
  });
});

test("pre-bank two- and zero-decimal errors leak no fabricated code or glyph", async () => {
  const twoDecimal = await openEditor({
    currency: "GBP",
    brandHasCurrency: false,
  });
  await twoDecimal.enter("menu-item-price", "1.230");
  await twoDecimal.enter("menu-item-cost", "1,000,000.01");
  expect({
    price: lastNode(twoDecimal.tree, "menu-item-price").props.error,
    cost: lastNode(twoDecimal.tree, "menu-item-cost").props.error,
  }).toEqual({
    price: "Use no more than 2 decimal places.",
    cost: "Amount must be 1,000,000.00 or less.",
  });
  expect(surfaceStrings(twoDecimal.tree)).not.toMatch(
    /\b(?:GBP|USD|JPY|EUR)\b|[£$¥€]/,
  );

  const zeroDecimal = await openEditor({
    currency: "JPY",
    brandHasCurrency: false,
  });
  await zeroDecimal.enter("menu-item-price", "1.0");
  await zeroDecimal.enter("menu-item-cost", "100000001");
  expect({
    price: lastNode(zeroDecimal.tree, "menu-item-price").props.error,
    cost: lastNode(zeroDecimal.tree, "menu-item-cost").props.error,
  }).toEqual({
    price: "Use whole amounts; remove the decimal places.",
    cost: "Amount must be 100,000,000 or less.",
  });
  expect(surfaceStrings(zeroDecimal.tree)).not.toMatch(
    /\b(?:GBP|USD|JPY|EUR)\b|[£$¥€]/,
  );
});

test("public output formats Price while public contracts keep private Cost absent", () => {
  expect(formatMenuPrice(1490, "USD")).toBe("$14.90");
  expect(formatMenuPrice(1490, "JPY")).toMatch(/(?:JP)?¥1,490/);
  expect(formatMenuPrice(null, "USD")).toBeNull();

  const publicTypes = fs.readFileSync(
    path.join(__dirname, "../../../../../packages/brand-rendering/types.ts"),
    "utf8",
  );
  const publicService = fs.readFileSync(
    path.join(__dirname, "../../../services/publicMenusService.ts"),
    "utf8",
  );
  const publicItem = publicTypes.match(
    /export interface PublicMenuItem \{[\s\S]*?\n\}/,
  )?.[0];
  const publicRow = publicService.match(
    /export interface MenuItemPublicRow \{[\s\S]*?\n\}/,
  )?.[0];
  const publicSelect = publicService.match(
    /const PUBLIC_MENU_SELECT =[\s\S]*?;/,
  )?.[0];

  expect(publicItem).toContain("priceCents: number | null;");
  expect(publicItem).not.toMatch(/cost/i);
  expect(publicRow).toContain("price_cents: number | null;");
  expect(publicRow).not.toMatch(/cost/i);
  expect(publicSelect).toContain("price_cents");
  expect(publicSelect).not.toMatch(/cost/i);
});

test("wiring sentinel: both drafts use the exact parser and both invalid states gate save", () => {
  const sheetSource = fs.readFileSync(
    path.join(__dirname, "../MenuItemSheet.tsx"),
    "utf8",
  );
  const inputSource = fs.readFileSync(
    path.join(__dirname, "../../ui/Input.tsx"),
    "utf8",
  );

  expect(sheetSource).toContain("parseMenuMoneyDraft(priceDraft, code)");
  expect(sheetSource).toContain("parseMenuMoneyDraft(costDraft, code)");
  expect(sheetSource).toMatch(
    /priceResult\.kind !== "invalid"[\s\S]{0,100}costResult\.kind !== "invalid"/,
  );
  expect(sheetSource).toMatch(
    /priceResult\.kind === "invalid"[\s\S]{0,100}costResult\.kind === "invalid"/,
  );
  expect(sheetSource).not.toMatch(/parseFloat\(|\.replace\(\/,\/g/);
  expect(inputSource).toContain('{ "aria-invalid": true, "aria-describedby": errorId }');
  expect(inputSource).toContain('accessibilityRole="alert"');
  expect(inputSource).toContain('aria-live="assertive"');
});
