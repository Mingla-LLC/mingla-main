/**
 * ORCH-0850 [End-not-start parity systemic] — Hub card status mapper.
 *
 * Extracted to a sibling .ts file (not events.tsx) so the regression test
 * at `__tests__/events.pastTab.test.tsx` can import it without pulling the
 * full screen's React Native JSX through Jest's transform.
 *
 * Routes past/upcoming/live decisions through the canonical helper
 * `deriveLiveStatus + computeMasterStartAtUtc`. Pre-0850 the local copy in
 * `events.tsx` inlined `new Date(event.date).getTime()` which parsed
 * `YYYY-MM-DD` as UTC midnight — any US-Eastern event flipped to "past"
 * at 8pm EDT on its start day.
 *
 * The Hub bucket policy historically collapsed cancelled → past for the
 * Past pill counter; this wrapper preserves that mapping. The canonical
 * `deriveLiveStatus` returns "cancelled" as a distinct status because the
 * reconciliation route needs to surface it; the Hub doesn't.
 */

import { deriveLiveStatus } from "../../../src/utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../../src/utils/eventDateMath";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import type { EventCardStatus } from "../../../src/components/event/EventListCard";

export const deriveCardStatus = (event: LiveEvent): EventCardStatus => {
  const lifecycle = deriveLiveStatus(event, computeMasterStartAtUtc(event));
  return lifecycle === "cancelled" ? "past" : lifecycle;
};
