// META-ORCH-1009 Sub-E — lock the isUuid fix.
//
// ROOT CAUSE of every "brand_id must be a uuid" failure (2026-05-31): the regex
// had only 4 groups (8-4-4-12), missing the 4th `[0-9a-f]{4}-` group, so it
// rejected EVERY canonical UUID (8-4-4-4-12). This test fails on the old 4-group
// pattern and passes on the corrected 5-group one.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isUuid } from "../index.ts";

Deno.test("isUuid accepts the exact brand UUID that previously failed", () => {
  // The literal value the operator saw rejected on device.
  assertEquals(isUuid("3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0"), true);
});

Deno.test("isUuid accepts canonical lowercase + uppercase UUIDs", () => {
  assertEquals(isUuid("7fc38fd8-13e2-4af7-b191-09fd02ce7992"), true);
  assertEquals(isUuid("D27AAEA5-0A92-435F-9D40-B8CD38E3AC6E"), true);
});

Deno.test("isUuid rejects a 4-group string (the old broken shape) and non-uuids", () => {
  // 8-4-4-12 (the bug's own malformed shape) must NOT be accepted.
  assertEquals(isUuid("3c7ebebf-7249-45a2-c6b5ec319ec0"), false);
  assertEquals(isUuid("not-a-uuid"), false);
  assertEquals(isUuid(""), false);
  assertEquals(isUuid(1780282163345), false); // a number is never a uuid
  assertEquals(isUuid(null), false);
  assertEquals(isUuid(undefined), false);
});
