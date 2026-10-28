// #2829 W8 — the local domain provider's control table exists only in a
// developer's local stack: the local tooling creates it behind a guard that
// refuses any database whose Sites service row is not 'local', and no
// migration ever creates or mentions it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSql, LOCAL_DOMAIN_STATES_DDL, LOCAL_ONLY_GUARD, parseArgs } from "../local/domain-state.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("#2829 W8 no migration creates the local domain control table", () => {
  const dir = resolve(REPO_ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    assert.doesNotMatch(readFileSync(resolve(dir, file), "utf8"), /brand_site_local_domain_states/, file);
  }
});

test("#2829 W8 the local guard runs before the table is created or written", () => {
  const sql = buildSql(parseArgs(["--host", "youngandstamped.test", "--verified", "--configured", "--mx", "mx1.mail.test"]));
  const guard = sql.indexOf(LOCAL_ONLY_GUARD.trim());
  assert.ok(guard > 0, "guard present");
  assert.ok(sql.indexOf("CREATE TABLE IF NOT EXISTS public.brand_site_local_domain_states") > guard, "DDL after guard");
  assert.ok(sql.indexOf("UPDATE public.brand_site_local_domain_states SET verified = true, misconfigured = false, mx = ARRAY['mx1.mail.test']::text[]") > guard);
  assert.match(LOCAL_ONLY_GUARD, /environment = 'local'/);
  assert.match(LOCAL_ONLY_GUARD, /environment <> 'local'/);
  assert.match(LOCAL_DOMAIN_STATES_DDL, /REVOKE ALL ON TABLE public\.brand_site_local_domain_states FROM PUBLIC, anon, authenticated/);
  // The seed creates it too, with its own local-only guard earlier in the script.
  const seed = readFileSync(resolve(REPO_ROOT, "scripts/sites/local/seed-local.mjs"), "utf8");
  assert.ok(seed.indexOf("${LOCAL_DOMAIN_STATES_DDL}") > seed.indexOf("SEED_REFUSED: this database holds a non-local Sites service row"));
});

test("#2829 W8 arguments are validated; values are quoted", () => {
  assert.throws(() => parseArgs([]), /HOST_REQUIRED/);
  assert.throws(() => parseArgs(["--host", "bad host"]), /HOST_REQUIRED/);
  assert.throws(() => parseArgs(["--host", "a.test", "--mx", "x'; DROP TABLE y;--"]), /BAD_NAME/);
  assert.throws(() => parseArgs(["--host", "a.test", "--age-misconfigured-days", "999"]), /BAD_AGE/);
  const sql = buildSql(parseArgs(["--host", "a.test", "--age-misconfigured-days", "8", "--no-mx"]));
  assert.match(sql, /mx = ARRAY\[\]::text\[\]/);
  assert.match(sql, /misconfigured_since = clock_timestamp\(\) - make_interval\(days => 8\) WHERE hostname = 'a\.test' AND kind = 'custom_domain'/);
});
