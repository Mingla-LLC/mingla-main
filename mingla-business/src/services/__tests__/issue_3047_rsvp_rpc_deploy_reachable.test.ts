/**
 * issue #3047 — the rest of the #1977 RSVP surface must be deploy-reachable,
 * and a terminal RPC failure must never render as silence.
 *
 * WHAT WENT WRONG
 * Seven routines defined by
 * `20270530001977_issue_1977_ari_rsvp_guest_contribution.sql` do not exist in
 * production. Three have live shipped callers:
 *
 *   business_publish_rsvp_graph      rsvpEvents.publishRsvpDraft
 *   business_set_rsvp_guest_status   rsvpApprovals ×2, guestRosterService ×1
 *   ari_execute_rsvp_operation       the whole Ari RSVP tool surface
 *
 * They are not missing from the repo — that migration defines all fifteen in
 * full. They are missing from the DATABASE, because the migration is
 * VERSION-SHADOWED: it entered git on 2026-08-31 carrying version
 * `20270530001977`, by which time `20270531002694` … `20270614002986` were
 * already applied. A migration whose version sorts below the remote head is
 * never applied by `db push`, and `--include-all` is not a fix — it would sweep
 * in the unrelated unapplied `20270529002060` / `20270610002060`, and
 * `20270530001977` aborts anyway on its 120-row
 * `ari_cert_capability_requirements` guard (production holds 132).
 *
 * WHY NO EXISTING TEST CAUGHT IT
 * The SQL suites build their database from EVERY migration file in sort order,
 * so the shadowed definitions are present in CI and every behavioural assertion
 * passes — while production has none of them. #1977's own `.test.sql` calls
 * `business_set_rsvp_guest_status` directly and is green. A runtime test in that
 * lane structurally CANNOT see this bug class, because the lane's database
 * always contains the file. Only a check on migration ORDERING can. That is the
 * first half of this file.
 *
 * The second half covers the defect that made the first one invisible to the
 * organiser: a `404` came back and the app showed nothing at all.
 *
 * Companion runtime contract:
 * `supabase/migrations/__tests__/issue_3047_rsvp_publish_deploy_reachable.test.sql`.
 *
 * fails-on-revert: deleting
 * `supabase/migrations/20270616003047_issue_3047_rsvp_publish_guest_ari_deploy_reachable.sql`
 * leaves all seven routines defined only by the shadowed `20270530001977`,
 * which turns every reachability assertion below red.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  RsvpRpcError,
  isMissingRpcFailure,
  isRetryableRsvpRpcFailure,
  readRpcFailureCode,
  readRpcFailureMessage,
  rsvpRpcFailureCopy,
} from "../rsvpRpcFailure";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const readRepoFile = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), "utf8");

/**
 * The version that shipped the #1977 RSVP surface. Proven unreachable by
 * `supabase db push`. Any definition that is to reach a database through the
 * normal deploy path must sort strictly after it.
 */
const SHADOWED_SOURCE_VERSION = "20270530001977";

/**
 * Probed read-only against `gqnoajqerqhnvulmnyvv`: `20270615003044` (#3044) is
 * the highest version stamped in `supabase_migrations.schema_migrations`. The
 * #3047 publish must sort after it or it inherits the very defect it fixes.
 */
const PRODUCTION_HEAD_AT_FIX = "20270615003044";

/** Every routine #3047 re-publishes, with the caller that proves it matters. */
const RSVP_RPCS_WITH_LIVE_CALLERS = [
  "business_publish_rsvp_graph",
  "business_set_rsvp_guest_status",
  "ari_execute_rsvp_operation",
] as const;

const RSVP_RPCS_WITHOUT_LIVE_CALLERS = [
  "business_list_rsvp_roster",
  "business_list_rsvp_contributions",
  "issue_1977_agent_rsvp_payload",
  "issue_1977_current_rsvp_publish_payload",
] as const;

const ALL_RSVP_RPCS = [
  ...RSVP_RPCS_WITH_LIVE_CALLERS,
  ...RSVP_RPCS_WITHOUT_LIVE_CALLERS,
] as const;

