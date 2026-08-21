import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { resolveRelativeTime } from "../agentRelativeTime.ts";

Deno.test("#1985 tester: a nonexistent DST wall time stays unresolved and offers only real future instants", () => {
  const result = resolveRelativeTime("tomorrow at 2:30am", {
    now: new Date("2026-03-07T17:00:00.000Z"),
    timezone: "America/New_York",
    locale: "en-US",
  });

  assertEquals(result.invalidReason, "nonexistent_local_time");
  assertEquals(result.temporal, null);
  assertEquals(result.choices.length, 2);
  assertEquals(
    result.choices.map((choice) => choice.temporal.local_time),
    ["03:00", "03:30"],
  );
  for (const choice of result.choices) {
    assert(choice.temporal.resolved_iso);
    assert(
      new Date(choice.temporal.resolved_iso).getTime() >
        new Date("2026-03-07T17:00:00.000Z").getTime(),
    );
  }
});

Deno.test("#1985 tester: a repeated DST wall time exposes both offset-qualified choices", () => {
  const result = resolveRelativeTime("tomorrow at 1:30am", {
    now: new Date("2026-10-31T16:00:00.000Z"),
    timezone: "America/New_York",
    locale: "en-US",
  });

  assertEquals(result.temporal, null);
  assertEquals(result.choices.length, 2);
  assertEquals(
    result.choices.map((choice) => choice.temporal.resolved_iso),
    ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"],
  );
  assertMatch(result.choices[0].label, /\(-04:00\)$/);
  assertMatch(result.choices[1].label, /\(-05:00\)$/);
});
