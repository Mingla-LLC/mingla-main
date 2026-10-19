import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-CATALOG-CONTENT | issue #3720 | Every catalog seed has a unique area-prefixed key, bounded customer wording, pinned static citations only, and no evidence capable of bypassing human promotion.
// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-STATIC-SEED-MONEY | issue #3720 | Money catalog rows contain pinned static evidence only and require later human-reviewed live proof before promotion.
// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-STATIC-SEED-HOST-OPERATIONS | issue #3720 | Host operations catalog rows contain pinned static evidence only and require later human-reviewed live proof before promotion.
// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-STATIC-SEED-EXPLORER | issue #3720 | Explorer catalog rows contain pinned static evidence only and require later human-reviewed live proof before promotion.
// MINGLA-INVARIANT: I-3720-FEATURE-GUIDE-STATIC-SEED-STAFF-HELP-WEBSITE | issue #3720 | Staff, help, and website catalog rows contain pinned static evidence only and require later human-reviewed live proof before promotion.

const MIGRATIONS = [
  "20271108023720_issue_3720_feature_guide_money.sql",
  "20271108033720_issue_3720_feature_guide_host_operations.sql",
  "20271108043720_issue_3720_feature_guide_explorer.sql",
  "20271108053720_issue_3720_feature_guide_staff_help_website.sql",
];
const ISSUE_3720_SEQUENCED_MIGRATIONS = [
  ...MIGRATIONS,
  "20271108063720_issue_3720_community_console_rebuild.sql",
  "20271108073720_issue_3720_host_help_support.sql",
  "20271108083720_issue_3720_feature_guide_weekly_drift.sql",
];
const ISSUE_3040_LAST_RESERVED_VERSION = "20271108013040";
const PINNED_URL = /^https:\/\/github\.com\/Mingla-LLC\/mingla-main\/(?:blob\/[0-9a-f]{40}\/.+|pull\/\d+|issues\/\d+#issuecomment-\d+|actions\/runs\/\d+)$/;
const ALLOWED_PREFIXES = new Set([
  "account", "discover", "social", "plus", "brand", "events", "rsvp",
  "experiences", "trips", "offerings", "venues", "stays", "checkout",
  "payouts", "money", "marketing", "ari", "sites", "plans", "programs",
  "help", "web", "staff",
]);
const EXISTING_KEYS = new Set([
  "official-brand-groups",
  "brand-files-and-guides",
  "product-inbox-avengers",
]);

type CatalogRow = {
  area: string;
  start_as: "live_candidate" | "check_flag" | "not_available_yet" | "removed";
  app_only: boolean;
  capability_key: string;
  title: string;
  outcome_summary: string;
  who_can_use: string[];
  surfaces: string[];
  how_to: string;
  limitations: string;
  support_wording: string;
  claimed_status: "live" | "planned" | "retired";
  required_evidence_kinds: string[];
  source_url: string;
  source_path: string;
  test_url: string | null;
  test_path: string | null;
  migration_url: string | null;
  migration_path: string | null;
};

async function readMigration(name: string) {
  return await Deno.readTextFile(new URL(`../${name}`, import.meta.url));
}

function parseCatalog(sql: string): CatalogRow[] {
  const match = sql.match(/\$catalog\$\n([\s\S]+?)\n\$catalog\$::jsonb/);
  assert(match, "migration must contain one parseable $catalog$ JSON block");
  return JSON.parse(match[1]) as CatalogRow[];
}

Deno.test("#3720 Feature Guide catalog content is bounded, pinned, and static-only", async () => {
  const sqlFiles = await Promise.all(MIGRATIONS.map(readMigration));
  const rows = sqlFiles.flatMap(parseCatalog);

  assertEquals(rows.length, 149);
  assertEquals(new Set(rows.map((row) => row.capability_key)).size, rows.length);

  for (const row of rows) {
    const prefix = row.capability_key.split("-")[0];
    assert(ALLOWED_PREFIXES.has(prefix), `${row.capability_key}: allowed area prefix`);
    assert(!EXISTING_KEYS.has(row.capability_key), `${row.capability_key}: existing seed untouched`);
    assertMatch(row.capability_key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(row.capability_key.length <= 80, `${row.capability_key}: key length`);
    assert(row.title.trim().length >= 4 && row.title.trim().length <= 160, `${row.capability_key}: title length`);
    assert(row.outcome_summary.trim().length >= 20 && row.outcome_summary.trim().length <= 1000, `${row.capability_key}: summary length`);
    assert(row.how_to.trim().length >= 20 && row.how_to.trim().length <= 4000, `${row.capability_key}: how-to length`);
    assert(row.limitations.trim().length >= 10 && row.limitations.trim().length <= 4000, `${row.capability_key}: limitations length`);
    assert(row.support_wording.trim().length >= 20 && row.support_wording.trim().length <= 4000, `${row.capability_key}: wording length`);
    assert(row.who_can_use.length >= 1 && row.who_can_use.length <= 20, `${row.capability_key}: audience count`);
    assert(row.surfaces.length >= 1 && row.surfaces.length <= 20, `${row.capability_key}: surface count`);

    const searchable = `${row.capability_key}\n${row.title}\n${row.outcome_summary}\n${row.support_wording}`.toLowerCase();
    assert(!searchable.includes("brand groups"), `${row.capability_key}: reserved Brand groups query`);
    assert(!searchable.includes("verified test"), `${row.capability_key}: reserved verified test query`);

    for (const url of [row.source_url, row.test_url, row.migration_url].filter(Boolean)) {
      assert(PINNED_URL.test(String(url)), `${row.capability_key}: pinned evidence URL ${url}`);
    }
    assert(row.source_url.includes(row.source_path), `${row.capability_key}: source path matches URL`);
    if (row.test_url) assert(row.test_url.includes(String(row.test_path)), `${row.capability_key}: test path matches URL`);
    if (row.migration_url) assert(row.migration_url.includes(String(row.migration_path)), `${row.capability_key}: migration path matches URL`);

    const required = new Set(row.required_evidence_kinds);
    assert(required.has("source"), `${row.capability_key}: source is always required`);
    if (row.start_as === "live_candidate" || row.start_as === "check_flag") {
      assertEquals(row.claimed_status, "live", `${row.capability_key}: claimed status`);
      assert(required.has("live_check"), `${row.capability_key}: live check required`);
      assert(required.has("release_record"), `${row.capability_key}: release record required`);
      if (row.test_url) assert(required.has("test"), `${row.capability_key}: discovered test required`);
      if (row.start_as === "check_flag") assert(required.has("feature_flag"), `${row.capability_key}: flag proof required`);
      if (row.app_only) assert(required.has("app_release"), `${row.capability_key}: app release required`);
    } else if (row.start_as === "not_available_yet") {
      assertEquals(row.claimed_status, "planned", `${row.capability_key}: planned mapping`);
    } else {
      assertEquals(row.claimed_status, "retired", `${row.capability_key}: retired mapping`);
    }
  }

  for (const sql of sqlFiles) {
    assertMatch(sql, /now\(\) \+ interval '90 days'/);
    const seededKinds = [...sql.matchAll(/SELECT capability_key, '([a-z_]+)'/g)].map((match) => match[1]);
    assertEquals(seededKinds, ["source", "test", "migration"]);
    assert(!/SELECT capability_key, '(?:live_check|release_record|deployment)'/.test(sql));
  }
});

Deno.test("#3720 migrations stay after the reserved #3040 migration lane", async () => {
  assertEquals(
    ISSUE_3720_SEQUENCED_MIGRATIONS,
    [...ISSUE_3720_SEQUENCED_MIGRATIONS].sort(),
  );

  for (const name of ISSUE_3720_SEQUENCED_MIGRATIONS) {
    const version = name.split("_", 1)[0];
    assert(
      version > ISSUE_3040_LAST_RESERVED_VERSION,
      `${name}: must sort after ${ISSUE_3040_LAST_RESERVED_VERSION}`,
    );
    await readMigration(name);
  }
});
