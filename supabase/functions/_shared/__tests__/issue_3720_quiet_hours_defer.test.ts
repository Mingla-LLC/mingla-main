/**
 * #3720 Slice B — quiet-hours defer (not drop) contracts.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isQuietHours,
  LEGACY_QUIET_HOURS_CATEGORY,
  nextQuietHoursEnd,
} from "../quietHours.ts";

const dispatchSrc = Deno.readTextFileSync(
  new URL("../../notify-dispatch/index.ts", import.meta.url),
);
const drainSrc = Deno.readTextFileSync(
  new URL("../../notify-outbox-drain/index.ts", import.meta.url),
);
const migSrc = Deno.readTextFileSync(
  new URL(
    "../../../migrations/20271014003720_issue_3720_quiet_hours_outbox_defer.sql",
    import.meta.url,
  ),
);

Deno.test("#3720 quiet hours: 22:00 local is quiet; 10:00 is not (fixed Instant)", () => {
  // 2026-10-14 02:00 UTC = 22:00 America/New_York (EDT, UTC-4)
  const late = new Date("2026-10-14T02:00:00.000Z");
  assertEquals(isQuietHours("America/New_York", late), true);
  // 2026-10-14 14:00 UTC = 10:00 America/New_York
  const day = new Date("2026-10-14T14:00:00.000Z");
  assertEquals(isQuietHours("America/New_York", day), false);
});

Deno.test("#3720 nextQuietHoursEnd is after now when currently quiet", () => {
  const late = new Date("2026-10-14T02:00:00.000Z");
  const next = nextQuietHoursEnd("America/New_York", late);
  assert(new Date(next).getTime() > late.getTime());
});

Deno.test("#3720 notify-dispatch parks quiet hours on outbox (retryPending)", () => {
  assertStringIncludes(dispatchSrc, 'reason: "quiet_hours"');
  assertStringIncludes(dispatchSrc, "retryPending: true");
  assertStringIncludes(dispatchSrc, "next_attempt_at");
  assertStringIncludes(dispatchSrc, "LEGACY_QUIET_HOURS_CATEGORY");
  assertEquals(LEGACY_QUIET_HOURS_CATEGORY, "legacy_quiet_hours_push");
  assertStringIncludes(dispatchSrc, "quietHoursRetry");
  assertStringIncludes(dispatchSrc, "quietHoursRetry !== true");
});

Deno.test("#3720 notify-outbox-drain re-drives legacy_quiet_hours_push", () => {
  assertStringIncludes(drainSrc, "legacy_quiet_hours_push");
  assertStringIncludes(drainSrc, "quietHoursRetry: true");
  assertStringIncludes(drainSrc, 'status: "retry_wait"');
});

Deno.test("#3720 migration seeds category + claim reclaim of retry_wait", () => {
  assertStringIncludes(migSrc, "legacy_quiet_hours_push");
  assertStringIncludes(migSrc, "retry_wait");
  assertStringIncludes(migSrc, "next_attempt_at");
  assertStringIncludes(migSrc, "claim_notification_outbox");
});
