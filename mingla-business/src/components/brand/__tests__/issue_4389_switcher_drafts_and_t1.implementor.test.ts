/**
 * #4389 N1 up front, N3 switcher draft rows, and S-i (Tap to Pay with no
 * usable address opens T1).
 */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";
import * as fs from "fs";
import * as path from "path";

import { brandSetupRowState } from "../../../hooks/useBrandSetupStates";
import type { BrandSetupChecklist } from "../../../services/brandSetupService";
import { BRAND_SWITCHER_COPY } from "../brandSwitcherCopy";
import { TAP_ADDRESS_MISSING_COPY } from "../../../constants/tapToPayCopy";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string }) =>
      R.createElement(RN.Pressable, { testID: p.testID, accessibilityLabel: p.label, onPress: p.onPress }),
  };
});
jest.mock("../../../hooks/useMotionPreferences", () => ({ useReduceMotion: () => true }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: { findAll(p: (n: { props: Record<string, unknown>; type: unknown }) => boolean): Array<{ props: Record<string, unknown>; type: unknown }> }; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BIZ = path.join(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");

const checklist = (facts: Partial<BrandSetupChecklist["facts"]>, doneCount = 1): BrandSetupChecklist =>
  ({
    doneCount,
    readiness: { items: [] },
    facts: { complete: false, isDraft: false, freeOnlyAt: null, ...facts },
  }) as unknown as BrandSetupChecklist;

describe("#4389 N3 switcher rows", () => {
  test("draft, free-only and finished brands", () => {
    expect(brandSetupRowState(checklist({ isDraft: true }, 1))).toEqual({ kind: "draft", doneCount: 1 });
    expect(brandSetupRowState(checklist({ freeOnlyAt: "2026-11-11T00:00:00Z" }))).toEqual({ kind: "free_only", doneCount: 1 });
    // #4389 — any unfinished checklist reads as unfinished (published, not free-only).
    expect(brandSetupRowState(checklist({}, 3))).toEqual({ kind: "incomplete", doneCount: 3 });
    expect(brandSetupRowState(checklist({ complete: true }))).toEqual({ kind: "none" });
    expect(brandSetupRowState(undefined)).toEqual({ kind: "none" });
    expect(BRAND_SWITCHER_COPY.n3.draftLabel).toBe("Draft");
    expect(BRAND_SWITCHER_COPY.n3.progress(1)).toBe("1 of 4 done");
    expect(BRAND_SWITCHER_COPY.n3.freeOnlyTag).toBe("Free events only");
  });
  test("Continue opens the setup route; Discard draft opens the N1 confirm on its route, never over the sheet", () => {
    const sheet = read("src/components/brand/BrandSwitcherSheet.tsx");
    expect(sheet).toContain("router.push(`/brand/${brand.id}/setup` as never);");
    expect(sheet).toContain("&discard=1");
    expect(sheet).toContain("BRAND_SWITCHER_COPY.n3.discard");
    expect(sheet).not.toMatch(/<(Sheet|Modal|ConfirmDialog)\b/);
  });
  test("Create brand with a draft opens N1", () => {
    expect(read("src/components/brand/BrandSwitcherSheet.tsx")).toContain(
      "draftBrand !== null\n        ? `/brand/new?draft=",
    );
  });
});

describe("#4389 N1 up front", () => {
  test("/brand/new looks for the host's draft before showing F1, and discard=1 starts on the confirm", () => {
    const route = read("app/brand/new.tsx");
    expect(route).toContain("const setupStates = useBrandSetupStates(brandIds);");
    // While drafts load nothing shows (no F1 flash). #881 partner Step 0 and
    // the #3645 open-time latch sit in the same branch.
    expect(route).toContain("waitingForDrafts || resume !== null ? null : ");
    expect(route).toContain('startConfirming={first(params.discard) === "1"}');
    expect(route).toContain("BRAND_NEW_COPY.n1.discarded(discardedName)");
    expect(read("src/components/brand/BrandCreationFlow.tsx")).toContain(
      "const [confirming, setConfirming] = useState(startConfirming);",
    );
  });
});

describe("#4389 S-i Tap to Pay with no usable address", () => {
  test("says what to add and opens T1", () => {
    expect(TAP_ADDRESS_MISSING_COPY).toBe("Add the address where you'll take card payments");
    const view = read("src/components/door/tap/TapStatusView.tsx");
    expect(view).toContain("export const TapAddressMissing");
    expect(view).toContain('testID: "tap-add-address"');
    expect(read("src/services/terminal/tapToPaySetup.ts")).toContain("/tap-to-pay/address`");
    expect(fs.existsSync(path.join(BIZ, "app/brand/[id]/tap-to-pay/address.tsx"))).toBe(true);
  });
});

describe("#4389 S-i rendered: the T1 entry", () => {
  test("TapAddressMissing shows the words and Add address calls back", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TapAddressMissing } = require("../../door/tap/TapStatusView") as typeof import("../../door/tap/TapStatusView");
    const onAdd = jest.fn();
    let r!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      r = TestRenderer.create(React.createElement(TapAddressMissing, { onAddAddress: onAdd }));
    });
    const texts = r.root
      .findAll((n) => typeof n.type === "string" && /Text/.test(n.type as string))
      .map((n) => n.props.children)
      .filter((c): c is string => typeof c === "string");
    expect(texts).toContain(TAP_ADDRESS_MISSING_COPY);
    const add = r.root.findAll((n) => n.props.testID === "tap-add-address" && typeof n.props.onPress === "function")[0];
    TestRenderer.act(() => (add?.props.onPress as () => void)());
    expect(onAdd).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
