// ORCH-0677 D-1: enforces I-CURATED-REVERSEANCHOR-NEEDS-COMBOS.
//
// Removing this gate re-opens the picnic-dates regression class (single-combo
// + reverseAnchor produces no fallback variety when an anchor fails the
// near-anchor companion fetch).
//
// Run: deno run --allow-read _lint_invariants.ts
// Wired into scripts/ci-check-invariants.sh; exit code 1 fails CI.

import { EXPERIENCE_TYPES } from './index.ts';

let failed = false;

for (const td of EXPERIENCE_TYPES) {
  const hasReverseAnchor = td.stops.some((s: any) => s.reverseAnchor);
  if (hasReverseAnchor && td.combos.length < 2) {
    console.error(
      `[I-CURATED-REVERSEANCHOR-NEEDS-COMBOS] ` +
        `Experience type "${td.id}" has reverseAnchor: true but only ${td.combos.length} combo(s). ` +
        `This shape was the cause of ORCH-0677 (picnic-dates dead-cycle). ` +
        `reverseAnchor + single combo = no fallback variety when an anchor fails.`,
    );
    failed = true;
  }
}

if (failed) {
  Deno.exit(1);
}

console.log(
  `I-CURATED-REVERSEANCHOR-NEEDS-COMBOS: ${EXPERIENCE_TYPES.length} typedef(s) checked, all pass.`,
);
