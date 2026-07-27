/**
 * ISSUE-997 D1 — INDEPENDENT TESTER adversarial schema suite.
 *
 * DIFFERENT ANGLE from the implementor schema test (issue997_google_video_prepare
 * _schema.test.ts), which checked the guard lists 4 platforms, the CREATE OR
 * REPLACE + security lines, no DDL, and the read-only DO block.
 *
 * This suite attacks the "additive, byte-identical to #1184 except the guard"
 * CLAIM and the negative space of the guard/privileges:
 *   - BYTE-IDENTITY: the RPC body is byte-identical to the proven #1184 state
 *     machine EXCEPT a single line — the platform guard — whose sole delta is
 *     '+google'. Any other drift in the 60-minute-deadline CAS state machine fails.
 *   - EXACT-SET guard: the IN-list is EXACTLY {meta,snapchat,tiktok,google} — no
 *     accidental 5th admit (reddit/facebook/empty/typo), asserted by parsing every
 *     quoted token, not just presence.
 *   - NO privilege escalation: no GRANT to PUBLIC/anon/authenticated, no SECURITY
 *     INVOKER, exactly one CREATE OR REPLACE targeting ad_creative_prepare_begin.
 *   - NO destructive / create-opening DDL: no DROP/ALTER TABLE/TRUNCATE, and the
 *     migration touches NO campaign/ad-object table and carries no DEMAND_GEN
 *     symbol (Google video CREATE stays fail-closed — that is D2).
 *   - The self-verify DO block is read-only INTROSPECTION only and fails closed.
 *
 * Static, hermetic: reads the .sql text. ZERO DB connection, ZERO migration apply,
 * ZERO writes. (The hard guard forbids applying migrations.)
 *
 * Run: deno test --allow-read \
 *   supabase/migrations/__tests__/issue997_google_video_prepare_schema.adversarial.tester.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const d1Url = new URL(
  "../20270111001185_issue_997_google_video_prepare.sql",
  import.meta.url,
);
const baseUrl = new URL(
  "../20270111001184_issue_1184_video_prepare_lifecycle.sql",
  import.meta.url,
);
const d1 = await Deno.readTextFile(d1Url);
const base = await Deno.readTextFile(baseUrl);

/** Extract the RPC function body between `AS $function$` and `$function$;`. */
function rpcBody(sql: string): string[] {
  const startTag = "AS $function$";
  const endTag = "$function$;";
  const s = sql.indexOf(startTag);
  const e = sql.indexOf(endTag, s + startTag.length);
  assert(s > -1 && e > s, "RPC body delimiters must be present");
  return sql.slice(s + startTag.length, e).split("\n");
}

