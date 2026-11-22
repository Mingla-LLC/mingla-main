/**
 * #4541 T-36 (R6.1 SC-40, R6.2 SC-41) — Host Forms polish.
 *
 * R6.1: the Forms list draws no "Create a form" button of its own (header or
 * empty state); it registers the shell's shared action, and that action opens
 * the name sheet in place.
 * R6.2: under All pages the Not answered tab adds up each page's "to answer";
 * while the counts load or failed it has no number.
 *
 * FAILS-ON-REVERT: putting the header button or the empty-state cta back, or
 * dropping the useMarketingActionRegistration call, turns the R6.1 cases RED;
 * returning `tabNotAnswered(notAnswered.length)` for All pages turns R6.2 RED.
 */

import React from "react";
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; unmount: () => void };
  act: (cb: () => void) => void;
};

type Action = { id: string; label: string; compactLabel: string; icon: string; onPress: () => void };
const registered: Array<Action | null> = [];
let listItems: unknown[] = [];

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { ScrollView: ({ children }: { children?: React.ReactNode }) => R.createElement("ScrollView", null, children) };
});
jest.mock("../../people/MarketingBrandSwitcherContext", () => ({
  useMarketingActionRegistration: (action: Action | null) => {
    registered.push(action);
  },
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "brand-1" }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 100, isLoading: false }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../hooks/useBrandForms", () => ({
  useBrandFormsList: () => ({ data: listItems, isLoading: false, isError: false, refetch: jest.fn() }),
  useBrandFormCounts: () => ({ data: undefined, isError: false }),
  useCreateBrandForm: () => ({ isPending: false, mutate: jest.fn() }),
  useReopenBrandForm: () => ({ isPending: false, mutate: jest.fn() }),
}));
jest.mock("../useFormsToast", () => ({
  useFormsToast: () => ({ show: jest.fn(), toast: null }),
  errorSentence: (_e: unknown, f: string) => f,
}));
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      R.createElement("Sheet", { visible }, visible ? children : null),
  };
});
jest.mock("../../ui/SheetScrollLayout", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    SheetScrollLayout: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      R.createElement("SheetScrollLayout", { testID }, children),
  };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props) };
});
jest.mock("../../ui/EmptyState", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { EmptyState: (props: Record<string, unknown>) => R.createElement("EmptyState", props) };
});
jest.mock("../../ui/GlassCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { GlassCard: ({ children }: { children?: React.ReactNode }) => R.createElement("GlassCard", null, children) };
});
jest.mock("../../ui/Pill", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Pill: ({ children }: { children?: React.ReactNode }) => R.createElement("Pill", null, children), Chip: () => null };
});

import { BrandFormsListScreen } from "../BrandFormsListScreen";
import { notAnsweredTabLabel } from "../brandFormsCopy";

const liveItem = {
  form: {
    id: "f1", brandId: "brand-1", name: "Guest details", status: "live", draft: { questions: [] }, draftRev: 1,
    liveVersionId: "v1", doorFullAnswers: true, doorFullAnswersInvited: false, updatedAt: "2026-11-21T00:00:00Z", closedAt: null,
  },
  questionCount: 2,
  version: 1,
  attachments: [],
};

const createButtons = (root: Node): Node[] =>
  root.findAll((n) => n.type === "Button" && n.props.label === "Create a form");

const mount = (): { root: Node; unmount: () => void } => {
  let r: { root: Node; unmount: () => void } | null = null;
  act(() => {
    r = create(<BrandFormsListScreen />);
  });
  if (r === null) throw new Error("not mounted");
  return r;
};

describe("#4541 R6.1 one Create a form control", () => {
  beforeEach(() => {
    registered.length = 0;
  });

  test("with forms: no header button; the header is a plain count; the shared action is registered", () => {
    listItems = [liveItem, { ...liveItem, form: { ...liveItem.form, id: "f2" } }];
    const r = mount();
    expect(createButtons(r.root)).toHaveLength(0);
    expect(r.root.findAll((n) => n.props.testID === "brand-forms-create")).toHaveLength(0);
    const heading = r.root.findAll((n) => n.props.testID === "brand-forms-count" && n.type === "Text");
    expect(heading).toHaveLength(1);
    const action = registered.filter((a): a is Action => a !== null).pop();
    expect(action).toMatchObject({ label: "Create a form", compactLabel: "New", icon: "plus" });
    r.unmount();
  });

  test("empty: the empty state has no button and reads the new line", () => {
    listItems = [];
    const r = mount();
    const empty = r.root.findAll((n) => n.type === "EmptyState" && n.props.testID === "brand-forms-empty");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.props.cta).toBeUndefined();
    expect(empty[0]?.props.description).toBe("No forms yet. Make one with Create a form, then add it to any page.");
    expect(createButtons(r.root)).toHaveLength(0);
    r.unmount();
  });

  test("the shared action opens the name sheet in place", () => {
    listItems = [liveItem];
    const r = mount();
    const sheetOpen = (): boolean => r.root.findAll((n) => n.type === "Sheet")[0]?.props.visible === true;
    expect(sheetOpen()).toBe(false);
    const action = registered.filter((a): a is Action => a !== null).pop();
    expect(action).toBeDefined();
    act(() => action?.onPress());
    expect(sheetOpen()).toBe(true);
    r.unmount();
  });
});

describe("#4541 R6.2 Not answered under All pages", () => {
  test("adds up each page's to-answer", () => {
    expect(
      notAnsweredTabLabel({ allPages: true, pageNotAnswered: 0, pageCounts: [{ toAnswer: 3 }, { toAnswer: 4 }] }),
    ).toBe("Not answered (7)");
  });
  test("no number while the counts load or failed (never a wrong 0)", () => {
    expect(notAnsweredTabLabel({ allPages: true, pageNotAnswered: 0, pageCounts: null })).toBe("Not answered");
  });
  test("one page keeps its own list count", () => {
    expect(notAnsweredTabLabel({ allPages: false, pageNotAnswered: 2, pageCounts: [{ toAnswer: 9 }] })).toBe(
      "Not answered (2)",
    );
  });
});
