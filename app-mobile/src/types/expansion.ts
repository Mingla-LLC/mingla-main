// ORCH-0828: discriminated-union state for ExpandedCardModal.
//
// Replaces the prior dual-prop pattern (`card` and `businessEvent` passed
// in parallel with a runtime mutual-exclusion contract) that allowed
// state cross-contamination — see Bug B in
// `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md`.
//
// The union enforces mutual exclusion at the type-system layer: a target
// is either a Night Out (place / Ticketmaster) card OR a business event,
// never both. The compiler eliminates the bug class.
//
// New invariant: I-PROPOSED-EXPANSION-TARGET-UNION.

import type { ExpandedCardData } from "./expandedCardTypes";
import type { BusinessEventCard as BusinessEventCardData } from "./mergedDiscover";

export type ExpansionTarget =
  | { kind: "nightOut"; data: ExpandedCardData }
  | { kind: "businessEvent"; data: BusinessEventCardData };
