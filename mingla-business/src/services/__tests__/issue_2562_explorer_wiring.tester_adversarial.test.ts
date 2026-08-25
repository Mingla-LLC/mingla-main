/**
 * issue #2562 [a past event was still purchasable] — the rule's DOWNSTREAM
 * EFFECT, executed.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR TEST. That one asserts what
 * `forwardableAcquisitionState` returns. This one asserts what that return
 * value DOES: it feeds `computeOfferingVariant`, which is the function every
 * surface asks for the buy button. A rule that returns the right object and a
 * CTA that still says "Buy ticket" would both be true at once if these two
 * functions ever disagreed — that gap is exactly what #2562 was.
 *
 * WHY IT COMPOSES THE SHARED PAIR RATHER THAN IMPORTING THE HOOK. Two earlier
 * versions of this file were rejected by gates that were right:
 *
 *   1. A source-text scan of `usePublicEventBySlug.ts` —
 *      I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN forbids source-only pins, and
 *      within the hour that scan failed on a CORRECT refactor because a nested
 *      paren appeared inside a regex that assumed none. It rotted precisely as
 *      the invariant predicts.
 *   2. Importing the consumer hook across the workspace boundary — that drags
 *      app-mobile's dependency tree (`@tanstack/react-query`, `expo-constants`,
 *      `@supabase/supabase-js`) into mingla-business's "Typecheck full graph"
 *      job, where none of them are installed. It also violates the hook's own
 *      I-MOR-0827-PACKAGE-ISOLATION header.
 *
 * The consumer hook's own call site is covered where it can be covered
 * honestly: `app-mobile/src/hooks/__tests__/issue_1929_hidden_direct_checkout.test.ts`,
 * whose lane triggers on `usePublicEventBySlug.ts` itself.
 *
 * FAILS ON REVERT: make the rule a pass-through and the fail-safe cases flip
 * from "still selling" to "past".
 */
import { describe, expect, test } from "@jest/globals";

import { computeOfferingVariant } from "@mingla/offering-rendering/offeringCta";
import { forwardableAcquisitionState } from "@mingla/offering-rendering/eventAcquisitionLifecycle";
import type { PublicEventProps } from "@mingla/offering-rendering/types";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ENDED = "2026-07-26T06:00:00.000Z"; // FIFA Grill Night, the real row
const FUTURE = "2026-08-30T19:00:00.000Z"; // We Go Again, still selling

/**
 * The event exactly as a client hands it to the CTA: one on-sale ticket, and
 * whatever acquisition state the forwarding rule produced. A tier that is
 * plainly buyable isolates the assertion to the past-event decision — without
 * it, a "published" result could be masked by sold-out or pre-sale logic.
 */
const eventWith = (
  status: string,
  masterEndAtUtc: string | null,
): PublicEventProps =>
  ({
    id: "event-1",
    name: "Test",
    status: "published",
    acquisitionState: forwardableAcquisitionState(status, masterEndAtUtc, NOW),
    tickets: [
      {
        id: "tt-1",
        name: "General",
        visibility: "public",
        isUnlimited: true,
        capacity: null,
        saleStartAt: null,
        saleEndAt: null,
        passwordProtected: false,
        availableAt: "both",
      },
    ],
  }) as unknown as PublicEventProps;

describe("issue #2562 — the forwarded state actually closes the buy path", () => {
  test("a finished event resolves to the PAST variant", () => {
    expect(computeOfferingVariant(eventWith("scheduled", ENDED), false)).toBe(
      "past",
    );
  });

  test("an event still ahead stays buyable — We Go Again keeps selling", () => {
    expect(
      computeOfferingVariant(eventWith("scheduled", FUTURE), false),
    ).not.toBe("past");
  });

  test("FAIL SAFE — a missing end time does NOT close a live event's sales", () => {
    // The resolver answers `unavailable` with no end time, and
    // `computeOfferingVariant` reads `unavailable` as past. If the rule ever
    // forwarded that raw, every event with a missing end time would stop
    // selling. Absence of data is not evidence of an ending.
    expect(computeOfferingVariant(eventWith("scheduled", null), false)).not.toBe(
      "past",
    );
  });

  test("FAIL SAFE — an unparseable end time does NOT close sales either", () => {
    expect(
      computeOfferingVariant(eventWith("scheduled", "not-a-date"), false),
    ).not.toBe("past");
  });

  test("a cancelled event resolves to CANCELLED, not past", () => {
    // The two render differently. Collapsing them would tell a guest an event
    // finished when it was called off.
    expect(computeOfferingVariant(eventWith("cancelled", FUTURE), false)).toBe(
      "cancelled",
    );
  });
});
