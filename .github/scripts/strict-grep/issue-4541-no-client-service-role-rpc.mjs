#!/usr/bin/env node
// MINGLA-INVARIANT: I-4541-NO-CLIENT-SERVICE-ROLE-RPC | issue #4541 | no client file (mingla-business src and app, app-mobile src and app, packages) calls .rpc() on a brand form function that the brand form migrations grant to service_role only; those reads go through an edge function.
/**
 * issue #4541 R1.14 (T-40) — clients never call a server-role-only form RPC.
 *
 * WHY. #4514 granted `public_brand_form_for_event` to service_role only, while
 * buyer web and the Explorer app called it straight from the browser and the
 * app. Every RSVP page with a form showed "Questions couldn't load" (live bug
 * N1). The fix routes the read through brand-form-submit ({op:"page_form"});
 * this gate keeps any client from going back to a direct call.
 *
 * RULE. The service-role-only set is derived from the brand form migrations
 * themselves (every `*_issue_4514_brand_forms.sql` and `*_issue_4541_*.sql`,
 * in file order): each `GRANT EXECUTE ON FUNCTION … TO …` adds roles, each
 * `REVOKE … ON FUNCTION … FROM …` removes them. A function whose final role
 * set contains service_role and none of authenticated, anon or PUBLIC is
 * service-role only. A client file may not call `.rpc("<that name>"`.
 *
 * SCOPE: non-test .ts/.tsx/.js/.jsx/.mjs under mingla-business/src,
 * mingla-business/app, app-mobile/src, app-mobile/app and packages/*.
 *
 * DOES NOT CATCH, stated rather than implied: an RPC name built at runtime or
 * held in a variable (only a string literal first argument is read), or a
 * function granted outside the brand form migrations. The pg17 suites' T-42
 * sections call each client RPC as anon/authenticated and cover the grants.
 *
 * `--self-test` drives the pure core with fixtures.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = "supabase/migrations";
export const CLIENT_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "app-mobile/app",
  "packages",
];

// ---- pure core ----------------------------------------------------------

/** Drop SQL line comments. */
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * statements: SQL texts in file order → Map<function name, Set<role>>.
 * Only GRANT/REVOKE on FUNCTION statements are read.
 */