/**
 * The routines #3047 GRANTs to a client role. The two `issue_1977_*` payload
 * helpers are deliberately REVOKEd and never GRANTed — they are reached only
 * from inside SECURITY DEFINER bodies, which run as the owner. #1977 declares
 * exactly this asymmetry and it is copied rather than tidied.
 */
const GRANTED_RSVP_RPCS = [
  "business_publish_rsvp_graph",
  "business_set_rsvp_guest_status",
  "ari_execute_rsvp_operation",
  "business_list_rsvp_roster",
  "business_list_rsvp_contributions",
] as const;

const UNGRANTED_RSVP_RPCS = [
  "issue_1977_agent_rsvp_payload",
  "issue_1977_current_rsvp_publish_payload",
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

/** Migrations that define `name` as a Postgres function. */
function definersOf(name: string): readonly Migration[] {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`,
    "i",
  );
  return MIGRATIONS.filter((migration) => pattern.test(migration.sql));
}

function reachableDefinersOf(name: string): readonly Migration[] {
  return definersOf(name).filter(
    (migration) => migration.version > SHADOWED_SOURCE_VERSION,
  );
}

/**
 * Every RPC name a source file passes to `supabase.rpc(...)` / `.rpc(...)`.
 *
 * Reads every string literal in the FIRST argument rather than only a literal
 * glued to the paren, because a call site may pick its name with a ternary.
 * (#3044 shipped a `rpc(\s*"name"` regex that silently missed exactly that.)
 */
function rpcNamesCalledIn(source: string): readonly string[] {
  const names: string[] = [];
  for (const segment of source.split(".rpc(").slice(1)) {
    const firstArgument = segment.split("{")[0];
    for (const literal of firstArgument.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
      names.push(literal[1]);
    }
  }
  return [...new Set(names)].sort();
}

/** The shipped client + edge files that name the RSVP routines this issue fixes. */
const CALLER_FILES: ReadonlyArray<readonly [string, string]> = [
  [
    "mingla-business/src/services/rsvpEvents.ts",
    readRepoFile("mingla-business", "src", "services", "rsvpEvents.ts"),
  ],
  [
    "mingla-business/src/services/rsvpApprovals.ts",
    readRepoFile("mingla-business", "src", "services", "rsvpApprovals.ts"),
  ],
  [
    "mingla-business/src/services/guestRosterService.ts",
    readRepoFile("mingla-business", "src", "services", "guestRosterService.ts"),
  ],
  [
    "supabase/functions/_shared/agentDomainTools.ts",
    readRepoFile("supabase", "functions", "_shared", "agentDomainTools.ts"),
  ],
  [
    "supabase/functions/rsvp-contribution-refund/index.ts",
    readRepoFile("supabase", "functions", "rsvp-contribution-refund", "index.ts"),
  ],
];

describe("issue #3047 — the RSVP publish / guest-status / Ari RPCs are deploy-reachable", () => {
  test("the migrations directory was actually read", () => {
    // Guard: an empty scan would make every assertion below vacuously true.
    // A zero needs its denominator.
    expect(MIGRATIONS.length).toBeGreaterThan(400);
    expect(
      MIGRATIONS.every((migration) => /^\d{14}$/.test(migration.version)),
    ).toBe(true);
  });

  test("the caller files were actually read", () => {
    expect(CALLER_FILES).toHaveLength(5);
    for (const [path, source] of CALLER_FILES) {
      expect(`${path}:${source.length > 200}`).toBe(`${path}:true`);
    }
  });

  test("the three live-caller RPCs are still named in shipped code", () => {
    const called = new Set(
      CALLER_FILES.flatMap(([, source]) => rpcNamesCalledIn(source)),
    );
    for (const rpc of RSVP_RPCS_WITH_LIVE_CALLERS) {
      expect([...called]).toContain(rpc);
    }
  });

  // #2596 — nothing in this repo checked that an RPC named in shipped client
  // code exists in a merged migration at all. This is that check, widened from
  // #3044's single file to every file that calls an RSVP routine.
  test.each(
    CALLER_FILES.flatMap(([path, source]) =>
      rpcNamesCalledIn(source).map((rpc) => [path, rpc] as const),
    ),
  )("%s calls %s, which some migration must define", (_path, rpc) => {
    expect(definersOf(rpc).length).toBeGreaterThan(0);
  });

  test.each(ALL_RSVP_RPCS)(
    "%s has a definition a plain `supabase db push` can reach",
    (rpc) => {
      // It must still be defined by the shadowed source — if that stops being
      // true the premise of this whole file has changed and someone should
      // re-derive it rather than trust a green run.
      expect(definersOf(rpc).map((migration) => migration.file)).toContain(
        "20270530001977_issue_1977_ari_rsvp_guest_contribution.sql",
      );
      // Deleting the #3047 migration leaves ONLY the shadowed definition, which
      // is exactly the production state this issue reported.
      expect(reachableDefinersOf(rpc).map((m) => m.file)).not.toHaveLength(0);
    },
  );

  test.each(ALL_RSVP_RPCS)(
    "%s carries the #3047 reachability marker on its reachable definition",
    (rpc) => {
      const marked = reachableDefinersOf(rpc).filter((migration) =>
        new RegExp(
          `COMMENT\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\s*\\([^)]*\\)\\s+IS\\b[^;]*#3047 db-push-reachable`,
          "i",
        ).test(migration.sql),
      );
      expect(marked.map((migration) => migration.file)).not.toHaveLength(0);
    },
  );

  test.each(ALL_RSVP_RPCS)(
    "%s's reachable definition sorts after everything already applied in production",
    (rpc) => {
      const reachable = reachableDefinersOf(rpc);
      expect(reachable.length).toBeGreaterThan(0);
      for (const migration of reachable) {
        expect(`${rpc}:${migration.version > PRODUCTION_HEAD_AT_FIX}`).toBe(
          `${rpc}:true`,
        );
      }
    },
  );

  test.each(ALL_RSVP_RPCS)("%s stays closed to anon", (rpc) => {
    const reachable = reachableDefinersOf(rpc);
    // Without this the loop below examines nothing and reports a pass.
    expect(reachable.length).toBeGreaterThan(0);
    const revoking = reachable.filter((migration) =>
      new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon;`,
        "i",
      ).test(migration.sql),
    );
    expect(revoking.map((m) => m.file)).not.toHaveLength(0);
  });

  test.each(GRANTED_RSVP_RPCS)(
    "%s grants EXECUTE to authenticated and service_role",
    (rpc) => {
      const granting = reachableDefinersOf(rpc).filter((migration) =>
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\([^)]*\\)\\s+TO\\s+authenticated,\\s*service_role;`,
          "i",
        ).test(migration.sql),
      );
      expect(granting.map((m) => m.file)).not.toHaveLength(0);
    },
  );

  test.each(UNGRANTED_RSVP_RPCS)(
    "%s is revoked and never granted, matching what #1977 declares",
    (rpc) => {
      const reachable = reachableDefinersOf(rpc);
      expect(reachable.length).toBeGreaterThan(0);
      for (const migration of reachable) {
        expect(
          new RegExp(
            `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\(`,
            "i",
          ).test(migration.sql),
        ).toBe(false);
      }
    },
  );

  test("the #3047 migration wraps its own transaction", () => {
    // The Management API `/database/query` endpoint does NOT wrap a
    // multi-statement body. An unwrapped file applies NON-ATOMICALLY, which on
    // a partial failure would leave production holding some of the seven and
    // not others — a worse state than the one being repaired.
    const migration = reachableDefinersOf("business_publish_rsvp_graph").find(
      (m) => m.version > PRODUCTION_HEAD_AT_FIX,
    );
    expect(migration).toBeDefined();
    const sql = migration?.sql ?? "";
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql.indexOf("\nBEGIN;")).toBeLessThan(sql.indexOf("\nCOMMIT;"));
  });

  test("all seven routines ship in ONE migration, so no second set is stranded", () => {
    const files = ALL_RSVP_RPCS.map(
      (rpc) =>
        reachableDefinersOf(rpc)
          .filter((m) => m.version > PRODUCTION_HEAD_AT_FIX)
          .map((m) => m.file)
          .sort()
          .join(","),
    );
    expect(new Set(files).size).toBe(1);
    expect(files[0]).toContain("20270616003047");
  });
});

