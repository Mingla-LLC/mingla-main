import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  classifyEntrySource,
  deriveReferrerHost,
} from "../../_shared/entrySource.ts";

Deno.test("#1421 shared classifier accepts only proven unpaid sources", () => {
  assertEquals(classifyEntrySource({ hasAdSignal: false, referrerHost: null }), "direct");
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "www.google.com" }),
    "search",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "l.instagram.com" }),
    "social",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "usemingla.com" }),
    "organic",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: true, referrerHost: "google.com" }),
    "ad",
  );
  assertEquals(
    classifyEntrySource({ hasAdSignal: false, referrerHost: "example.com" }),
    "unknown",
  );
});

Deno.test("#1421 classifier strips path/query and rejects lookalikes", () => {
  assertEquals(
    deriveReferrerHost("https://www.google.com/search?q=private"),
    "google.com",
  );
  assertEquals(
    classifyEntrySource({
      hasAdSignal: false,
      referrerHost: deriveReferrerHost("https://google.com.attacker.net/path"),
    }),
    "unknown",
  );
});