export function functionRoles(sqlTexts) {
  const roles = new Map();
  for (const text of sqlTexts) {
    const code = stripSqlComments(text);
    const re = /\b(GRANT|REVOKE)\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+([\s\S]*?)\s+(TO|FROM)\s+([^;]+);/gi;
    for (const m of code.matchAll(re)) {
      const grant = m[1].toUpperCase() === "GRANT";
      const names = [...m[2].matchAll(/public\.([a-z0-9_]+)\s*\(/gi)].map((x) => x[1].toLowerCase());
      const who = m[4].split(",").map((r) => r.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
      for (const name of names) {
        const set = roles.get(name) ?? new Set();
        for (const r of who) {
          if (grant) set.add(r);
          else set.delete(r);
        }
        roles.set(name, set);
      }
    }
  }
  return roles;
}

/** The names granted to service_role and to no client role. */
export function serviceRoleOnly(roleMap) {
  const out = new Set();
  for (const [name, set] of roleMap) {
    if (set.has("service_role") && !set.has("authenticated") && !set.has("anon") && !set.has("public")) {
      out.add(name);
    }
  }
  return out;
}

/** Remove // and block comments, leaving string and template literals alone. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === "//") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const isTest = (rel) => /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);

export function inScope(rel) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(rel) || /\.d\.ts$/.test(rel) || isTest(rel)) return false;
  if (rel.includes("/node_modules/")) return false;
  return CLIENT_ROOTS.some((root) => rel.startsWith(`${root}/`));
}

/** The RPC names a source calls with a string-literal first argument. */
export function rpcCalls(src) {
  const code = stripComments(src);
  return [...code.matchAll(/\.rpc\s*(?:<[^>]*>)?\s*\(\s*(["'`])([A-Za-z0-9_]+)\1/g)].map((m) => m[2].toLowerCase());
}

/** files: [rel, src][] → offenders: { file, calls }[] */
export function scan(files, banned) {
  const offenders = [];
  for (const [rel, src] of files) {
    if (!inScope(rel)) continue;
    const calls = rpcCalls(src).filter((name) => banned.has(name));
    if (calls.length > 0) offenders.push({ file: rel, calls: [...new Set(calls)] });
  }
  return offenders;
}

// ---- self-test ----------------------------------------------------------

function selfTest() {
  const cases = [];
  const check = (name, ok) => cases.push([name, ok]);
  const sql = [
    `GRANT EXECUTE ON FUNCTION public.public_brand_form_for_event(uuid) TO service_role;
     GRANT EXECUTE ON FUNCTION public.brand_form_my_response(uuid, uuid, text, uuid) TO authenticated, service_role;
     -- GRANT EXECUTE ON FUNCTION public.brand_form_commented(uuid) TO service_role;
     GRANT EXECUTE ON FUNCTION
       public.brand_form_a(uuid),
       public.brand_form_b(text, uuid)
     TO service_role;
     GRANT EXECUTE ON FUNCTION public.brand_form_later(uuid) TO authenticated, service_role;`,
    `REVOKE ALL ON FUNCTION public.brand_form_later(uuid) FROM PUBLIC, anon, authenticated;
     GRANT EXECUTE ON FUNCTION public.brand_form_opened(uuid) TO service_role;
     GRANT EXECUTE ON FUNCTION public.brand_form_opened(uuid) TO authenticated;`,
  ];
  const banned = serviceRoleOnly(functionRoles(sql));
  check("a service-role-only grant is banned", banned.has("public_brand_form_for_event"));
  check("a function granted to authenticated is allowed", !banned.has("brand_form_my_response"));
  check("a multi-line grant list is read", banned.has("brand_form_a") && banned.has("brand_form_b"));
  check("a commented grant is ignored", !banned.has("brand_form_commented"));
  check("a later revoke from authenticated makes it service-role only", banned.has("brand_form_later"));
  check("a later grant to authenticated opens it", !banned.has("brand_form_opened"));
  check("a direct client call fires",
    scan([["mingla-business/src/services/x.ts", `await supabase.rpc("public_brand_form_for_event", { p_event_id })`]], banned).length === 1);
  check("a typed call fires",
    scan([["app-mobile/src/services/x.ts", `supabase.rpc<Foo>('brand_form_a', {})`]], banned).length === 1);
  check("a package call fires",
    scan([["packages/offering-rendering/x.ts", "client.rpc(`brand_form_b`)"]], banned).length === 1);
  check("an app route call fires",
    scan([["app-mobile/app/form/[formId].tsx", `supabase.rpc("brand_form_a")`]], banned).length === 1);
  check("an allowed client RPC is fine",
    scan([["mingla-business/src/services/x.ts", `supabase.rpc("brand_form_my_response", {})`]], banned).length === 0);
  check("the edge op is fine",
    scan([["mingla-business/src/services/x.ts", `functions.invoke("brand-form-submit", { body: { op: "page_form" } })`]], banned).length === 0);
  check("a commented call is ignored",
    scan([["mingla-business/src/services/x.ts", `// supabase.rpc("public_brand_form_for_event")`]], banned).length === 0);
  check("tests and edge functions are out of scope",
    !inScope("mingla-business/src/services/__tests__/x.test.ts") && !inScope("supabase/functions/brand-form-submit/index.ts")
      && !inScope("app-mobile/src/x.test.tsx"));

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (failed.length > 0) {
    console.error(`#4541 no-client-service-role-rpc self-test FAIL: ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`#4541 no-client-service-role-rpc self-test PASS: ${cases.length} cases`);
}

// ---- plain run ----------------------------------------------------------

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const migDir = path.join(ROOT, MIGRATIONS);
  const migFiles = fs.existsSync(migDir)
    ? fs.readdirSync(migDir)
      .filter((f) => /^\d+_issue_4514_brand_forms\.sql$/.test(f) || /^\d+_issue_4541_.*\.sql$/.test(f))
      .sort()
    : [];
  if (migFiles.length < 2) {
    console.error(`#4541 no-client-service-role-rpc FAIL: brand form migrations not found under ${MIGRATIONS} (wrong working directory?)`);
    process.exit(1);
  }
  const banned = serviceRoleOnly(functionRoles(migFiles.map((f) => fs.readFileSync(path.join(migDir, f), "utf8"))));
  if (!banned.has("public_brand_form_for_event")) {
    console.error("#4541 no-client-service-role-rpc FAIL: the derived set lost public_brand_form_for_event (grant parsing broke)");
    process.exit(1);
  }
  const files = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (inScope(childRel)) files.push([childRel, fs.readFileSync(childAbs, "utf8")]);
    }
  };
  for (const root of CLIENT_ROOTS) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs)) walk(abs, root);
  }
  if (files.length === 0) {
    console.error("#4541 no-client-service-role-rpc FAIL: no client source found (wrong working directory?)");
    process.exit(1);
  }
  const offenders = scan(files, banned);
  if (offenders.length > 0) {
    console.error(`#4541 no-client-service-role-rpc FAIL: ${offenders.length} client file(s) call a service-role-only form RPC`);
    for (const { file, calls } of offenders) console.error(`    ${file}: ${calls.join(", ")}`);
    console.error("  Read it through brand-form-submit (e.g. {op:\"page_form\"}) instead.");
    process.exit(1);
  }
  console.log(`#4541 no-client-service-role-rpc PASS: 0 offenders in ${files.length} files; ${banned.size} service-role-only form functions`);
}
