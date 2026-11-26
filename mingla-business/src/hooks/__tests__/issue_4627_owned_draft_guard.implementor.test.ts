import { describe, expect, test } from "@jest/globals";

import {
  deriveBrandSetupStates,
  type BrandSetupRowState,
} from "../useBrandSetupStates";
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

const stateFor = (
  states: ReturnType<typeof deriveBrandSetupStates>,
  brandId: string,
): BrandSetupRowState | undefined => states.byId[brandId];

describe("#4627 owned draft guard", () => {
  test("a teammate's draft stays visible but only Seth's own draft blocks creation", () => {
    const states = deriveBrandSetupStates(
      [
        { id: "alin", accountId: TEAM_OWNER_ID },
        { id: "seths-draft", accountId: SETH_ID },
      ],
      [draftChecklist(2), draftChecklist(1)],
      SETH_ID,
    );

    expect(stateFor(states, "alin")).toEqual({ kind: "draft", doneCount: 2 });
    expect(stateFor(states, "seths-draft")).toEqual({
      kind: "draft",
      doneCount: 1,
    });
    expect(states.draftId).toBe("seths-draft");
  });

  test("a team-admin-only draft cannot open the one-draft guard", () => {
    const states = deriveBrandSetupStates(
      [{ id: "nightlifefemzy", accountId: TEAM_OWNER_ID }],
      [draftChecklist()],
      SETH_ID,
    );

    expect(stateFor(states, "nightlifefemzy")).toEqual({
      kind: "draft",
      doneCount: 1,
    });
    expect(states.draftId).toBeNull();
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
