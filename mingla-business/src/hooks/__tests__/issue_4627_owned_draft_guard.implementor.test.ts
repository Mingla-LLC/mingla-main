import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brandSetupRowState } from "../useBrandSetupStates";
import type { BrandSetupChecklist } from "../../services/brandSetupService";
import { canDeleteBrand } from "../../utils/brandDeletePermission";
import { canManageBrandPayments } from "../../utils/brandPaymentsPermission";

const SETH_ID = "46270000-0000-4000-8000-000000000001";
const TEAM_OWNER_ID = "46270000-0000-4000-8000-000000000002";

const draftChecklist = (doneCount = 1): BrandSetupChecklist =>
  ({
    doneCount,
    readiness: { items: [] },
    facts: { complete: false, isDraft: true, freeOnlyAt: null },
  }) as unknown as BrandSetupChecklist;

describe("#4627 owned draft guard", () => {
  test("a teammate's draft stays visible but only Seth's own draft blocks creation", () => {
    const hook = readFileSync(
      join(process.cwd(), "src/hooks/useBrandSetupStates.ts"),
      "utf8",
    );
    expect(brandSetupRowState(draftChecklist(2))).toEqual({ kind: "draft", doneCount: 2 });
    expect(hook).toContain("byId[brand.id] = state");
    expect(hook).toContain('state.kind === "draft"');
    expect(hook).toContain("user !== null && brand.accountId === user.id");
  });

  test("the lazy direct-draft gate requires exact id, account owner, and live draft state", () => {
    const flow = readFileSync(
      join(process.cwd(), "src/components/brand/BrandCreationFlow.tsx"),
      "utf8",
    );
    expect(flow).toContain("brand.data?.id === draftId");
    expect(flow).toContain("brand.data.accountId === user?.id");
    expect(flow).toContain("checklist.data?.facts.isDraft === true");
  });

  test("the correction does not widen owner-only delete or payout authority", () => {
    expect(canDeleteBrand({ accountId: TEAM_OWNER_ID }, SETH_ID)).toBe(false);
    expect(
      canManageBrandPayments({ role: "brand_admin", accepted: true }),
    ).toBe(false);
    expect(canDeleteBrand({ accountId: SETH_ID }, SETH_ID)).toBe(true);
    expect(
      canManageBrandPayments({ role: "brand_owner", accepted: true }),
    ).toBe(true);
  });
});
