import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readOneSignalEventStreamTokenRing,
  verifyOneSignalEventStreamBearer,
} from "./oneSignalEventStreamAuth.ts";

const current = "A".repeat(43);
const previous = "B".repeat(64);

Deno.test("#1770 event bearer is bundle-only, rotating, bounded, and fail-closed", () => {
  const ring = readOneSignalEventStreamTokenRing(JSON.stringify({
    ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT: current,
    ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS: previous,
    UNRELATED_FIELD: "preserved",
  }));
  assertEquals(
    verifyOneSignalEventStreamBearer(`Bearer ${current}`, ring),
    true,
  );
  assertEquals(
    verifyOneSignalEventStreamBearer(`Bearer ${previous}`, ring),
    true,
  );
  assertEquals(verifyOneSignalEventStreamBearer("Bearer wrong", ring), false);
  assertThrows(() =>
    readOneSignalEventStreamTokenRing(
      JSON.stringify({ ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT: "short" }),
    )
  );
  Deno.env.set("ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT", current);
  assertThrows(() => readOneSignalEventStreamTokenRing("{}"));
  Deno.env.delete("ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT");
});
