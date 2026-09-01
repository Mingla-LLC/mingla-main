/**
 * A6 is ineffective if the browser route stops invoking the scrub helper.
 * Keep this integration boundary separate from the helper's behavioral proof.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "@jest/globals";

describe("issue #2979 attendance claim route fragment scrub integration", () => {
  test("reads the credential, scrubs through the helper, then parses the captured value", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/attendance/claim.tsx"),
      "utf8",
    );
    const effectStart = route.indexOf("useEffect(() => {");
    const effectEnd = route.indexOf("  }, []);", effectStart);

    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);

    const handoffEffect = route.slice(effectStart, effectEnd);
    const readIndex = handoffEffect.indexOf(
      'const raw = window.location.hash.replace(/^#/, "");',
    );
    const scrubIndex = handoffEffect.indexOf("scrubAttendanceClaimFragment(");
    const parseIndex = handoffEffect.indexOf(
      'void import("../../src/utils/attendanceClaimDeepLink")',
    );

    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(scrubIndex).toBeGreaterThan(readIndex);
    expect(parseIndex).toBeGreaterThan(scrubIndex);
    expect(handoffEffect).toMatch(
      /scrubAttendanceClaimFragment\(\s*window\.location,\s*window\.history,\s*window\.requestAnimationFrame\.bind\(window\),?\s*\);/,
    );
    expect(handoffEffect).not.toContain("window.history.replaceState");
  });
});
