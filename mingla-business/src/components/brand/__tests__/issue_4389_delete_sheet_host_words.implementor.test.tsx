/**
 * #4389 (device r4) — the delete sheet read like developer notes ("One-way
 * action in-app … Future cycles may add a recovery UI", "Recovery within 30
 * days requires support intervention", "The cascade preview failed to load").
 * It now says it in host words, through i18n (all 29 locales).
 *
 * FAILS ON REVERT: the old literals back in BrandDeleteSheet → T1 / T2.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

let mockPreview: { data: unknown; isLoading: boolean; isError: boolean } = { data: null, isLoading: false, isError: true };
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { ScrollView: RN.ScrollView, DONE_BAR_OCCUPIED: 53 };
});
jest.mock("../../ui/Sheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Sheet: (p: { children?: React.ReactNode }) => R.createElement(RN.View, null, p.children) };
});
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { Button: (p: { label: string; onPress: () => void }) => R.createElement(RN.Pressable, { accessibilityLabel: p.label, onPress: p.onPress }) };
});
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../../hooks/useBrands", () => ({
  useBrandCascadePreview: () => mockPreview,
  useSoftDeleteBrand: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { BrandDeleteSheet } from "../BrandDeleteSheet";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";
import type { Brand } from "../../../store/currentBrandStore";

interface Node { type: unknown; props: Record<string, unknown>; children: Array<Node | string>; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" "));
const INTERNAL = /cycles?\b|intervention|cascade|in-app|audit logs|recovery UI/i;

describe("#4389 — the delete sheet speaks in host words", () => {
  test("T1: the first step says how to restore and that it can't be undone in the app", () => {
    const brand = { id: "b", displayName: "Old Shape Brand", accountId: "u", role: "owner" } as unknown as Brand;
    TestRenderer.act(() => {
      tree = TestRenderer.create(<BrandDeleteSheet visible brand={brand} accountId="u" onClose={() => undefined} />);
    });
    const root = (tree as unknown as { root: Node }).root;
    const text = textOf(root);
    expect(text).toContain("You can restore it for 30 days");
    expect(text).toContain("contact support within 30 days");
    expect(text).toContain("You can't undo this in the app");
    expect(text).not.toMatch(INTERNAL);

    const next = root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Continue")[0] as Node;
    TestRenderer.act(() => (next.props.onPress as () => void)());
    const preview = textOf(root);
    expect(preview).toContain(C.delete.previewErrorBody);
    expect(preview).not.toMatch(INTERNAL);
  });

  test("T2: every locale has the new delete words", () => {
    const base = path.join(__dirname, "../../../i18n/locales");
    for (const lang of fs.readdirSync(base)) {
      const file = path.join(base, lang, lang === "en" ? "brandSetup.json" : "hostSetup.json");
      const del = (JSON.parse(fs.readFileSync(file, "utf8")) as { brandSetup: { delete: Record<string, string> } }).brandSetup.delete;
      for (const k of ["restoreTitle", "restoreBody", "undoTitle", "undoBody", "previewErrorTitle", "previewErrorBody"]) {
        expect({ lang, k, ok: typeof del[k] === "string" && del[k].length > 0 }).toEqual({ lang, k, ok: true });
      }
    }
  });
});
