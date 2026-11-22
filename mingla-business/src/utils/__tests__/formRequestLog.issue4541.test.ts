/**
 * #4541 review fix A2: the delivery log reads the server's skipped-send reasons
 * in words. The server renamed `not_a_guest` to `not_current` (R1.4); rows
 * written before the rename keep the old code.
 *
 * FAILS-ON-REVERT: dropping `not_current` from FORM_REQUEST_LOG_COPY.reason
 * makes the line read "Not sent" with no reason; dropping `not_a_guest` breaks
 * older rows the same way.
 */

import { logLine } from "../formRequestLog";
import type { FormRequestLogRow } from "../../services/brandFormRequestService";

const row = (reason: string): FormRequestLogRow => ({
  id: "s1",
  kind: "remind",
  subjectKind: "rsvp",
  subjectId: "00000000-0000-4000-8000-000000000001",
  name: "Ada D.",
  channel: "email",
  status: "skipped",
  reason,
  notBefore: null,
  createdAt: "2028-03-01T10:00:00Z",
  settledAt: null,
});

describe("#4541 A2 skipped-send reasons", () => {
  it("not_current (the server's code since R1.4) reads 'no longer going'", () => {
    expect(logLine(row("not_current"))).toContain("Not sent (no longer going)");
  });

  it("not_a_guest on older rows still reads 'no longer going'", () => {
    expect(logLine(row("not_a_guest"))).toContain("Not sent (no longer going)");
  });
});
