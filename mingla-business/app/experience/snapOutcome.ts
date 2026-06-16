/**
 * ORCH-1150 — pure snap auto-draft outcome logic, extracted from snap.tsx so it
 * is unit-testable under the repo's node/ts-jest harness (the RN `.tsx` route
 * cannot be imported there — JSX isn't transformed for node). snap.tsx imports
 * these; the SPEC §9 jest contract asserts the navigate/toast/phase decision
 * here directly.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-1150_SNAP_AUTODRAFT_NAVIGATE.md §5
 */

export type SnapPhase = "idle" | "parsing" | "drafting";

export interface ConfirmAllTally {
  created: number;
  failed: number;
  firstError: string | null;
}

export interface SnapOutcome {
  navigate: boolean;
  toast: string;
  nextPhase: SnapPhase;
}

// SC-3 — honest created-N toast. The count is ALWAYS the real `tally.created`
// (never hardcoded); singular when exactly one draft landed.
export function createdToastText(created: number): string {
  const noun = created === 1 ? "draft experience" : "draft experiences";
  return `Created ${created} ${noun} — add stops, a date and price to publish.`;
}

/**
 * Pure decision from a confirmAll tally to (navigate? / toast / next phase).
 *  - created > 0  → navigate to drafts; created-N toast (+ honest partial note
 *                   when some failed). SC-1 / SC-5.
 *  - created == 0 → do NOT navigate; stay idle to re-snap; honest error toast
 *                   with the first failure message appended. SC-6.
 */
export function resolveSnapOutcome(
  tally: ConfirmAllTally,
  allFailedToast: string,
): SnapOutcome {
  if (tally.created > 0) {
    const base = createdToastText(tally.created);
    const toast =
      tally.failed > 0
        ? `Created ${tally.created} ${tally.created === 1 ? "draft" : "drafts"}; ${tally.failed} couldn't be created.`
        : base;
    return { navigate: true, toast, nextPhase: "drafting" };
  }
  const toast = tally.firstError
    ? `${allFailedToast} ${tally.firstError}`
    : allFailedToast;
  return { navigate: false, toast, nextPhase: "idle" };
}
