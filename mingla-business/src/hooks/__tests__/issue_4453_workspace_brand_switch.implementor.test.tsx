// MINGLA-INVARIANT: I-4453-SWITCH-NEVER-STRANDS-THE-BRAND | issue #4453 | A brand pick that moves the screen replaces the route (never pushes) and changes the current brand only once the route has become the screen it asked for; a screen whose leave guard stops the move keeps its brand, unsaved work holds the pick with a toast, and a brand the member cannot open for that screen opens its Home with a toast that says why.
/**
 * #4453 (contract section I) — what a pick in the brand switcher does.
 *
 * FAILS-ON-REVERT: apply the brand before the route moves (the old
 * `pickBrand(brand)` on press) and "a leave guard that stops the move keeps
 * the brand" fails; use `router.push` and "replaces, never pushes" fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_workspace_brand_switch.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos", role: "owner" };
const LANTERN = { id: "brand-lantern", displayName: "Lantern Room", role: "owner" };
const HELPING = { id: "brand-helping", displayName: "Helping Hands", role: "admin" };

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockPick = jest.fn();
let mockCurrentBrandId: string | null = GAMELAND.id;
let mockRole: { role: string | null } | Error = { role: "brand_owner" };
const mockFetchRole = jest.fn(async () => {
  if (mockRole instanceof Error) throw mockRole;
  return { ...mockRole, permissionsOverride: {}, accepted: true };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a), push: (...a: unknown[]) => mockPush(...a) }),
}));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("../usePickBrand", () => ({ usePickBrand: () => (b: unknown) => mockPick(b) }));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null }) => unknown) =>
    sel({ currentBrandId: mockCurrentBrandId }),
}));
jest.mock("../useCurrentBrandRole", () => ({
  brandRoleKeys: { byBrand: (brandId: string, userId: string) => ["brand-role", brandId, userId] },
  fetchCurrentBrandRole: () => mockFetchRole(),
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: { fetchQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn() },
}));

import { WorkspaceRouteContext, type WorkspaceRoute } from "../../components/brand/workspaceBrandContext";
import { resetToastStoreForTest, useToastStore } from "../../components/ui/toastStore";
import { brandIdFromRoute, type WorkspaceRouteParams } from "../../config/workspaceBrandRoutes";
import type { Brand } from "../../store/currentBrandStore";
import { registerUnsavedWork, resetUnsavedWorkForTest } from "../../utils/unsavedChangesGuard";
import {
  UNSAVED_WORK_HOLDS_SWITCH,
  hasPendingBrandSwitchForTest,
  resetPendingBrandSwitchForTest,
  settlePendingBrandSwitch,
  useWorkspaceBrandSwitch,
  type WorkspaceBrandSwitchOutcome,
} from "../useWorkspaceBrandSwitch";

const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => { unmount: () => void };
};

type Switch = (brand: Brand) => Promise<WorkspaceBrandSwitchOutcome>;

/** Mount the hook on a route (or outside any route) and hand back its function. */
async function mountOn(
  pathname: string | null,
  params: WorkspaceRouteParams = {},
  fromBrandId?: string,
): Promise<Switch> {
  let switchTo: Switch | null = null;
  const Probe = (): null => {
    switchTo = useWorkspaceBrandSwitch({ fromBrandId });
    return null;
  };
  const route: WorkspaceRoute = { pathname, params, routeBrandId: brandIdFromRoute(pathname, params) };
  await TestRenderer.act(async () => {
    TestRenderer.create(
      pathname === null ? (
        <Probe />
      ) : (
        <WorkspaceRouteContext.Provider value={route}>
          <Probe />
        </WorkspaceRouteContext.Provider>
      ),
    );
  });
  return switchTo as unknown as Switch;
}

const toasts = (): { kind: string; message: string }[] =>
  useToastStore.getState().toasts.map((t) => ({ kind: t.kind, message: t.message }));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockPick.mockClear();
  mockFetchRole.mockClear();
  mockCurrentBrandId = GAMELAND.id;
  mockRole = { role: "brand_owner" };
  resetPendingBrandSwitchForTest();
  resetUnsavedWorkForTest();
  resetToastStoreForTest();
});
afterEach(() => {
  resetPendingBrandSwitchForTest();
});

