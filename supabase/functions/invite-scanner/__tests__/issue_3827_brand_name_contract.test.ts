// issue #3827 — scanner invitations must query the canonical brands.name and
// events.title columns. Production has neither brands.display_name nor
// events.name; selecting either turns a valid invitation into a 500 before an
// invitation row is written.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const baseline = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260505000000_baseline_squash_orch_0729.sql",
    import.meta.url,
  ),
);

Deno.test("issue #3827 — invite-scanner reads the canonical brand name", () => {
  assertStringIncludes(source, '.from("brands")');
  assertStringIncludes(source, '.select("id, name")');
  assertStringIncludes(source, "brandRow.name");
  assert(
    !source.includes("brandRow.display_name") &&
      !source.includes('.select("id, display_name")'),
    "invite-scanner must not query the non-existent brands.display_name column",
  );
});

Deno.test("issue #3827 — invite-scanner reads the canonical event title", () => {
  assertStringIncludes(source, '.from("events")');
  assertStringIncludes(source, '.select("id, title, brand_id, deleted_at")');
  assertStringIncludes(source, "eventRow.title");
  assert(
    !source.includes("eventRow.name") &&
      !source.includes('.select("id, name, brand_id, deleted_at")'),
    "invite-scanner must not query the non-existent events.name column",
  );
});

Deno.test("issue #3827 — the invite query agrees with the replayed brands schema", () => {
  const match = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."brands" \([\s\S]*?\n\);/,
  );
  assert(match, "baseline brands table definition must exist");
  const columns = match[0];
  assertStringIncludes(columns, '"name" "text" NOT NULL');
  assertEquals(columns.includes('"display_name"'), false);
});

Deno.test("issue #3827 — the invite query agrees with the replayed events schema", () => {
  const match = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."events" \([\s\S]*?\n\);/,
  );
  assert(match, "baseline events table definition must exist");
  const columns = match[0];
  assertStringIncludes(columns, '"title" "text" NOT NULL');
  assertEquals(columns.includes('"name"'), false);
});
