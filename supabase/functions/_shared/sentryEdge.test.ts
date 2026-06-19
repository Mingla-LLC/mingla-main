import { __parseDsnForTest } from "./sentryEdge.ts";
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("parseDsn extracts host, key, and project id", () => {
  const parsed = __parseDsnForTest(
    "https://abc123@o4511136062701568.ingest.us.sentry.io/4511334517243904",
  );
  assertEquals(parsed?.publicKey, "abc123");
  assertEquals(parsed?.host, "o4511136062701568.ingest.us.sentry.io");
  assertEquals(parsed?.projectId, "4511334517243904");
});

Deno.test("parseDsn returns null for invalid dsn", () => {
  assertEquals(__parseDsnForTest("not-a-dsn"), null);
});
