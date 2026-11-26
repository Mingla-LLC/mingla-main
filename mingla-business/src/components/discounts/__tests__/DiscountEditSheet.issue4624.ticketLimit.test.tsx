// MINGLA-INVARIANT: I-4624-9 | issue #4624 | The Code editor keeps the typed Total tickets text: 0, decimals and negatives show "Enter a whole number, 1 or more." and block Save ("Fix Total tickets to save."); they never silently save as no limit.
/* eslint-disable import/first */
/**
 * #4624 — ticket-capped codes. The REAL DiscountEditSheet, mounted with
 * react-test-renderer under the default node config (react-native →
 * __manual_mocks__/react-native.js). Boundaries mocked: Sheet, ScrollView,
 * the date field, Button (a probe that keeps its props), the scope picker,
 * analytics and the lazily imported discount service.
 *
 * FAILS ON REVERT: hide the Total tickets field for codes again, or route it
 * through numeric() (0 → no limit, 2.5 → 3), and the field / error / Save
 * assertions below go red.
 */
import React from "react";

import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Rendered {
  root: TestInstance;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Rendered;
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
};

const passthrough = (name: string) => (props: Record<string, unknown>) =>
  require("react").createElement(name, props, props.children as React.ReactNode);

jest.mock("../../ui/Sheet", () => ({ Sheet: passthrough("SheetProbe") }));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: passthrough("ScrollProbe"),
}));
jest.mock("../../ui/HostCalendarFields", () => ({
  HostDateTimeField: passthrough("DateProbe"),
}));
jest.mock("../../ui/Button", () => ({ Button: passthrough("ButtonProbe") }));
jest.mock("../DiscountScopePicker", () => ({
  DiscountScopePicker: passthrough("ScopeProbe"),
}));
jest.mock("../../../analytics/discountAnalytics", () => ({
  captureDiscountEvent: jest.fn(),
}));
const writeBrandDiscount = jest.fn(
  (_action: string, draft: Record<string, unknown>) =>
    Promise.resolve({ ...draft, id: "d-1" }),
);
jest.mock("../../../services/discountService", () => ({
  previewBrandDiscount: () => Promise.resolve([]),
  writeBrandDiscount: (action: string, draft: Record<string, unknown>) =>
    writeBrandDiscount(action, draft),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiscountEditSheet } from "../DiscountEditSheet";
import {
  CODE_LIMITS_HELP,
  parseTicketLimit,
  ticketLimitError,
  TOTAL_TICKETS_ERROR,
  TOTAL_TICKETS_SAVE_REASON,
} from "../discountEditorContract";
import type { BrandDiscount } from "../../../services/discountService";

const texts = (root: TestInstance): string[] =>
  root
    .findAll((node) => node.type === "Text")
    .map((node) => node.children.filter((c) => typeof c === "string").join(""));

const input = (root: TestInstance, label: string): TestInstance => {
  const found = root.findAll(
    (node) => node.type === "TextInput" && node.props.accessibilityLabel === label,
  );
  if (found.length !== 1) throw new Error(`expected one ${label} input, got ${found.length}`);
  return found[0];
};

const saveButton = (root: TestInstance): TestInstance =>
  root.findAll((node) => node.type === "ButtonProbe" && node.props.label === "Create discount")[0];

async function mount(discount: BrandDiscount | null = null): Promise<Rendered> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: Rendered;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <DiscountEditSheet
          visible
          brandId="brand-1"
          rank={20}
          currencyCode="NGN"
          prices={[]}
          offerings={[]}
          offeringsStatus="ready"
          onRetryOfferings={() => undefined}
          discount={discount}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </QueryClientProvider>,
    );
  });
  return tree;
}

async function type(root: TestInstance, label: string, value: string): Promise<void> {
  await TestRenderer.act(async () => {
    (input(root, label).props.onChangeText as (v: string) => void)(value);
  });
}