Deno.test("ADV D1 schema: RPC body is byte-identical to #1184 EXCEPT one line — the platform guard (+google)", () => {
  const d1Body = rpcBody(d1);
  const baseBody = rpcBody(base);
  // Same shape: porting +google must NOT drift the #1184 CAS state machine.
  assertEquals(
    d1Body.length,
    baseBody.length,
    "the D1 RPC body must have the same line count as #1184 (no structural drift)",
  );
  const diffs: number[] = [];
  for (let i = 0; i < d1Body.length; i++) {
    if (d1Body[i] !== baseBody[i]) diffs.push(i);
  }
  assertEquals(
    diffs.length,
    1,
    `exactly ONE line may differ (the guard); differing lines: ${
      diffs.map((i) => `#${i}: ${baseBody[i]} -> ${d1Body[i]}`).join(" | ")
    }`,
  );
  const i = diffs[0];
  assertEquals(
    baseBody[i].trim(),
    "IF p_platform NOT IN ('meta','snapchat','tiktok') THEN",
  );
  assertEquals(
    d1Body[i].trim(),
    "IF p_platform NOT IN ('meta','snapchat','tiktok','google') THEN",
  );
});

Deno.test("ADV D1 schema: the guard IN-list is EXACTLY {meta,snapchat,tiktok,google} — no accidental 5th admit", () => {
  const match = d1.match(/IF p_platform NOT IN \(([^)]*)\) THEN/);
  assert(match, "platform guard IN-list must be present");
  const tokens = [...match![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assertEquals(
    tokens,
    ["meta", "snapchat", "tiktok", "google"],
    "the IN-list must be exactly these four, in order, with no extras/typos/empties",
  );
  // Defense-in-depth: reddit/facebook are NOT admitted anywhere in the guard.
  assertEquals(match![1].includes("reddit"), false);
  assertEquals(match![1].includes("facebook"), false);
  // An unknown platform still raises platform_invalid.
  assert(/platform_invalid/.test(d1));
});

Deno.test("ADV D1 schema: NO privilege escalation — service_role-only EXECUTE, no PUBLIC/anon/authenticated GRANT", () => {
  // The only GRANT EXECUTE is to service_role.
  const grants = [
    ...d1.matchAll(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO ([a-z_, ]+);/g),
  ]
    .map((m) => m[1].replace(/\s/g, ""));
  assertEquals(grants.length, 1, "exactly one GRANT EXECUTE statement");
  assertEquals(grants[0], "service_role");
  // PUBLIC/anon/authenticated are REVOKED, never granted.
  assert(
    /REVOKE EXECUTE ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated/.test(
      d1,
    ),
  );
  // No security downgrade.
  assertEquals(d1.includes("SECURITY INVOKER"), false);
  assert(d1.includes("SECURITY DEFINER"));
});

Deno.test("ADV D1 schema: exactly ONE CREATE OR REPLACE FUNCTION, targeting ad_creative_prepare_begin", () => {
  const creates = [...d1.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)]
    .map((m) => m[1]);
  assertEquals(creates, ["ad_creative_prepare_begin"]);
  // No NEW function, no other function replaced.
  assertEquals(d1.includes("CREATE FUNCTION"), false);
  assertEquals(d1.includes("DROP FUNCTION"), false);
});

Deno.test("ADV D1 schema: additive-only — no destructive DDL and NO campaign/ad-object write (create stays fail-closed)", () => {
  for (
    const forbidden of [
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP TABLE",
      "TRUNCATE",
      "ADD COLUMN",
      "ADD CONSTRAINT",
      "DROP CONSTRAINT",
      "CREATE INDEX",
      "DROP INDEX",
    ]
  ) {
    assertEquals(
      d1.includes(forbidden),
      false,
      `must not contain: ${forbidden}`,
    );
  }
  // The migration only ever touches the prepare state table — never a campaign/ad
  // object table, and never carries a Demand Gen create symbol (D2, not D1).
  assertEquals(/INSERT INTO public\.ad_campaigns/i.test(d1), false);
  assertEquals(/INSERT INTO public\.ad_ads/i.test(d1), false);
  assertEquals(d1.includes("DEMAND_GEN"), false);
  // The sole write target is ad_creative_platform_refs (the #1184 state machine).
  const inserts = [...d1.matchAll(/INSERT INTO public\.(\w+)/g)].map((m) =>
    m[1]
  );
  for (const table of inserts) {
    assertEquals(table, "ad_creative_platform_refs");
  }
});

Deno.test("ADV D1 schema: the self-verify DO block is READ-ONLY introspection and fails closed", () => {
  const verifyMatch = d1.match(/DO \$verify\$([\s\S]*?)\$verify\$;/);
  assert(verifyMatch, "a DO $verify$ block must exist");
  const verify = verifyMatch![1];
  // No write DML nor DDL of any kind inside the verify block.
  for (
    const forbidden of [
      "INSERT",
      "UPDATE",
      "DELETE",
      "DROP",
      "CREATE",
      "ALTER",
      "GRANT",
      "REVOKE",
    ]
  ) {
    assertEquals(
      new RegExp(`\\b${forbidden}\\b`, "i").test(verify),
      false,
      `verify block must not contain ${forbidden}`,
    );
  }
  // Purely introspective: pg_get_functiondef + has_function_privilege + catalog reads.
  assert(
    verify.includes("pg_get_functiondef"),
    "verify must introspect the function def",
  );
  assert(
    verify.includes("has_function_privilege"),
    "verify must check privileges read-only",
  );
  assert(
    /pg_proc|pg_constraint|pg_namespace/.test(verify),
    "verify must read the catalogs",
  );
  // Fails closed: it RAISEs if google is missing / security regressed.
  assert(/RAISE EXCEPTION/.test(verify));
  assert(
    verify.includes("google not present"),
    "verify must fail closed when google is absent",
  );
});
