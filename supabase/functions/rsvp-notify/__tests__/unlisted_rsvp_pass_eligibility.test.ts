// Unlisted RSVP invite link — an approved guest of an UNLISTED RSVP gets the pass.
//
// fails-on-revert: put `event.visibility === "public"` back (drop "hidden" from
// RSVP_PASS_VISIBILITIES) and P-02 reds; admit "private" and P-03 reds; unwire the
// worker from the helper, or let the #871 attendance link share the widened pass
// gate, and P-06 reds. The real worker is exercised end to end in
// unlisted_rsvp_pass_delivery.runtime.test.ts.
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

Deno.test("P-06 the pass asks the helper; the #871 attendance link keeps its own public-only gate", async () => {
  const worker = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  // One named function body, from its signature to the first closing brace at
  // column 0. A rename or a moved body makes the slice empty and reds here.
  const body = (signature: string): string => {
    const at = worker.indexOf(signature);
    assert(at >= 0, `${signature} must exist in the worker`);
    const end = worker.indexOf("\n}\n", at);
    assert(end > at, `${signature} must have a body`);
    return worker.slice(at, end);
  };
  assert(
    worker.includes(
      'import { rsvpPassEventEligible } from "./passEligibility.ts";',
    ),
    "the worker must import the pass helper",
  );
  const pass = body("async function passStillEligible(");
  assert(
    pass.includes("if (!rsvpPassEventEligible(event, brand?.deleted_at)) return null;"),
    "passStillEligible must delegate the pass decision to rsvpPassEventEligible",
  );
  assert(
    !pass.includes('event.visibility === "public"'),
    "the pass decision itself must not be public-only",
  );
  assert(
    pass.includes(
      "return { attendanceClaim: attendanceClaimStillEligible(event, brand) };",
    ),
    "the attendance link decision must be made separately, on the same event row",
  );
  // #871: the attendance link is redeemable only through
  // claim_attendance_internal_v2, which admits public events only. Widening the
  // pass must not widen it. (Behaviour: unlisted_rsvp_pass_delivery.runtime R-01.)
  const attendance = body("function attendanceClaimStillEligible(");
  assert(
    attendance.includes('event.visibility === "public"') &&
      !attendance.includes("rsvpPassEventEligible") &&
      !attendance.includes('"hidden"'),
    "the attendance link gate must stay exactly public-only",
  );
  const link = body("async function recoveryLinkFor(");
  assert(
    link.includes(
      'if (table === "event_rsvps" && current?.event_id && attendanceClaimAllowed) {',
    ),
    "the attendance URL must only be built when that gate allows it",
  );
  assert(
    worker.includes(
      "? await recoveryLinkFor(admin, p, pass?.attendanceClaim === true)",
    ),
    "the worker must pass the attendance decision, not a constant",
  );
});
