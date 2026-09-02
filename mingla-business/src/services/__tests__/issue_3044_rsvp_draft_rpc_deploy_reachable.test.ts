/**
 * issue #3044 — every Postgres RPC `eventDrafts.ts` calls must exist in a
 * migration a plain `supabase db push` can actually reach.
 *
 * WHAT WENT WRONG
 * `createServerDraft` has called `business_create_rsvp_draft_graph` in shipped
 * client code since ORCH-1150, and that function does not exist in production.
 * It is not missing from the repo — `20270530001977_issue_1977_ari_rsvp_guest_
 * contribution.sql` defines it in full. It is missing from the DATABASE, because
 * that migration is version-shadowed: it was added to git on 2026-08-31
 * (110a80488, PR #2636) with the version `20270530001977`, by which time
 * `20270531002694` … `20270614002986` had already been applied. A migration
 * whose version sorts below the remote head is not applied by `db push`, and
 * `--include-all` is not a fix here — it would also sweep in the unrelated
 * unapplied `20270529002060` / `20270610002060`, and `20270530001977` would
 * abort anyway on its 120-row `ari_cert_capability_requirements` guard
 * (production holds 132).
 *
 * WHY NO EXISTING TEST CAUGHT IT
 * The SQL suites build their database from EVERY migration file in sort order,
 * so the shadowed definition is present in CI and every behavioural assertion
 * passes — while production has nothing. #1977's own `.test.sql` exercises this
 * exact RPC and is green. A runtime test in that lane structurally cannot see
 * this bug class; only a check on migration ORDERING can. That is this file.
 *
 * Companion runtime contract:
 * `supabase/migrations/__tests__/issue_3044_rsvp_draft_graph_deploy_reachable.test.sql`.
 *
 * fails-on-revert: deleting
 * `supabase/migrations/20270615003044_issue_3044_rsvp_draft_graph_deploy_reachable.sql`
 * leaves the three RSVP draft RPCs defined only by the shadowed
 * `20270530001977`, which turns the reachability assertions red.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const EVENT_DRAFTS = readFileSync(
  join(REPO_ROOT, "mingla-business", "src", "services", "eventDrafts.ts"),
  "utf8",
);

/**
 * The version that shipped the #1977 RSVP graph. Proven unreachable by
 * `supabase db push` — see the file header. Any definition that is to reach a
 * database through the normal deploy path must sort strictly after it.
 */
const SHADOWED_SOURCE_VERSION = "20270530001977";

/** The three RSVP draft owners `eventDrafts.ts` calls. */
const RSVP_DRAFT_RPCS = [
  "business_create_rsvp_draft_graph",
  "business_update_rsvp_graph",
  "business_discard_rsvp_draft",
] as const;

interface Migration {
  readonly version: string;
  readonly file: string;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((file) => ({
    version: file.split("_")[0],
    file,
    sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
  }));

/** Migrations that define `name` as a Postgres function, newest version last. */
function definersOf(name: string): readonly Migration[] {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`,
    "i",
  );
  return MIGRATIONS.filter((migration) => pattern.test(migration.sql));
}

/**
 * Every RPC name the drafts service passes to `supabase.rpc(...)`.
 *
 * The first argument is not always a bare literal — `discardServerDraft` picks
 * it with a ternary (`isRsvp ? "business_discard_rsvp_draft" :
 * "business_discard_event_draft"`), so this reads every string literal in the
 * first argument rather than only a literal glued to the paren.
 */
function rpcNamesCalledByEventDrafts(): readonly string[] {
  const names: string[] = [];
  for (const segment of EVENT_DRAFTS.split(".rpc(").slice(1)) {
    // The first argument ends where the params object begins.
    const firstArgument = segment.split("{")[0];
    for (const literal of firstArgument.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
      names.push(literal[1]);
    }
  }
  return [...new Set(names)].sort();
}

describe("issue #3044 — eventDrafts RPCs are deploy-reachable", () => {
  test("the migrations directory was actually read", () => {
    // Guard: an empty scan would make every assertion below vacuously true.
    expect(MIGRATIONS.length).toBeGreaterThan(400);
    expect(MIGRATIONS.every((migration) => /^\d{14}$/.test(migration.version))).toBe(true);
  });

  test("eventDrafts still routes RSVP drafts through the three graph owners", () => {
    const called = rpcNamesCalledByEventDrafts();
    for (const rpc of RSVP_DRAFT_RPCS) {
      expect(called).toContain(rpc);
    }
  });

  // #2596 — nothing in this repo checked that an RPC named in shipped client
  // code exists in a merged migration at all. This is that check, scoped to the
  // draft service where it cost us #3044.
  test.each(rpcNamesCalledByEventDrafts())(
    "%s is defined by at least one migration",
    (rpc) => {
      const definers = definersOf(rpc);
      expect(
        definers.length,
      ).toBeGreaterThan(0);
    },
  );

  test.each(RSVP_DRAFT_RPCS)(
    "%s has a definition a plain `supabase db push` can reach",
    (rpc) => {
      const definers = definersOf(rpc);
      expect(definers.map((migration) => migration.file)).toContain(
        "20270530001977_issue_1977_ari_rsvp_guest_contribution.sql",
      );

      const reachable = definers.filter(
        (migration) => migration.version > SHADOWED_SOURCE_VERSION,
      );
      // Deleting the #3044 migration leaves ONLY the shadowed #1977 definition,
      // which is exactly the production state issue #3044 reported.
      expect(
        reachable.map((migration) => migration.file),
      ).not.toHaveLength(0);
    },
  );

  test.each(RSVP_DRAFT_RPCS)(
    "%s carries the #3044 reachability marker on its reachable definition",
    (rpc) => {
      const reachable = definersOf(rpc).filter(
        (migration) => migration.version > SHADOWED_SOURCE_VERSION,
      );
      const marked = reachable.filter((migration) =>
        new RegExp(
          `COMMENT\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\s*\\([^)]*\\)\\s+IS\\b[^;]*#3044 db-push-reachable`,
          "i",
        ).test(migration.sql)
      );
      expect(marked.map((migration) => migration.file)).not.toHaveLength(0);
    },
  );

  test("the reachable #3044 migration sorts after every migration already applied in production", () => {
    // Probed read-only against gqnoajqerqhnvulmnyvv on 2026-09-02: the highest
    // stamped version in supabase_migrations.schema_migrations was
    // 20270614002986. The #3044 publish must sort after it or it inherits the
    // very defect it exists to fix.
    const PRODUCTION_HEAD_AT_FIX = "20270614002986";
    const reachable = definersOf("business_create_rsvp_draft_graph").filter(
      (migration) => migration.version > SHADOWED_SOURCE_VERSION,
    );
    expect(reachable.length).toBeGreaterThan(0);
    for (const migration of reachable) {
      expect(migration.version > PRODUCTION_HEAD_AT_FIX).toBe(true);
    }
  });

  test("the RSVP draft owners stay closed to anon on their reachable definition", () => {
    const reachable = definersOf("business_create_rsvp_draft_graph").filter(
      (migration) => migration.version > SHADOWED_SOURCE_VERSION,
    );
    // Without this the loop below examines nothing and reports a pass.
    expect(reachable.length).toBeGreaterThan(0);
    for (const migration of reachable) {
      for (const rpc of RSVP_DRAFT_RPCS) {
        expect(migration.sql).toMatch(
          new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon;`, "i"),
        );
        expect(migration.sql).toMatch(
          new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\([^)]*\\)\\s+TO\\s+authenticated,\\s*service_role;`, "i"),
        );
      }
    }
  });
});