describe("#4453 a pick on a screen that follows the current brand", () => {
  test.each(["/home", "/marketing/campaigns", "/marketing/ads", "/hub/events", "/account"])(
    "%s: the brand changes at once and the screen stays",
    async (pathname) => {
      const switchTo = await mountOn(pathname);
      await expect(switchTo(LANTERN as Brand)).resolves.toBe("switched");
      expect(mockPick).toHaveBeenCalledTimes(1);
      expect(mockPick).toHaveBeenCalledWith(LANTERN);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(hasPendingBrandSwitchForTest()).toBe(false);
    },
  );

  test("outside any route (an isolated mount) a pick only changes the brand", async () => {
    const switchTo = await mountOn(null);
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("switched");
    expect(mockPick).toHaveBeenCalledWith(LANTERN);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("picking the brand you are on keeps it (and still saves it as the default)", async () => {
    const switchTo = await mountOn("/home");
    await expect(switchTo(GAMELAND as Brand)).resolves.toBe("unchanged");
    expect(mockPick).toHaveBeenCalledWith(GAMELAND);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("#4453 a pick on a brand-scoped screen", () => {
  test("website: replaces to the other brand's website; the brand changes when the route lands", async () => {
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website/pages`, { id: GAMELAND.id });
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("same-screen");
    // Replaces, never pushes: Back must not return to Gameland's website.
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(`/brand/${LANTERN.id}/website`);
    expect(mockPush).not.toHaveBeenCalled();
    // Not yet: the route has not moved.
    expect(mockPick).not.toHaveBeenCalled();
    settlePendingBrandSwitch(`/brand/${LANTERN.id}/website`);
    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(mockPick).toHaveBeenCalledWith(LANTERN);
    // Settling again does nothing: one switch, one write.
    settlePendingBrandSwitch(`/brand/${LANTERN.id}/website`);
    expect(mockPick).toHaveBeenCalledTimes(1);
  });

  test("the stale store does not hide the pick: Lantern Room in the store, Gameland on screen", async () => {
    mockCurrentBrandId = LANTERN.id;
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await switchTo(LANTERN as Brand);
    expect(mockReplace).toHaveBeenCalledWith(`/brand/${LANTERN.id}/website`);
  });

  test("an entity tail falls back to the section's list", async () => {
    const switchTo = await mountOn("/marketing/campaigns/cmp_1", { id: "cmp_1" });
    await switchTo(LANTERN as Brand);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/marketing/campaigns");
    expect(mockPick).not.toHaveBeenCalled();
    settlePendingBrandSwitch("/marketing/campaigns");
    expect(mockPick).toHaveBeenCalledWith(LANTERN);
  });

  test("a leave guard that stops the move keeps the brand", async () => {
    // The email composer's own guard (beforeRemove) declines the replace: the
    // pathname never changes, so the brand must not change under the draft.
    const switchTo = await mountOn("/marketing/campaigns/compose", { draft: "d_1" });
    await switchTo(LANTERN as Brand);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/marketing/campaigns");
    expect(mockPick).not.toHaveBeenCalled();
    expect(hasPendingBrandSwitchForTest()).toBe(true);
    // Later the host leaves for somewhere else entirely: the held pick is dropped.
    settlePendingBrandSwitch("/account");
    expect(mockPick).not.toHaveBeenCalled();
    expect(hasPendingBrandSwitchForTest()).toBe(false);
  });

  test("a target that forwards to its own child still lands", async () => {
    const switchTo = await mountOn("/event/ev_1", { id: "ev_1" });
    await switchTo(LANTERN as Brand);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/hub/events");
    settlePendingBrandSwitch("/hub/events/");
    expect(mockPick).toHaveBeenCalledWith(LANTERN);
  });

  test("a brand in the query: the same path, so the brand moves with the replace", async () => {
    const switchTo = await mountOn("/ari", { brandId: GAMELAND.id, sitesIntent: "edit" });
    await switchTo(LANTERN as Brand);
    expect(mockPick).toHaveBeenCalledWith(LANTERN);
    expect(mockReplace).toHaveBeenCalledWith(`/(tabs)/ari?brandId=${LANTERN.id}&sitesIntent=edit`);
    expect(hasPendingBrandSwitchForTest()).toBe(false);
  });

  test("a screen's own brandId wins over the store as the brand you are leaving", async () => {
    mockCurrentBrandId = LANTERN.id;
    const switchTo = await mountOn("/marketing/campaigns/cmp_1", {}, GAMELAND.id);
    await switchTo(LANTERN as Brand);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/marketing/campaigns");
  });

  test("a second pick replaces a pick that is still waiting", async () => {
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await switchTo(LANTERN as Brand);
    await switchTo(HELPING as Brand);
    settlePendingBrandSwitch(`/brand/${LANTERN.id}/website`);
    expect(mockPick).not.toHaveBeenCalled();
  });
});

describe("#4453 a brand the member cannot open for that screen", () => {
  test("an owned brand needs no role lookup", async () => {
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await switchTo(LANTERN as Brand);
    expect(mockFetchRole).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  test("a scanner at the other brand lands on its Home, and a toast says why", async () => {
    mockRole = { role: "scanner" };
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website/design`, { id: GAMELAND.id });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("home");
    expect(mockFetchRole).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    expect(toasts()).toEqual([
      {
        kind: "info",
        message: "Your role at Helping Hands doesn't include the website. You're on its Home instead.",
      },
    ]);
    settlePendingBrandSwitch("/home");
    expect(mockPick).toHaveBeenCalledWith(HELPING);
  });

  test("a marketing manager at the other brand keeps the website", async () => {
    mockRole = { role: "marketing_manager" };
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("same-screen");
    expect(mockReplace).toHaveBeenCalledWith(`/brand/${HELPING.id}/website`);
    expect(toasts()).toEqual([]);
  });

  test("a marketing manager cannot follow into the Hub", async () => {
    mockRole = { role: "marketing_manager" };
    const switchTo = await mountOn("/event/ev_1", { id: "ev_1" });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("home");
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    expect(toasts()[0]?.message).toBe(
      "Your role at Helping Hands doesn't include the Hub. You're on its Home instead.",
    );
  });

  test("someone no longer on the team lands on Home", async () => {
    mockRole = { role: null };
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("home");
  });

  test("a role lookup that fails opens the screen (it applies its own gate)", async () => {
    mockRole = new Error("offline");
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("same-screen");
    expect(mockReplace).toHaveBeenCalledWith(`/brand/${HELPING.id}/website`);
    expect(toasts()).toEqual([]);
  });

  test("a screen with no twin opens Home without a role lookup or a toast", async () => {
    const switchTo = await mountOn(`/brand/${GAMELAND.id}/setup`, { id: GAMELAND.id });
    await expect(switchTo(HELPING as Brand)).resolves.toBe("home");
    expect(mockFetchRole).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    expect(toasts()).toEqual([]);
  });
});

describe("#4453 unsaved work holds the switch", () => {
  test("a dirty screen keeps its brand and its route; the toast says why", async () => {
    const release = registerUnsavedWork();
    const switchTo = await mountOn("/experience/create");
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("held");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
    expect(toasts()).toEqual([{ kind: "warn", message: UNSAVED_WORK_HOLDS_SWITCH }]);
    // Saved or discarded: the next pick goes through.
    release();
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("same-screen");
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/hub/experiences");
  });

  test("it also holds a pick that would only change the brand under the screen", async () => {
    registerUnsavedWork();
    const switchTo = await mountOn("/home");
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("held");
    expect(mockPick).not.toHaveBeenCalled();
  });

  test("releasing twice does not unlock someone else's unsaved work", async () => {
    const first = registerUnsavedWork();
    registerUnsavedWork();
    first();
    first();
    const switchTo = await mountOn("/home");
    await expect(switchTo(LANTERN as Brand)).resolves.toBe("held");
  });
});
