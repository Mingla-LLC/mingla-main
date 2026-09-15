/* eslint-disable import/first */
/**
 * #1780 tester-owned auth-boundary proof.
 *
 * Real Supabase auth failures do not use the migration's wizard_invite_* SQL
 * messages. PostgREST reports an expired JWT with PGRST301; Edge returns a
 * FunctionsHttpError whose response owns the status/body. Both must normalize
 * to the same non-retryable auth state, while an Edge body that already carries
 * a wizard code must retain that code. Re-auth must complete AuthContext.signOut
 * (the cache/session purge) before navigating to the verified /auth route.
 */

import fs from "node:fs";
import path from "node:path";

const mockRpc = jest.fn();
const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("../peopleService", () => ({ listBrandPeople: jest.fn() }));
jest.mock("../marketing/manualGroupService", () => ({ listManualGroups: jest.fn() }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import {
  getWizardInvitePlan,
  quoteWizardInvitePlan,
} from "../offeringInvitePlanService";

const edgeError = (
  status: number,
  body: Record<string, unknown>,
  originalJson = jest.fn(),
  clonedJson = jest.fn(async () => body),
) => {
  const context = {
    status,
    json: originalJson,
    clone: jest.fn(() => ({ status, json: clonedJson })),
  };
  return {
    error: Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      { context },
    ),
    originalJson,
    clonedJson,
  };
};

describe("#1780 canonical auth recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("a real PostgREST expired JWT becomes non-retryable auth-required", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST301",
        message: "JWT expired",
        details: null,
        hint: null,
      },
    });
    await expect(getWizardInvitePlan("00000000-1780-4000-8000-000000000001"))
      .rejects.toMatchObject({
        name: "WizardInvitePlanError",
        code: "wizard_invite_auth_required",
        retryable: false,
      });
  });

  test("an Edge 401 body is decoded from a clone and becomes auth-required", async () => {
    const failure = edgeError(401,{ error: "unauthorized" });
    mockInvoke.mockResolvedValueOnce({ data: null, error: failure.error });
    await expect(quoteWizardInvitePlan(
      "00000000-1780-4000-8000-000000000001",3,
    )).rejects.toMatchObject({
      code: "wizard_invite_auth_required",
      retryable: false,
    });
    expect(failure.clonedJson).toHaveBeenCalledTimes(1);
    expect(failure.originalJson).not.toHaveBeenCalled();
  });

  test("Edge decoding preserves an existing definitive wizard error code", async () => {
    const failure = edgeError(409,{ error: "wizard_invite_feature_disabled" });
    mockInvoke.mockResolvedValueOnce({ data: null, error: failure.error });
    await expect(quoteWizardInvitePlan(
      "00000000-1780-4000-8000-000000000001",3,
    )).rejects.toMatchObject({
      code: "wizard_invite_feature_disabled",
      retryable: false,
    });
    expect(failure.clonedJson).toHaveBeenCalledTimes(1);
    expect(failure.originalJson).not.toHaveBeenCalled();
  });

  test("all four wizard integrations sign out before navigating to /auth", () => {
    const root = path.resolve(__dirname,"../../..");
    for (const relative of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
      "src/components/trip/TripCreatorWizard.tsx",
    ]) {
      const source = fs.readFileSync(path.join(root,relative),"utf8");
      expect(source).not.toMatch(
        /onReauthenticate=\{\(\)\s*=>\s*router\.replace\(["']\/["']\)\}/,
      );
      const handler = source.match(
        /onReauthenticate=\{async\s*\(\)\s*=>\s*\{([\s\S]*?)\}\}/,
      )?.[1] ?? "";
      const signOutAt = handler.search(/await\s+signOut\(\s*\)/);
      const authRouteAt = handler.search(/router\.replace\(["']\/auth(?:\?|["'])/);
      expect(signOutAt).toBeGreaterThanOrEqual(0);
      expect(authRouteAt).toBeGreaterThan(signOutAt);
    }
  });
});