describe("#4624 Total tickets on a discount code", () => {
  test("contract: raw text parses to a whole number of 1 or more, empty = no limit", () => {
    expect(parseTicketLimit("")).toEqual({ valid: true, value: null });
    expect(parseTicketLimit(" 5 ")).toEqual({ valid: true, value: 5 });
    for (const bad of ["0", "-1", "2.5", "five", "1e3", "2147483648"]) {
      expect(parseTicketLimit(bad)).toEqual({ valid: false });
    }
    expect(ticketLimitError("code", "0")).toBe(TOTAL_TICKETS_ERROR);
    expect(ticketLimitError("automatic", "0")).toBeNull();
    expect(TOTAL_TICKETS_ERROR).toBe("Enter a whole number, 1 or more.");
    expect(TOTAL_TICKETS_SAVE_REASON).toBe("Fix Total tickets to save.");
    expect(CODE_LIMITS_HELP).toBe(
      "Total uses counts checkouts. Total tickets counts tickets. The code stops when either runs out.",
    );
  });

  test("a code shows Total tickets beside Total uses, both 'No limit', with the help line", async () => {
    const tree = await mount();
    const tickets = input(tree.root, "Total tickets");
    expect(tickets.props.placeholder).toBe("No limit");
    expect(tickets.props.keyboardType).toBe("number-pad");
    expect(input(tree.root, "Total uses").props.placeholder).toBe("No limit");
    expect(texts(tree.root)).toContain(CODE_LIMITS_HELP);
    expect(texts(tree.root)).not.toContain("End after N sold");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("0 and 2.5 show the error and block Save; 5 saves endsAfterCount 5; empty saves no limit", async () => {
    writeBrandDiscount.mockClear();
    const tree = await mount();
    await type(tree.root, "Name (shown on receipts)", "Talent code");
    await type(tree.root, "Code", "TOPZY");
    expect(saveButton(tree.root).props.disabled).toBe(false);

    for (const bad of ["0", "2.5", "-3"]) {
      await type(tree.root, "Total tickets", bad);
      expect(input(tree.root, "Total tickets").props.value).toBe(bad);
      expect(texts(tree.root)).toContain(TOTAL_TICKETS_ERROR);
      expect(texts(tree.root)).toContain(TOTAL_TICKETS_SAVE_REASON);
      expect(saveButton(tree.root).props.disabled).toBe(true);
      expect(saveButton(tree.root).props.accessibilityHint).toBe(TOTAL_TICKETS_SAVE_REASON);
    }

    await type(tree.root, "Total tickets", "5");
    expect(texts(tree.root)).not.toContain(TOTAL_TICKETS_ERROR);
    expect(texts(tree.root)).not.toContain(TOTAL_TICKETS_SAVE_REASON);
    expect(saveButton(tree.root).props.disabled).toBe(false);
    await TestRenderer.act(async () => {
      (saveButton(tree.root).props.onPress as () => void)();
    });
    expect(writeBrandDiscount).toHaveBeenCalledTimes(1);
    expect(writeBrandDiscount.mock.calls[0][0]).toBe("create");
    expect(writeBrandDiscount.mock.calls[0][1]).toMatchObject({
      kind: "code",
      code: "TOPZY",
      endsAfterCount: 5,
      maxTotalUses: null,
    });

    await type(tree.root, "Total tickets", "");
    expect(saveButton(tree.root).props.disabled).toBe(false);
    await TestRenderer.act(async () => {
      (saveButton(tree.root).props.onPress as () => void)();
    });
    expect(writeBrandDiscount.mock.calls[1][1]).toMatchObject({ endsAfterCount: null });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("editing a ticket-capped code shows its saved Total tickets", async () => {
    const tree = await mount({
      id: "d-9",
      brandId: "brand-1",
      kind: "code",
      code: "TOPZY",
      name: "Talent code",
      valueType: "percent",
      valueBps: 10000,
      valueMinor: null,
      scopeKind: "brand",
      combinesWith: "automatic_only",
      startsAt: "2026-11-26T00:00:00.000Z",
      endsAt: null,
      schedule: null,
      endsAfterCount: 5,
      maxTotalUses: 50,
      maxUsesPerBuyer: null,
      minSubtotalMinor: null,
      version: 3,
      targets: [],
    } as unknown as BrandDiscount);
    expect(input(tree.root, "Total tickets").props.value).toBe("5");
    expect(input(tree.root, "Total uses").props.value).toBe("50");
    await TestRenderer.act(async () => tree.unmount());
  });
});
