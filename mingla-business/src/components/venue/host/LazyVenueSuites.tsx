/**
 * #4490 — the venue page's two workspaces (the venue suite and the Stay
 * suite), loaded from the ONE Host venue owner (venueHostScreens.ts). Every
 * module they open lives in that owner too, so the classic modules and the
 * #4490 feature modules share their models, services and sheets inside one
 * chunk instead of the venue route's chunk plus the owner's (which hoisted
 * them into the eager web `__common` chunk).
 *
 * Same names and props as the shells, so `app/venue/[venueId]/index.tsx`
 * still mounts `<StaySuiteShell` / `<VenueSuiteShell` (#1424 pins those).
 * Import-light: the venue route imports this file.
 */
import type { StaySuiteShellProps } from "../../stay/StaySuiteShell";
import { createRetryableLazyErrorBoundary } from "../../ui/RetryableLazyBoundary";
import type { VenueSuiteShellProps } from "../VenueSuiteShell";
import { loadVenueHostScreens } from "./venueHostOwner";

export const VenueSuiteShell = createRetryableLazyErrorBoundary<VenueSuiteShellProps>(
  async () => ({ default: (await loadVenueHostScreens()).VenueSuiteShell }),
  { loadingLabel: "Loading your venue" },
);

export const StaySuiteShell = createRetryableLazyErrorBoundary<StaySuiteShellProps>(
  async () => ({ default: (await loadVenueHostScreens()).StaySuiteShell }),
  { loadingLabel: "Loading your stay" },
);
