/**
 * #4389 N1 up front, N3 switcher draft rows, and S-i (Tap to Pay with no
 * usable address opens T1).
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import { brandSetupRowState } from "../../../hooks/useBrandSetupStates";
import type { BrandSetupChecklist } from "../../../services/brandSetupService";
import { BRAND_SETUP_COPY } from "../brandSetupCopy";
import { TAP_ADDRESS_MISSING_COPY } from "../../../constants/tapToPayCopy";

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
    expect(brandSetupRowState(checklist({ freeOnlyAt: "2026-11-11T00:00:00Z" }))).toEqual({ kind: "free_only" });
    expect(brandSetupRowState(checklist({ complete: true }))).toEqual({ kind: "none" });
    expect(brandSetupRowState(undefined)).toEqual({ kind: "none" });
    expect(BRAND_SETUP_COPY.n3.draft(1)).toBe("Draft · 1 of 4");
    expect(BRAND_SETUP_COPY.n3.freeOnly).toBe("Free events only · Finish setup");
  });
  test("Continue opens the setup route; Discard draft opens the N1 confirm on its route, never over the sheet", () => {
    const sheet = read("src/components/brand/BrandSwitcherSheet.tsx");
    expect(sheet).toContain("router.push(`/brand/${brand.id}/setup` as never);");
    expect(sheet).toContain("&discard=1");
    expect(sheet).toContain("BRAND_SETUP_COPY.n3.discard");
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
    expect(route).toContain("waitingForDrafts ? null : (");
    expect(route).toContain('startConfirming={first(params.discard) === "1"}');
    expect(route).toContain("BRAND_SETUP_COPY.n1.discarded(discardedName)");
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