describe("issue #3047 — a terminal RPC failure never renders as silence", () => {
  // The PostgREST body for a missing RPC, verbatim in shape. supabase-js
  // resolves `{ data: null, error: <this> }` — a PLAIN OBJECT, not an Error.
  const POSTGREST_404 = {
    code: "PGRST202",
    details:
      "Searched for the function public.business_publish_rsvp_graph with parameters p_client_request_id, p_event_id",
    hint: null,
    message:
      "Could not find the function public.business_publish_rsvp_graph(p_client_request_id, p_event_id) in the schema cache",
  };

  test("readRpcFailureMessage never produces [object Object]", () => {
    // This is the whole reason the organiser saw nothing: the shipped reader was
    // `error instanceof Error ? error.message : String(error)`, and
    // String(POSTGREST_404) is the literal "[object Object]". No guard reason
    // could match it, so the generic branch was the only one reachable.
    expect(String(POSTGREST_404)).toBe("[object Object]");
    expect(readRpcFailureMessage(POSTGREST_404)).toContain(
      "Could not find the function",
    );
    expect(readRpcFailureMessage(POSTGREST_404)).not.toContain("[object Object]");
  });

  test("readRpcFailureMessage reads Errors, plain objects and strings alike", () => {
    expect(readRpcFailureMessage(new Error("stripe_charges_disabled"))).toBe(
      "stripe_charges_disabled",
    );
    expect(readRpcFailureMessage({ message: "offering_date_past" })).toBe(
      "offering_date_past",
    );
    expect(readRpcFailureMessage("city_required")).toBe("city_required");
    expect(readRpcFailureMessage(null)).toBe("");
    expect(readRpcFailureMessage(undefined)).toBe("");
    expect(readRpcFailureMessage({})).toBe("");
  });

  test("readRpcFailureCode reads the PostgREST code", () => {
    expect(readRpcFailureCode(POSTGREST_404)).toBe("PGRST202");
    expect(readRpcFailureCode(new Error("boom"))).toBeNull();
    expect(readRpcFailureCode(null)).toBeNull();
  });

  test("a 404 from a missing RPC is TERMINAL, not retryable", () => {
    expect(isMissingRpcFailure(POSTGREST_404)).toBe(true);
    expect(isRetryableRsvpRpcFailure(POSTGREST_404)).toBe(false);
  });

  test("Postgres undefined_function is terminal too", () => {
    expect(
      isMissingRpcFailure({
        code: "42883",
        message:
          "function public.business_set_rsvp_guest_status(uuid, text, text, text[], bigint, uuid) does not exist",
      }),
    ).toBe(true);
    // …and on the message alone, for a failure re-thrown without its code.
    expect(
      isMissingRpcFailure(
        new Error(
          "function public.ari_execute_rsvp_operation(uuid, text, jsonb) does not exist",
        ),
      ),
    ).toBe(true);
  });

  test("an ordinary business rejection is NOT treated as terminal", () => {
    // The RSVP validation wall raises these. They are the user's to fix, and the
    // retry invitation is correct for them.
    for (const reason of [
      "rsvp_not_found_or_forbidden",
      "rsvp_capacity_full",
      "rsvp_roster_stale",
      "stripe_charges_disabled",
      "offering_date_past",
      "rsvp_idempotency_hash_mismatch",
    ]) {
      expect(`${reason}:${isMissingRpcFailure({ code: "42501", message: reason })}`)
        .toBe(`${reason}:false`);
    }
    expect(isMissingRpcFailure(null)).toBe(false);
    expect(isMissingRpcFailure({})).toBe(false);
  });

  test("terminal copy refuses to tell the user to try again", () => {
    const copy = rsvpRpcFailureCopy(POSTGREST_404, "publish this RSVP");
    expect(copy).toContain("publish this RSVP");
    expect(copy).toContain("retrying won't help");
    expect(copy).not.toMatch(/try again/i);
    // #2333 shipped exactly this defect for two days: a guard the client did not
    // recognise fell through to "Could not save this publish. Try again." while a
    // paying customer retried something that could never succeed.
    expect(copy).not.toBe("Could not save this publish. Try again.");
  });

  test("transient copy keeps the retry invitation", () => {
    const copy = rsvpRpcFailureCopy(
      { code: "40001", message: "rsvp_roster_stale" },
      "approve Amara",
    );
    expect(copy).toContain("approve Amara");
    expect(copy).toMatch(/try again/i);
  });

  test("RsvpRpcError makes a PostgREST failure readable without losing anything", () => {
    const wrapped = new RsvpRpcError(POSTGREST_404, "rsvp_publish_failed");
    expect(wrapped).toBeInstanceOf(Error);
    // The message is preserved byte-for-byte, so the existing
    // resolvePaidPublishGuardCopy(error.message) matching keeps working.
    expect(wrapped.message).toBe(POSTGREST_404.message);
    expect(wrapped.code).toBe("PGRST202");
    expect(wrapped.cause).toBe(POSTGREST_404);
    expect(isMissingRpcFailure(wrapped)).toBe(true);
    // And a guard reason still round-trips.
    const guard = new RsvpRpcError(
      { code: "P0001", message: "stripe_charges_disabled" },
      "rsvp_publish_failed",
    );
    expect(guard.message).toBe("stripe_charges_disabled");
    expect(isMissingRpcFailure(guard)).toBe(false);
  });

  test("RsvpRpcError falls back rather than throwing an empty message", () => {
    const wrapped = new RsvpRpcError({}, "rsvp_publish_failed");
    expect(wrapped.message).toBe("rsvp_publish_failed");
    expect(wrapped.code).toBeNull();
  });

  test("the RSVP services throw a readable Error, never the bare PostgREST object", () => {
    // Source-level: `throw error` re-throws the plain object and is what made the
    // 404 unreadable. It must not come back.
    for (const file of [
      "rsvpEvents.ts",
      "rsvpApprovals.ts",
    ]) {
      const source = readRepoFile("mingla-business", "src", "services", file);
      expect(`${file}:${/if \(error !== null\) throw error;/.test(source)}`).toBe(
        `${file}:false`,
      );
      expect(`${file}:${source.includes("new RsvpRpcError(")}`).toBe(
        `${file}:true`,
      );
    }
  });

  test("the publish dialog stays open on failure instead of racing a Toast", () => {
    // The device-proven cause of the silence. The old catch closed the
    // ConfirmDialog and presented a Toast (itself a native Modal) in the SAME
    // commit; iOS New-Arch drops the second modal — the same race this repo
    // already documents at #1376 / #1360. Keeping the dialog up and filling its
    // errorMessage slot removes the race entirely and leaves Publish as the
    // in-context retry.
    const wizard = readRepoFile(
      "mingla-business",
      "src",
      "components",
      "rsvp",
      "RsvpCreatorWizard.tsx",
    );
    expect(wizard).toContain("const [publishError, setPublishError]");
    expect(wizard).toContain("errorMessage={publishError}");
    expect(wizard).toContain('rsvpRpcFailureCopy(error, "publish this RSVP")');
    // The failing branch must not close the dialog, and must not fall back to
    // the dead-toast line.
    expect(wizard).not.toContain("Could not save this publish. Try again.");
  });

  test("the guest roster no longer invents a cause it never checked", () => {
    const roster = readRepoFile(
      "mingla-business",
      "src",
      "components",
      "guests",
      "GuestRosterExperience.tsx",
    );
    // It used to `catch { … }` with no binding and assert "The RSVP changed
    // before this action" — false for a 404, and an invitation to retry forever.
    expect(roster).not.toContain(
      "The RSVP changed before this action. Refresh and try again.",
    );
    expect(roster).toContain("rsvpRpcFailureCopy(error,");
    expect(roster).toContain("isRetryableRsvpRpcFailure(error)");
  });

  test("every guest-console failure path reads the real error", () => {
    const console_ = readRepoFile(
      "mingla-business",
      "src",
      "components",
      "rsvp",
      "RsvpGuestConsole.tsx",
    );
    // Six onError sites: row approve/deny, remove, bulk, sheet approve/deny.
    expect((console_.match(/rsvpRpcFailureCopy\(error,/g) ?? []).length).toBe(6);
    expect(console_).not.toMatch(/onError: \(\) =>/);
  });
});
