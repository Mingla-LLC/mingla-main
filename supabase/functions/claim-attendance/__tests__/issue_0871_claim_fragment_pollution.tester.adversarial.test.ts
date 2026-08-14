// Independent tester regression for issue #871.
// The claim bearer must remain an exact, unambiguous five-field fragment on
// both the native ingress and the buyer-web handoff.
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAttendanceClaimUrl } from "../../../../app-mobile/src/utils/attendanceClaimDeepLink.ts";
import { attendanceAppUrlFromFragment } from "../../../../mingla-business/src/utils/attendanceClaimDeepLink.ts";

const eventId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const token = "A".repeat(43);
const exactFragment = new URLSearchParams({
  v: "1",
  kind: "order",
  event: eventId,
  source: sourceId,
  token,
}).toString();
const webPrefix = "https://host.usemingla.com/attendance/claim#";
const nativePrefix = "com.mingla.app.v2://attendance-claim#";

const assertRejectedEverywhere = (fragment: string): void => {
  assertEquals(
    parseAttendanceClaimUrl(`${webPrefix}${fragment}`),
    null,
    `native ingress accepted polluted web fragment: ${fragment}`,
  );
  assertEquals(
    parseAttendanceClaimUrl(`${nativePrefix}${fragment}`),
    null,
    `native ingress accepted polluted app fragment: ${fragment}`,
  );
  assertEquals(
    attendanceAppUrlFromFragment(fragment),
    null,
    `buyer handoff normalized polluted fragment: ${fragment}`,
  );
};

Deno.test("#871 TESTER: exact five-field claim fragments pass on both surfaces", () => {
  assertNotEquals(parseAttendanceClaimUrl(`${webPrefix}${exactFragment}`), null);
  assertNotEquals(parseAttendanceClaimUrl(`${nativePrefix}${exactFragment}`), null);
  assertNotEquals(attendanceAppUrlFromFragment(exactFragment), null);
});

Deno.test("#871 TESTER: duplicate recognized keys never become first-value-wins bearer pollution", () => {
  const duplicateValues: Record<string, string> = {
    v: "2",
    kind: "rsvp",
    event: "33333333-3333-4333-8333-333333333333",
    source: "44444444-4444-4444-8444-444444444444",
    token: "B".repeat(43),
  };
  for (const [key, value] of Object.entries(duplicateValues)) {
    assertRejectedEverywhere(`${exactFragment}&${key}=${value}`);
  }
});

Deno.test("#871 TESTER: missing, unknown, and query-carried bearers fail closed", () => {
  const exact = new URLSearchParams(exactFragment);
  for (const key of ["v", "kind", "event", "source", "token"]) {
    const missing = new URLSearchParams(exact);
    missing.delete(key);
    assertRejectedEverywhere(missing.toString());
  }

  assertRejectedEverywhere(`${exactFragment}&redirect=https%3A%2F%2Fevil.example`);
  assertRejectedEverywhere(exactFragment.replace(`token=${token}`, `token=${token.slice(1)}`));
  assertEquals(
    parseAttendanceClaimUrl(
      `https://host.usemingla.com/attendance/claim?${exactFragment}`,
    ),
    null,
  );
});
