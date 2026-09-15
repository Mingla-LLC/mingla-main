// Unlisted RSVP invite link — an approved guest of an UNLISTED RSVP gets the pass.
//
// fails-on-revert: put `event.visibility === "public"` back (drop "hidden" from
// RSVP_PASS_VISIBILITIES) and P-02 reds; admit "private" and P-03 reds; unwire the
// worker from the helper and P-06 reds.
import {
  RSVP_PASS_VISIBILITIES,
  rsvpPassEventEligible,
} from "../passEligibility.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const live = {
  status: "scheduled",
  visibility: "public",
  deleted_at: null,
  event_type: "rsvp",
};

Deno.test("P-01 a public, scheduled RSVP stays eligible", () => {
  assert(rsvpPassEventEligible(live, null), "public RSVP must stay eligible");
  assert(
    rsvpPassEventEligible({ ...live, status: "live" }, null),
    "live RSVP must stay eligible",
  );
});

Deno.test("P-02 an unlisted (hidden) RSVP is eligible", () => {
  assert(
    rsvpPassEventEligible({ ...live, visibility: "hidden" }, null),
    "an approved guest of an unlisted RSVP must receive the pass",
  );
});

Deno.test("P-03 a private RSVP, or any other visibility, is not", () => {
  for (const visibility of ["private", "draft", "", null, undefined]) {
    assert(
      !rsvpPassEventEligible({ ...live, visibility }, null),
      `visibility ${String(visibility)} must not be eligible`,
    );
  }
  assert(
    RSVP_PASS_VISIBILITIES.length === 2 &&
      RSVP_PASS_VISIBILITIES.includes("public") &&
      RSVP_PASS_VISIBILITIES.includes("hidden"),
    "the eligible set is exactly public + hidden",
  );
});

Deno.test("P-04 everything else is unchanged: deleted, deleted brand, not RSVP, not upcoming", () => {
  const hidden = { ...live, visibility: "hidden" };
  assert(!rsvpPassEventEligible(null, null), "missing event");
  assert(
    !rsvpPassEventEligible(
      { ...hidden, deleted_at: "2026-09-15T00:00:00Z" },
      null,
    ),
    "deleted event",
  );
  assert(
    !rsvpPassEventEligible(hidden, "2026-09-15T00:00:00Z"),
    "deleted brand",
  );
  assert(!rsvpPassEventEligible(hidden, undefined), "brand not read");
  assert(
    !rsvpPassEventEligible({ ...hidden, event_type: "event" }, null),
    "ticketed event",
  );
  for (const status of ["draft", "ended", "cancelled"]) {
    assert(
      !rsvpPassEventEligible({ ...hidden, status }, null),
      `status ${status}`,
    );
  }
});

Deno.test("P-06 the worker asks the helper instead of its own public-only check", async () => {
  const worker = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(
    worker.includes(
      'import { rsvpPassEventEligible } from "./passEligibility.ts";',
    ) &&
      worker.includes(
        "return rsvpPassEventEligible(event, brand?.deleted_at);",
      ),
    "passStillEligible must delegate to rsvpPassEventEligible",
  );
  assert(
    !worker.includes('event.visibility === "public"'),
    "the public-only check must be gone",
  );
});
