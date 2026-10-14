/**
 * #3645 independent/adversarial Trip-cancel wiring proof.
 *
 * This source contract guards the route boundary that regressed: a published
 * Trip must use the canonical event cancellation transaction, while a draft
 * must keep using the draft-only soft delete. It also pins the failure and
 * focus behavior that is difficult to exercise in node through the native
 * Modal stack.
 *
 * Fails on revert: the old route only calls useSoftDeleteTrip, navigates away,
 * and reports failures in a toast.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = readFileSync(join(__dirname, "..", "index.tsx"), "utf8");

describe("#3645 real Trip cancellation", () => {
  it("separates draft deletion from scheduled/live cancellation", () => {
    expect(ROUTE).toContain("useSoftDeleteTrip()");
    expect(ROUTE).toContain("useCancelBusinessEvent()");
    expect(ROUTE).toMatch(
      /if \(trip\.status === "draft"\)[\s\S]*?softDeleteMutation\.mutateAsync[\s\S]*?return;[\s\S]*?await cancelMutation\.cancelEvent/,
    );
    expect(ROUTE).toContain("await tripQuery.refetch()");
  });

  it("keeps a successful published cancellation on the Trip screen", () => {
    const publishedBranch = ROUTE.match(
      /await cancelMutation\.cancelEvent[\s\S]*?message: cancelDoneToast\(cancelPaidOrderCount, "Trip"\),/,
    )?.[0] ?? "";
    expect(publishedBranch).not.toContain("router.back()");
    expect(publishedBranch).toContain("await tripQuery.refetch()");
  });

  it("keeps the dialog open with its approved error and focuses the safe action", () => {
    const failureBranch = ROUTE.match(
      /\} catch \{\s*setCancelError\(TRIP_CANCEL_ERROR\);\s*\} finally \{/,
    )?.[0] ?? "";
    expect(failureBranch).toContain("setCancelError(TRIP_CANCEL_ERROR)");
    expect(failureBranch).not.toContain("setCancelDialogVisible(false)");
    expect(ROUTE).toContain('const TRIP_CANCEL_ERROR = "Could not cancel trip. Try again."');
    expect(ROUTE).toContain('errorTestID="trip-dashboard-cancel-error"');
    expect(ROUTE).toContain('initialFocus="cancel"');
  });

  it("unmounts the manage menu before presenting the confirmation dialog", () => {
    expect(ROUTE).toMatch(/\{manageMenuVisible \? \([\s\S]*?<TripManageMenu/);
    expect(ROUTE).toMatch(
      /onCancelTrip=\{\(\) => \{[\s\S]*?setManageMenuVisible\(false\);[\s\S]*?handleCancelDialogOpen\(\);/,
    );
  });
});
