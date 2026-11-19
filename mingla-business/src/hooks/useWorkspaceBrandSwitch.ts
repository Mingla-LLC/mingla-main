/**
 * #4453 (contract section I) — the one way a brand switcher switches.
 *
 * Picking a brand on a brand-scoped screen opens the SAME screen for that
 * brand (`sameScreenForBrand`); on a screen that follows the current brand it
 * only changes the current brand. Used by the desktop popover
 * (WorkspaceBrandMenu) and by BrandSwitcherSheet, so every switcher in the
 * app behaves the same.
 *
 * Order of events when the screen changes:
 *   1. unsaved work on this screen holds the switch (a toast says why);
 *   2. a brand the member cannot open for that screen opens its Home, with a
 *      toast that says why;
 *   3. the route is REPLACED (no extra history entry) and the current brand
 *      changes only once the route has actually changed. A screen's own leave
 *      guard (`beforeRemove`) can still stop the move, and then the brand
 *      stays put too.
 */
import { useCallback } from "react";
import { useRouter } from "expo-router";

import { useWorkspaceRoute } from "../components/brand/workspaceBrandContext";
import { nextToastEntryId, useToastStore } from "../components/ui/toastStore";
import type { ToastKind } from "../components/ui/toastTimings";
import {
  WORKSPACE_BRAND_HOME,
  canOpenWorkspaceScreen,
  sameScreenForBrand,
  workspaceFallbackMessage,
  workspaceRoutePath,
} from "../config/workspaceBrandRoutes";
import { useAuth } from "../context/AuthContext";
import { useCurrentBrandStore, type Brand } from "../store/currentBrandStore";
import { hasUnsavedWork } from "../utils/unsavedChangesGuard";
import { usePickBrand } from "./usePickBrand";

export const UNSAVED_WORK_HOLDS_SWITCH =
  "You have changes that aren't saved. Save or discard them, then switch brand.";

/** How long a role lookup may hold a switch before the screen is opened anyway. */
export const ROLE_LOOKUP_BUDGET_MS = 4000;
const ROLE_STALE_MS = 30 * 1000;
const OWNER_RANK = 60;

/** A toast that outlives the screen that raised it (the route is about to change). */
export function showWorkspaceToast(kind: ToastKind, message: string): void {
  const id = nextToastEntryId();
  useToastStore.getState().upsert({
    id,
    kind,
    message,
    onDismiss: () => useToastStore.getState().remove(id),
    testID: "workspace-brand-toast",
  });
}

import { holdPendingBrandSwitch } from "./pendingBrandSwitch";

export {
  hasPendingBrandSwitchForTest,
  resetPendingBrandSwitchForTest,
  settlePendingBrandSwitch,
} from "./pendingBrandSwitch";

/**
 * The member's role rank on a brand they are about to switch to. A brand they
 * own answers at once; any other costs one cached read. `null` = could not
 * tell in time (the screen then opens and applies its own gate).
 */
export async function resolveBrandRank(
  brand: Pick<Brand, "id" | "role">,
  userId: string | null,
): Promise<number | null> {
  if (brand.role === "owner") return OWNER_RANK;
  if (userId === null) return null;
  try {
    const [{ queryClient }, roles, { BRAND_ROLE_RANK, NO_MEMBERSHIP_RANK }] = await Promise.all([
      import("../config/queryClient"),
      import("./useCurrentBrandRole"),
      import("../utils/brandRole"),
    ]);
    const lookup = queryClient.fetchQuery({
      queryKey: roles.brandRoleKeys.byBrand(brand.id, userId),
      queryFn: () => roles.fetchCurrentBrandRole(brand.id, userId),
      staleTime: ROLE_STALE_MS,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ROLE_LOOKUP_BUDGET_MS);
    });
    const result = await Promise.race([lookup, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (result === null) return null;
    return result.role !== null ? BRAND_ROLE_RANK[result.role] : NO_MEMBERSHIP_RANK;
  } catch {
    return null;
  }
}

export type WorkspaceBrandSwitchOutcome =
  | "unchanged"
  | "held"
  | "switched"
  | "same-screen"
  | "home";

export interface WorkspaceBrandSwitchOptions {
  /** The brand shown as current (a screen's own `brandId`), when not the route's. */
  fromBrandId?: string | null;
  /**
   * The caller's own `usePickBrand(...)` (BrandSwitcherSheet reports a failed
   * default-brand save to its host). Default: the hook's own, with no report.
   */
  pickBrand?: (brand: Brand) => void;
}

export function useWorkspaceBrandSwitch(
  options: WorkspaceBrandSwitchOptions = {},
): (brand: Brand) => Promise<WorkspaceBrandSwitchOutcome> {
  const { fromBrandId } = options;
  const route = useWorkspaceRoute();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const ownPickBrand = usePickBrand();
  const pickBrand = options.pickBrand ?? ownPickBrand;
  const { pathname, params, routeBrandId } = route;

  return useCallback(
    async (brand: Brand): Promise<WorkspaceBrandSwitchOutcome> => {
      holdPendingBrandSwitch(null);
      const from = fromBrandId ?? routeBrandId ?? currentBrandId ?? null;
      const sameScreen =
        pathname === null ? null : sameScreenForBrand(pathname, params, from, brand.id);
      if (sameScreen === null) {
        const unchanged = from === brand.id && currentBrandId === brand.id;
        if (!unchanged && hasUnsavedWork()) {
          showWorkspaceToast("warn", UNSAVED_WORK_HOLDS_SWITCH);
          return "held";
        }
        // Picking the brand you are on still saves it as your default.
        pickBrand(brand);
        return unchanged ? "unchanged" : "switched";
      }
      if (hasUnsavedWork()) {
        showWorkspaceToast("warn", UNSAVED_WORK_HOLDS_SWITCH);
        return "held";
      }

      let href = sameScreen;
      let outcome: WorkspaceBrandSwitchOutcome = "same-screen";
      if (workspaceRoutePath(href) !== workspaceRoutePath(WORKSPACE_BRAND_HOME)) {
        const rank = await resolveBrandRank(brand, userId);
        if (rank !== null && !canOpenWorkspaceScreen(href, rank)) {
          showWorkspaceToast("info", workspaceFallbackMessage(brand.displayName, href));
          href = WORKSPACE_BRAND_HOME;
          outcome = "home";
        }
      } else {
        outcome = "home";
      }

      const targetPath = workspaceRoutePath(href);
      if (targetPath === workspaceRoutePath(pathname)) {
        // Same path, another brand in the query: nothing can hold this move.
        pickBrand(brand);
      } else {
        holdPendingBrandSwitch({ targetPath, apply: () => pickBrand(brand) });
      }
      router.replace(href as never);
      return outcome;
    },
    [currentBrandId, fromBrandId, params, pathname, pickBrand, routeBrandId, router, userId],
  );
}
