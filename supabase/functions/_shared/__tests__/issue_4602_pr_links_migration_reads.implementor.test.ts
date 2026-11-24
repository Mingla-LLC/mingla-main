// Issue #4602, found while closing #4490: the PR links check reads every changed migration's SQL to learn
// its capability keys. The per-run read budget is a named bound in lib.mjs; one
// initiative may land more than 50 migrations, and above the bound the check
// still fails closed instead of verifying a partial catalog.
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  changedMigrationReads,
  MAX_CHANGED_MIGRATION_READS,
} from "../../../../.github/scripts/release-records/lib.mjs";

const ROOT = new URL("../../../../", import.meta.url);

function migrations(count: number, status = "added") {
  return Array.from({ length: count }, (_, i) => ({
    filename: `supabase/migrations/2028120300${
      String(i).padStart(4, "0")
    }_m.sql`,
    status,
  }));
}

Deno.test("#4602 a PR with 79 changed migrations is read, not refused", () => {
  assertEquals(changedMigrationReads(migrations(79)).length, 79);
});

Deno.test("#4602 the read bound is 150 and the check fails closed above it", () => {
  assertEquals(MAX_CHANGED_MIGRATION_READS, 150);
  assertEquals(changedMigrationReads(migrations(150)).length, 150);
  assertThrows(
    () => changedMigrationReads(migrations(151)),
    Error,
    "too_many_changed_migrations",
  );
});

Deno.test("#4602 removed migrations, tests and other paths are not read", () => {
  const files = [
    ...migrations(2),
    ...migrations(3, "removed"),
    {
      filename: "supabase/migrations/__tests__/x.pg17.test.sql",
      status: "added",
    },
    { filename: "supabase/functions/x/index.ts", status: "modified" },
    { filename: "supabase/migrations/2028_x.sql", status: "modified" },
  ];
  assertEquals(changedMigrationReads(files).length, 3);
});

Deno.test("#4602 pr-links reads migrations through the bounded helper only", async () => {
  const src = await Deno.readTextFile(
    new URL(".github/scripts/release-records/pr-links.mjs", ROOT),
  );
  assertEquals(
    src.includes("const migrations = changedMigrationReads(files);"),
    true,
  );
  assertEquals(/migrations\.length\s*>\s*\d/.test(src), false);
});
