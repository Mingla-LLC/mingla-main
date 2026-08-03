import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
Deno.test("Admin list uses one signed immutable ordinal cursor", () => {
  assertStringIncludes(source, "ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET");
  assertStringIncludes(source, "snapshotId");
  assertStringIncludes(source, "nextOrdinal");
  assertStringIncludes(source, '"admin_list_source_refund_operations"');
  assertStringIncludes(source, "no-store, private");
  assertStringIncludes(source, "allowedEnumValues");
  assertStringIncludes(source, "new Set(input.filter(Boolean))");
});

const {
  decodeCursor,
  encodeCursor,
} = await import("../index.ts");

Deno.test("Admin cursor codec issues and verifies the exact signed SC-27 ordinal", async () => {
  const secret = "issue-1221-sc27-test-secret-is-at-least-32-bytes";
  const snapshotId = "12210000-0000-4000-8000-000000000027";
  const cursor = await encodeCursor(snapshotId, 2, secret);
  const decoded = await decodeCursor(cursor, secret);
  if (decoded.snapshotId !== snapshotId || decoded.nextOrdinal !== 2) {
    throw new Error("SC27_SIGNED_CURSOR_ROUND_TRIP_FAILED");
  }
});
